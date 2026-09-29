// The renumbering itself, for scripts/renumber-obs-refs.mts — kept apart from the script's I/O so
// it can be exercised against a copy of the live document without touching the database.
//
// renumberObservationRefs() mutates the document it is given and reports what it did. See the
// script's header for the rules; in short: new-format references are never touched, the rest are
// numbered per department per year in raise order around them, each keeps its old reference as
// legacyRef, and repeat-of citations and pending proposals follow.

import { deptNameOf } from "../lib/dept-scope";
import type { WorkspaceDb } from "../lib/workspace/types";
import { obsRefCode, obsRefCodes } from "../lib/workspace/obs-validation";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown) => String(v ?? "").trim();

/** The shape of a DEPT/YEAR/NNN reference. Codes come from obsRefCode(): 1–5 letters or digits. */
export const NEW_FORMAT = /^([A-Z0-9]{1,5})\/(\d{4})\/(\d{3,})$/;

/** The scheme began on 2026-09-29, so nothing it issued carries an earlier year. */
const FIRST_YEAR = 2026;

/** Whether a reference was issued by the new scheme — its shape alone is not enough: the AI
 *  drafter invented "P2P/2024/001" for a finding raised in September 2026, and it would otherwise
 *  have been kept as if it were one of ours. It must also carry a code the scheme can produce and a
 *  year the scheme existed in. */
export function isIssuedRef(ref: string, codes: ReadonlySet<string>): boolean {
  const m = NEW_FORMAT.exec(ref);
  return !!m && codes.has(m[1]) && Number(m[2]) >= FIRST_YEAR;
}

export type Renumbered = {
  o: Obj;
  audit: string;
  report: string;
  old: string;
  dept: string;
  code: string;
  year: number;
  /** raisedAt, else createdAt, else the report date — what the order within a sequence follows. */
  when: string;
  /** N of an old N.1 counter ref: the tie-break that keeps the backlog in workbook order. */
  counter: number;
  order: number;
  next: string;
};

export type RenumberResult = {
  live: number;
  deleted: number;
  /** In new-reference order. */
  renumbered: Renumbered[];
  groups: { department: string; sequence: string; count: number; first: string; last: string; alreadyIssued: number }[];
  repeatOf: { observation: string; from: string; to: string }[];
  /** Repeat-of text that cites no reference we could resolve — for a person to check. */
  repeatOfKept: { observation: string; text: string }[];
  proposals: { kind: string; observation: string; from: string; to: string }[];
  /** Old references carried by more than one observation; a citation of one is left as written. */
  ambiguous: Renumbered[];
};

function yearOf(when: string): number {
  const y = Number(when.slice(0, 4));
  return y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
}

/** The repeat-of text with an old reference swapped for its new one, or null when it cites none.
 *  Three shapes are written: the raise wizard's picker ("22.1 — title"), the AI repeat scan
 *  ("[23.1]"), and a bare ref typed by hand. The report-level suggestion ("IA/2026/003 (Q1 2026) —
 *  title") names a report, not an observation, so it never matches. */
export function rewriteRepeatOf(v: string, lookup: (ref: string) => string | null): string | null {
  const s = v.trim();
  let m = /^\[\s*([^\]]+?)\s*\]$/.exec(s);
  if (m) {
    const to = lookup(m[1]);
    return to ? `[${to}]` : null;
  }
  m = /^(\S+)\s+—\s+(.+)$/.exec(s);
  if (m) {
    const to = lookup(m[1]);
    return to ? `${to} — ${m[2]}` : null;
  }
  return lookup(s);
}

