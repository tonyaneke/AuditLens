// Change-only backups — the pure part: fingerprints, the difference between the database now and
// the last backup, and replaying that difference onto the last backup's state.
//
// No database and no SharePoint here (lib/backup.ts reads and packages; scripts/backup-delta.test.mts
// exercises this directly), so the one thing a change-only backup must guarantee — that the full
// backup plus its change files rebuild the database exactly — can be tested on its own.
//
// What a "change" is, per table:
//   WorkspaceData  the one document holding every audit record, compared key by key: a top-level
//                  list of records with ids (audits, fraudRisks, notifications, …) by record, so a
//                  change to one audit carries that audit and not the other 37; anything else
//                  (exco, settings, …) as a whole value.
//   AuditLog       append-only by design: the entries written since the last backup.
//   anything else  by row id where there is one (users, drafts, …), else the whole table.
// Every change file also lists every id still present, which is how a deletion is recorded.

import { createHash } from "node:crypto";

export type Row = Record<string, unknown>;
export type TableState = { columns: string[]; rows: Row[] };
/** Every table as a backup holds it — rows JSON-normalised (dates as ISO strings, bigints as text). */
export type DbState = { tables: Record<string, TableState> };

const WORKSPACE_TABLE = "WorkspaceData";
const WORKSPACE_ROW = "default";
const APPEND_ONLY = new Set(["AuditLog"]);
/** An entry can commit a little after its createdAt; entries this close to the last backup's newest
 *  are matched by id rather than by time, so one that committed late is not missed. */
const OVERLAP_MS = 10 * 60 * 1000;

/** JSON with bigints as text — the form every backup file is written in. */
export function toJson(v: unknown, indent?: number): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), indent);
}

/** A value exactly as it reads back from a backup file, so a row fresh from the database and the
 *  same row parsed out of a backup fingerprint the same. */
export function normalize<T>(v: T): T {
  return JSON.parse(toJson(v)) as T;
}

/** 64 bits of SHA-256: it only has to notice that a record changed, and keeps index.json small. */
const fp = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const idOf = (r: Row) => String(r.id);
const isObj = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** A list of records with unique ids — diffed record by record. Anything else is diffed whole. */
function records(v: unknown): Row[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const seen = new Set<string>();
  for (const x of v) {
    if (!isObj(x) || (typeof x.id !== "string" && typeof x.id !== "number")) return null;
    const id = String(x.id);
    if (seen.has(id)) return null;
    seen.add(id);
  }
  return v as Row[];
}

function uniqueIds(rows: Row[]): boolean {
  const ids = new Set(rows.map(idOf));
  return rows.every((r) => r.id !== undefined && r.id !== null) && ids.size === rows.length;
}

/* ---------------- the index: a fingerprint of everything a backup represents ---------------- */

/** [id, fingerprint] in order — an array, not an object, because numeric-looking keys of a plain
 *  object are reordered by JavaScript, and order is part of what is restored. */
type Prints = [string, string][];

type KeyIndex = { mode: "items"; items: Prints } | { mode: "value"; hash: string };

export type TableIndex =
  | { mode: "rows"; rows: Prints }
  | { mode: "all"; hash: string }
  | { mode: "append"; cursor: string | null; recentIds: string[] }
  | { mode: "workspace"; meta: string; keyOrder: string[]; keys: Record<string, KeyIndex>; others: Prints; rowOrder: string[] };

export type BackupIndex = { tables: Record<string, TableIndex> };

function tableMode(name: string, t: TableState): TableIndex["mode"] {
  if (name === WORKSPACE_TABLE && t.rows.some((r) => r.id === WORKSPACE_ROW && isObj(r.data)) && uniqueIds(t.rows)) return "workspace";
  if (APPEND_ONLY.has(name) && t.columns.includes("id") && t.columns.includes("createdAt") && uniqueIds(t.rows)) return "append";
  if (t.columns.includes("id") && uniqueIds(t.rows)) return "rows";
  return "all";
}

const printsOf = (rows: Row[]): Prints => rows.map((r) => [idOf(r), fp(r)]);
const withoutData = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "data"));

function keyIndex(v: unknown): KeyIndex {
  const recs = records(v);
  return recs ? { mode: "items", items: printsOf(recs) } : { mode: "value", hash: fp(v) };
}

function cursorOf(rows: Row[]): { cursor: string | null; recentIds: string[] } {
  const cursor = rows.reduce<string | null>((m, r) => (m === null || String(r.createdAt) > m ? String(r.createdAt) : m), null);
  if (cursor === null) return { cursor, recentIds: [] };
  const floor = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
  return { cursor, recentIds: rows.filter((r) => String(r.createdAt) >= floor).map(idOf) };
}

