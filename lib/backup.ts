// Database backups — every table, every row, exactly as stored — as ZIPs in SharePoint.
//
// Two kinds:
//   FULL          every row of every table. Settings → Back up now, migrations before they write,
//                 and the automatic backup every Saturday (Sunday if Saturday's failed).
//   CHANGES ONLY  what changed since the backup before it (lib/backup-delta.ts says what a change
//                 is). The automatic backup the rest of the week. Useless on its own: restoring
//                 one replays the chain back to its full backup — reconstruct() below, which
//                 scripts/restore-workspace.mts uses.
// Both carry index.json, a fingerprint of everything the backup represents, which is all the next
// change-only backup needs from it.
//
// Tables are read with raw SQL, not through the Prisma models, deliberately: a backup must not
// depend on the code and the database agreeing. When this was written the live AuditLog table was
// still missing the provenance columns the model declares (scripts/add-audit-provenance.mts had not
// been applied), so prisma.auditLog.findMany() failed outright — and drift like that is exactly when
// a backup is wanted. Listing tables from information_schema also means a table added later is
// backed up without anyone remembering to add it here.
//
// The workspace document goes in as the raw row: deleted records (tombstones) and the SOP PDFs the
// API never serves are part of it, so a restore puts back everything, not just what users see.
// Evidence files are not copied — they already live in SharePoint, and the document records each
// one's itemId and link.

import type { prisma as appPrisma } from "./prisma";
import {
  applyDelta,
  deltaSummary,
  diffState,
  indexOf,
  normalize,
  toJson,
  type BackupDelta,
  type BackupIndex,
  type DbState,
  type Row,
} from "./backup-delta";
import { createZip, readZip } from "./zip";

type Db = Pick<typeof appPrisma, "$queryRawUnsafe">;

/* SEC-03: until scripts/drop-local-password.mts has run on a database, User still carries a dead
   passwordHash column of unusable random values. Nothing reads it, and a credential-shaped column
   has no business in a file that gets copied around. */
const EXCLUDED_COLUMNS = new Set(["User.passwordHash"]);

/** 1: tables + manifest. 2: adds index.json, and change-only backups (manifest.kind "changes"). */
export const BACKUP_FORMAT = 2;

/** A change-only backup this many deep is followed by a full one whatever the day — a week between
 *  Saturdays holds six, so this only acts when a whole weekend's full backup was missed. */
export const MAX_CHAIN = 6;

export type BackupContents = {
  audits: number;
  reports: number;
  observations: number;
  closedObservations: number;
  deletedObservations: number;
  /** Owner responses, comments and progress updates on observations and external findings. */
  responsesAndComments: number;
  externalFindings: number;
  fraudRisks: number;
  approvals: number;
  users: number;
  auditTrailEntries: number;
};

export type BackupManifest = {
  app: "AuditLens";
  format: number;
  /** Absent on backups made before change-only backups existed — those are all full. */
  kind?: "full" | "changes";
  createdAt: string;
  createdBy: string;
  /** updatedAt of the workspace row — the version a restore puts back. */
  workspaceUpdatedAt: string | null;
  /** Every table and its row count as of this backup (for a change-only one too: the state it brings
   *  the database to, not the size of the change). */
  tables: { name: string; file: string; rows: number; columns: string[] }[];
  excludedColumns: string[];
  contents: BackupContents;
  /** Change-only backups: the backup these changes sit on, the full backup the chain starts from,
   *  how many change files deep this one is, and what changed. */
  parent?: string;
  base?: string;
  chainDepth?: number;
  changes?: { table: string; changed: number; detail?: string }[];
};

export type Backup = { fileName: string; zip: Buffer; manifest: BackupManifest };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