export function renumberObservationRefs(db: Obj): RenumberResult {
  const live: { o: Obj; audit: string; report: string; r: Obj }[] = [];
  let deleted = 0;
  for (const a of arr(db.audits))
    for (const r of arr(a.reports))
      for (const o of arr(r.observations)) {
        if (a.deletedAt || r.deletedAt || o.deletedAt) {
          deleted++;
          continue;
        }
        live.push({ o, audit: str(a.name), report: str(r.title), r });
      }

  // Numbers already issued in the new format are fixed; everything else is numbered around them.
  const codes = obsRefCodes(db as WorkspaceDb);
  const taken = new Map<string, Set<number>>();
  const legacy: Renumbered[] = [];
  live.forEach(({ o, audit, report, r }, order) => {
    const ref = str(o.ref);
    const m = isIssuedRef(ref, codes) ? NEW_FORMAT.exec(ref) : null;
    if (m) {
      const key = `${m[1]}/${m[2]}`;
      if (!taken.has(key)) taken.set(key, new Set());
      taken.get(key)!.add(Number(m[3]));
      return;
    }
    const dept = deptNameOf(db, o);
    const when = str(o.raisedAt) || str(o.createdAt) || str(r.reportDateISO);
    const counter = /^(\d+)\.\d+$/.exec(ref);
    legacy.push({
      o,
      audit,
      report,
      old: ref,
      dept,
      code: obsRefCode(dept),
      year: yearOf(when),
      when,
      counter: counter ? Number(counter[1]) : Number.MAX_SAFE_INTEGER,
      order,
      next: "",
    });
  });

  const byGroup = new Map<string, Renumbered[]>();
  for (const it of legacy) {
    const key = `${it.code}/${it.year}`;
    byGroup.set(key, [...(byGroup.get(key) || []), it]);
  }
  const groups: RenumberResult["groups"] = [];
  for (const [key, items] of [...byGroup].sort((x, y) => x[0].localeCompare(y[0]))) {
    items.sort(
      (a, b) =>
        (a.when || "9999").localeCompare(b.when || "9999") || a.counter - b.counter || a.order - b.order,
    );
    const used = taken.get(key) || new Set<number>();
    const alreadyIssued = used.size;
    let n = 0;
    for (const it of items) {
      do {
        n++;
      } while (used.has(n));
      used.add(n);
      it.next = `${key}/${String(n).padStart(3, "0")}`;
    }
    groups.push({
      department: items[0].dept || "(none)",
      sequence: key,
      count: items.length,
      first: items[0].next,
      last: items[items.length - 1].next,
      alreadyIssued,
    });
  }

  // Old → new, for rewriting citations. An old ref shared by two observations cites neither.
  const byOld = new Map<string, Renumbered[]>();
  for (const it of legacy) {
    if (!it.old) continue;
    const k = it.old.toLowerCase();
    byOld.set(k, [...(byOld.get(k) || []), it]);
  }
  const lookup = (ref: string): string | null => {
    const hits = byOld.get(ref.trim().toLowerCase());
    return hits && hits.length === 1 ? hits[0].next : null;
  };

  const newRefOf = new Map(legacy.map((it) => [str(it.o.id), it.next]));
  const labelOf = (o: Obj) => newRefOf.get(str(o.id)) || str(o.ref);

  const repeatOf: RenumberResult["repeatOf"] = [];
  const repeatOfKept: RenumberResult["repeatOfKept"] = [];
  for (const { o } of live) {
    const v = str(o.repeatOf);
    if (!v) continue;
    const to = rewriteRepeatOf(v, lookup);
    if (to && to !== v) {
      repeatOf.push({ observation: labelOf(o), from: v, to });
      o.repeatOf = to;
    } else if (!to && !/[A-Z0-9]{1,5}\/\d{4}\/\d{3,}/.test(v)) {
      // Text already naming a new-format (or report) reference is fine as it is.
      repeatOfKept.push({ observation: labelOf(o), text: v });
    }
  }

  const proposals: RenumberResult["proposals"] = [];
  for (const ap of arr(db.approvals)) {
    if (ap.status !== "pending" || !ap.changes || typeof ap.changes !== "object") continue;
    const ch = ap.changes as Obj;
    const to = newRefOf.get(str(ap.obsId));
    if (!("ref" in ch) || !to || ch.ref === to) continue;
    proposals.push({ kind: str(ap.kind), observation: str(ap.obsTitle), from: str(ch.ref), to });
    ch.ref = to;
  }

  for (const it of legacy) {
    if (it.old && !str(it.o.legacyRef)) it.o.legacyRef = it.old;
    it.o.ref = it.next;
  }

  return {
    live: live.length,
    deleted,
    renumbered: [...legacy].sort((a, b) => a.next.localeCompare(b.next, undefined, { numeric: true })),
    groups,
    repeatOf,
    repeatOfKept,
    proposals,
    ambiguous: [...byOld.values()].filter((v) => v.length > 1).flat(),
  };
}