function indexTable(name: string, t: TableState): TableIndex {
  const mode = tableMode(name, t);
  if (mode === "workspace") {
    const main = t.rows.find((r) => r.id === WORKSPACE_ROW)!;
    const doc = main.data as Row;
    return {
      mode,
      meta: fp(withoutData(main)),
      keyOrder: Object.keys(doc),
      keys: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, keyIndex(v)])),
      others: printsOf(t.rows.filter((r) => r.id !== WORKSPACE_ROW)),
      rowOrder: t.rows.map(idOf),
    };
  }
  if (mode === "append") return { mode, ...cursorOf(t.rows) };
  if (mode === "rows") return { mode, rows: printsOf(t.rows) };
  return { mode, hash: fp(t.rows) };
}

export function indexOf(state: DbState): BackupIndex {
  return { tables: Object.fromEntries(Object.entries(state.tables).map(([n, t]) => [n, indexTable(n, t)])) };
}

/* ---------------- the delta: what changed since an index ---------------- */

type KeyDelta = { mode: "items"; order: string[]; items: Row[] } | { mode: "value"; value: unknown };

export type TableDelta =
  | { mode: "rows"; columns: string[]; ids: string[]; rows: Row[] }
  | { mode: "all"; columns: string[]; rows: Row[] }
  | { mode: "append"; columns: string[]; rows: Row[] }
  | {
      mode: "workspace";
      columns: string[];
      meta: Row;
      keyOrder: string[];
      keys: Record<string, KeyDelta>;
      rowOrder: string[];
      others: Row[];
    };

export type BackupDelta = { tableOrder: string[]; tables: Record<string, TableDelta> };

/** Rows whose fingerprint is new or different, and whether anything (content or order) changed. */
function changedRows(rows: Row[], before: Prints): { changed: Row[]; same: boolean } {
  const was = new Map(before);
  const changed = rows.filter((r) => was.get(idOf(r)) !== fp(r));
  const same = !changed.length && rows.length === before.length && rows.every((r, i) => idOf(r) === before[i][0]);
  return { changed, same };
}

function diffTable(name: string, t: TableState, prev: TableIndex | undefined): TableDelta | null {
  const mode = tableMode(name, t);
  const columns = t.columns;
  if (!prev || prev.mode !== mode) {
    // New table, or one whose shape changed: carried whole.
    return { mode: "all", columns, rows: t.rows };
  }
  if (prev.mode === "all") return fp(t.rows) === prev.hash ? null : { mode: "all", columns, rows: t.rows };
  if (prev.mode === "rows") {
    const { changed, same } = changedRows(t.rows, prev.rows);
    return same ? null : { mode: "rows", columns, ids: t.rows.map(idOf), rows: changed };
  }
  if (prev.mode === "append") {
    const known = new Set(prev.recentIds);
    const floor = prev.cursor === null ? null : new Date(Date.parse(prev.cursor) - OVERLAP_MS).toISOString();
    const fresh = t.rows.filter((r) => floor === null || (String(r.createdAt) >= floor && !known.has(idOf(r))));
    return fresh.length ? { mode: "append", columns, rows: fresh } : null;
  }

  // The workspace document, key by key.
  const main = t.rows.find((r) => r.id === WORKSPACE_ROW)!;
  const doc = main.data as Row;
  const keys: Record<string, KeyDelta> = {};
  for (const [k, v] of Object.entries(doc)) {
    const was = prev.keys[k];
    const recs = records(v);
    if (recs && was?.mode === "items") {
      const { changed, same } = changedRows(recs, was.items);
      if (!same) keys[k] = { mode: "items", order: recs.map(idOf), items: changed };
    } else if (recs) {
      keys[k] = { mode: "items", order: recs.map(idOf), items: recs };
    } else if (!was || was.mode !== "value" || was.hash !== fp(v)) {
      keys[k] = { mode: "value", value: v };
    }
  }
  const others = changedRows(t.rows.filter((r) => r.id !== WORKSPACE_ROW), prev.others);
  const meta = withoutData(main);
  const keyOrder = Object.keys(doc);
  const rowOrder = t.rows.map(idOf);
  const same =
    !Object.keys(keys).length &&
    others.same &&
    fp(meta) === prev.meta &&
    JSON.stringify(keyOrder) === JSON.stringify(prev.keyOrder) &&
    JSON.stringify(rowOrder) === JSON.stringify(prev.rowOrder);
  return same ? null : { mode: "workspace", columns, meta, keyOrder, keys, rowOrder, others: others.changed };
}