function arr(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

function summarise(doc: Row, users: number, auditTrailEntries: number): BackupContents {
  const audits = arr(doc.audits);
  const reports = audits.flatMap((a) => arr(a.reports));
  const obs = reports.flatMap((r) => arr(r.observations));
  const ext = arr(doc.extFindings);
  const talk = (x: Row) => arr(x.updates).length + (String(x.ownerResponse || "").trim() ? 1 : 0);
  return {
    audits: audits.length,
    reports: reports.length,
    observations: obs.length,
    closedObservations: obs.filter((o) => o.status === "Closed").length,
    deletedObservations: obs.filter((o) => o.deletedAt).length,
    responsesAndComments: [...obs, ...ext].reduce((n, x) => n + talk(x), 0),
    externalFindings: ext.length,
    fraudRisks: arr(doc.fraudRisks).length,
    approvals: arr(doc.approvals).length,
    users,
    auditTrailEntries,
  };
}

const contentsLines = (c: BackupContents) => [
  `  ${c.audits} audits, ${c.reports} reports`,
  `  ${c.observations} observations: ${c.closedObservations} closed, ${c.deletedObservations} deleted (kept)`,
  `  ${c.responsesAndComments} owner responses, comments and progress updates`,
  `  ${c.externalFindings} external findings, ${c.fraudRisks} fraud risks, ${c.approvals} approval requests`,
  `  ${c.users} user accounts, ${c.auditTrailEntries} audit-trail entries`,
];

// Plain ASCII on purpose: Notepad and PowerShell on older Windows read UTF-8 without a BOM as ANSI,
// and an em dash comes out as "â€”".
function readme(m: BackupManifest): string {
  return [
    "AuditLens - full database backup",
    "================================",
    "",
    `Taken ${m.createdAt} (UTC) by ${m.createdBy}.`,
    "",
    "CONFIDENTIAL. This file is every record in AuditLens: all audits, reports and observations",
    "(with owner responses, comments and closure details), external findings, the fraud register,",
    "approvals, user accounts and the complete audit trail. Keep it where only Internal Audit can",
    "reach it.",
    "",
    "Contents",
    ...contentsLines(m.contents),
    "",
    "Files",
    ...m.tables.map((t) => `  ${t.file.padEnd(28)} ${t.rows} row(s)`),
    "  manifest.json                what is in this backup, in machine-readable form",
    "  index.json                   fingerprints the next change-only backup is compared against",
    "",
    "Evidence files (attachments, closure evidence, working papers) are not copied here: they are",
    "already in SharePoint, and the workspace document records where each one is.",
    "",
    "Restoring the workspace (audits, observations, findings, approvals - everything but user",
    "accounts and the audit trail, which are never overwritten):",
    "  npx tsx scripts/restore-workspace.mts <this file>.zip            (dry run: shows what changes)",
    "  npx tsx scripts/restore-workspace.mts <this file>.zip --apply",
    "",
  ].join("\r\n");
}

function changesReadme(m: BackupManifest): string {
  return [
    "AuditLens - change-only backup",
    "==============================",
    "",
    `Taken ${m.createdAt} (UTC) by ${m.createdBy}.`,
    "",
    `This file holds only what changed since ${m.parent}.`,
    "It cannot be restored on its own: a restore starts from the full backup",
    `${m.base} and replays every change file after it, up to this one.`,
    "The restore script finds and fetches them itself.",
    "",
    "CONFIDENTIAL. It contains AuditLens records. Keep it where only Internal Audit can reach it.",
    "",
    "What changed",
    ...(m.changes || []).map((c) => `  ${c.table.padEnd(16)} ${c.changed} record(s)${c.detail ? ` (${c.detail})` : ""}`.slice(0, 200)),
    "",
    "The database as of this backup",
    ...contentsLines(m.contents),
    "",
    "Restoring the workspace to this point (dry run first):",
    `  npx tsx scripts/restore-workspace.mts --sharepoint <this file>.zip`,
    `  npx tsx scripts/restore-workspace.mts --sharepoint <this file>.zip --apply`,
    "",
  ].join("\r\n");
}

/** Read every table, rows normalised to how a backup file holds them. Reads only — never writes. */
export async function readDatabase(db: Db): Promise<{ state: DbState; excluded: string[] }> {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const columns = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position`,
  );

  const state: DbState = { tables: {} };
  const excluded: string[] = [];
  for (const { table_name: table } of tables) {
    const all = columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    const keep = all.filter((c) => !EXCLUDED_COLUMNS.has(`${table}.${c}`));
    excluded.push(...all.filter((c) => !keep.includes(c)).map((c) => `${table}.${c}`));
    if (!keep.length) continue;
    const order = keep.includes("createdAt") ? ` ORDER BY ${ident("createdAt")}` : "";
    const rows = await db.$queryRawUnsafe<Row[]>(`SELECT ${keep.map(ident).join(", ")} FROM ${ident(table)}${order}`);
    state.tables[table] = { columns: keep, rows: normalize(rows) };
  }
  return { state, excluded };
}

function workspaceRow(state: DbState): Row {
  const row = (state.tables.WorkspaceData?.rows || []).find((r) => r.id === "default");
  // A backup without the one row that holds every audit record is not a backup.
  if (!row || !row.data || typeof row.data !== "object") {
    throw new Error("The workspace document was not found — nothing was backed up.");
  }
  return row;
}

function manifestFor(state: DbState, excluded: string[], createdBy: string, now: Date): BackupManifest {
  const workspace = workspaceRow(state);
  return {
    app: "AuditLens",
    format: BACKUP_FORMAT,
    kind: "full",
    createdAt: now.toISOString(),
    createdBy,
    workspaceUpdatedAt: workspace.updatedAt ? new Date(workspace.updatedAt as string).toISOString() : null,
    tables: Object.entries(state.tables).map(([name, t]) => ({ name, file: `tables/${name}.json`, rows: t.rows.length, columns: t.columns })),
    excludedColumns: excluded,
    contents: summarise(
      workspace.data as Row,
      (state.tables.User?.rows || []).length,
      (state.tables.AuditLog?.rows || []).length,
    ),
  };
}

const stampOf = (now: Date) => now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");

/** A state packaged as a FULL backup. Pure: no database. */
export function packFull(state: DbState, excluded: string[], createdBy: string, now = new Date()): Backup {
  const manifest = { ...manifestFor(state, excluded, createdBy, now), chainDepth: 0 };
  const zip = createZip(
    [
      { name: "README.txt", data: readme(manifest) },
      { name: "manifest.json", data: toJson(manifest, 2) },
      { name: "index.json", data: toJson(indexOf(state)) },
      ...Object.entries(state.tables).map(([name, t]) => ({ name: `tables/${name}.json`, data: toJson(t.rows, 2) })),
    ],
    now,
  );
  return { fileName: `auditlens-backup-${stampOf(now)}.zip`, zip, manifest };
}

export type BackupParent = { name: string; manifest: BackupManifest; index: BackupIndex };

/** A state packaged as the changes since `parent` — or null when nothing has changed. Pure. */
export function packChanges(
  state: DbState,
  excluded: string[],
  createdBy: string,
  parent: BackupParent,
  now = new Date(),
): Backup | null {
  const { delta, empty } = diffState(parent.index, state);
  if (empty) return null;
  const manifest: BackupManifest = {
    ...manifestFor(state, excluded, createdBy, now),
    kind: "changes",
    parent: parent.name,
    base: parent.manifest.kind === "changes" ? parent.manifest.base : parent.name,
    chainDepth: (parent.manifest.chainDepth ?? 0) + 1,
    changes: deltaSummary(delta),
  };
  const zip = createZip(
    [
      { name: "README.txt", data: changesReadme(manifest) },
      { name: "manifest.json", data: toJson(manifest, 2) },
      { name: "index.json", data: toJson(indexOf(state)) },
      { name: "changes.json", data: toJson(delta) },
    ],
    now,
  );
  return { fileName: `auditlens-backup-${stampOf(now)}-changes.zip`, zip, manifest };
}

/** Read the whole database and package it as a FULL backup. Reads only — never writes. */
export async function buildBackup(db: Db, createdBy: string, now = new Date()): Promise<Backup> {
  const { state, excluded } = await readDatabase(db);
  return packFull(state, excluded, createdBy, now);
}

/** Read the whole database and package what changed since `parent` — null when nothing did. */
export async function buildChangeBackup(
  db: Db,
  createdBy: string,
  parent: BackupParent,
  now = new Date(),
): Promise<Backup | null> {
  const { state, excluded } = await readDatabase(db);
  return packChanges(state, excluded, createdBy, parent, now);
}

/* ---------------- reading backups back ---------------- */

export type ParsedBackup = { manifest: BackupManifest; index: BackupIndex; state?: DbState; delta?: BackupDelta };

/** What a backup ZIP holds. A full backup carries its state; a change-only one, its delta. */
export function parseBackup(zip: Buffer, label = "This file"): ParsedBackup {
  const files = readZip(zip);
  const raw = files.get("manifest.json");
  if (!raw) throw new Error(`${label} is not an AuditLens backup — it has no manifest.json.`);
  const manifest = JSON.parse(raw.toString("utf8")) as BackupManifest;
  const json = (name: string) => {
    const f = files.get(name);
    if (!f) throw new Error(`${label} is incomplete — it has no ${name}.`);
    return JSON.parse(f.toString("utf8"));
  };
  if (manifest.kind === "changes") {
    return { manifest, index: json("index.json") as BackupIndex, delta: json("changes.json") as BackupDelta };
  }
  const state: DbState = { tables: {} };
  for (const t of manifest.tables) state.tables[t.name] = { columns: t.columns, rows: json(t.file) as Row[] };
  // Backups from before index.json existed are full, so their fingerprints can be worked out.
  const index = files.has("index.json") ? (json("index.json") as BackupIndex) : indexOf(state);
  return { manifest, index, state };
}

/** The database as of backup `name`: its full backup, with every change file up to `name` replayed.
 *  `load` fetches a backup's bytes by file name (SharePoint, or a folder of downloaded copies). */
export async function reconstruct(
  name: string,
  load: (name: string) => Promise<Buffer>,
): Promise<{ state: DbState; manifest: BackupManifest; chain: string[] }> {
  const chain: string[] = [];
  const deltas: BackupDelta[] = [];
  let manifest: BackupManifest | undefined;
  let current: string | undefined = name;
  for (let depth = 0; current; depth++) {
    if (depth > 60) throw new Error("The backup chain is too long to be a real one — refusing to follow it.");
    const parsed = parseBackup(await load(current), current);
    manifest ??= parsed.manifest;
    chain.unshift(current);
    if (parsed.state) {
      let state = parsed.state;
      for (const d of deltas) state = applyDelta(state, d);
      return { state, manifest, chain };
    }
    deltas.unshift(parsed.delta!);
    current = parsed.manifest.parent;
  }
  throw new Error(`${chain[0]} names no backup before it, and is not a full backup — the chain is broken.`);
}