/** What the database holds now that the backup indexed by `prev` does not. Empty when nothing changed. */
export function diffState(prev: BackupIndex, state: DbState): { delta: BackupDelta; empty: boolean } {
  const tables: Record<string, TableDelta> = {};
  for (const [name, t] of Object.entries(state.tables)) {
    const d = diffTable(name, t, prev.tables[name]);
    if (d) tables[name] = d;
  }
  const tableOrder = Object.keys(state.tables);
  const empty = !Object.keys(tables).length && JSON.stringify(tableOrder) === JSON.stringify(Object.keys(prev.tables));
  return { delta: { tableOrder, tables }, empty };
}

/* ---------------- replaying a delta ---------------- */

function broken(what: string): never {
  throw new Error(`This change file does not fit the backup before it (${what}) — the chain is broken.`);
}

function assemble(order: string[], changed: Row[], before: Row[], what: string): Row[] {
  const fresh = new Map(changed.map((r) => [idOf(r), r]));
  const was = new Map(before.map((r) => [idOf(r), r]));
  return order.map((id) => fresh.get(id) ?? was.get(id) ?? broken(`${what} ${id} is missing`));
}

/** The state after `delta`, given the state of the backup it was taken against. */
export function applyDelta(prev: DbState, delta: BackupDelta): DbState {
  const tables: Record<string, TableState> = {};
  for (const name of delta.tableOrder) {
    const d = delta.tables[name];
    const p = prev.tables[name];
    if (!d) {
      tables[name] = p ?? broken(`table ${name} is not in it`);
      continue;
    }
    if (d.mode === "all") tables[name] = { columns: d.columns, rows: d.rows };
    else if (d.mode === "rows") tables[name] = { columns: d.columns, rows: assemble(d.ids, d.rows, p?.rows ?? [], `${name} row`) };
    else if (d.mode === "append") {
      const have = new Set((p?.rows ?? []).map(idOf));
      const rows = [...(p?.rows ?? []), ...d.rows.filter((r) => !have.has(idOf(r)))];
      // Stable: entries keep their order within the same instant, as the database returned them.
      rows.sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? -1 : String(a.createdAt) > String(b.createdAt) ? 1 : 0));
      tables[name] = { columns: d.columns, rows };
    } else {
      const before = p?.rows ?? [];
      const prevMain = before.find((r) => r.id === WORKSPACE_ROW);
      const prevDoc = isObj(prevMain?.data) ? (prevMain!.data as Row) : broken("no workspace document");
      const doc: Row = {};
      for (const k of d.keyOrder) {
        const kd = d.keys[k];
        if (!kd) {
          if (!(k in prevDoc)) broken(`workspace key ${k} is not in it`);
          doc[k] = prevDoc[k];
        } else if (kd.mode === "value") doc[k] = kd.value;
        else doc[k] = assemble(kd.order, kd.items, records(prevDoc[k]) ?? [], `${k} record`);
      }
      // The row's own columns in their original order, the document in its place.
      const main: Row = {};
      for (const c of d.columns) {
        if (c === "data") main.data = doc;
        else if (c in d.meta) main[c] = d.meta[c];
      }
      for (const [c, v] of Object.entries(d.meta)) if (!(c in main)) main[c] = v;
      if (!("data" in main)) main.data = doc;
      const others = assemble(
        d.rowOrder.filter((id) => id !== WORKSPACE_ROW),
        d.others,
        before.filter((r) => r.id !== WORKSPACE_ROW),
        `${name} row`,
      );
      const byId = new Map([[WORKSPACE_ROW, main], ...others.map((r) => [idOf(r), r] as [string, Row])]);
      tables[name] = { columns: d.columns, rows: d.rowOrder.map((id) => byId.get(id)!) };
    }
  }
  return { tables };
}

/** Rows changed per table — for the manifest and the audit trail. */
export function deltaSummary(delta: BackupDelta): { table: string; changed: number; detail?: string }[] {
  return Object.entries(delta.tables).map(([table, d]) => {
    if (d.mode !== "workspace") return { table, changed: d.rows.length };
    const parts = Object.entries(d.keys).map(([k, kd]) => (kd.mode === "items" ? `${k} ${kd.items.length}` : k));
    return { table, changed: Object.keys(d.keys).length + d.others.length, detail: parts.join(", ") };
  });
}
