import type { WorkspaceDb } from "./db-data";

/* Deleting in the app removes a record from VIEW, never from storage.
 *
 * Every delete button in the client does the same thing it always did — drop the record from the
 * workspace document and save. The server no longer lets that omission erase anything: a stored
 * record that a save leaves out is kept, stamped `deletedAt` / `deletedBy` / `deletedByName`, and
 * from then on withheld from every payload. Internal Audit's records (tests, observations, findings,
 * risk registers) stay recoverable from the database and attributable to whoever removed them,
 * without any of the ~20 delete sites having to know.
 *
 * The two halves are inverses, like slimForClient()/graftServerHeld():
 *
 *   withoutDeleted()  strips flagged records. GET serves this, and the PUT authorizes against it —
 *                     so the write path judges a save against exactly what the client was sent,
 *                     and a hidden record's absence is never mistaken for a delete attempt.
 *   retainDeleted()   after the write is authorized, puts back every stored record the save left
 *                     out: already-flagged ones unchanged, newly removed ones with a fresh stamp.
 *
 * Server code that reads the stored document for anything other than the PUT itself (the EXCO
 * cron, the public brief, onboarding) must read withoutDeleted(stored) — a deleted brief recipient
 * must not be emailed, and a deleted brief's public link must stop working, exactly as before.
 *
 * Only id-bearing records in the collections below are tracked. A record with no id has nothing to
 * match it by; if a save drops one it is gone, as it always was.
 *
 * User accounts are not covered: they are rows in the User table, not part of this document. */

type Obj = Record<string, unknown>;

type Collection = {
  /** Path from the parent to the array — one key for a direct child array, more for an array
   *  nested inside an object (an audit's plan.tests, the document's exco.briefs). */
  path: string[];
  /** Ids are unique per kind across the whole document. That is how a record that MOVED (an
   *  observation re-homed to another report) is told apart from one that was deleted. */
  kind: string;
  children?: Collection[];
};

const COLLECTIONS: Collection[] = [
  {
    path: ["audits"],
    kind: "audit",
    children: [
      { path: ["reports"], kind: "report", children: [{ path: ["observations"], kind: "observation" }] },
      { path: ["plan", "tests"], kind: "test" },
    ],
  },
  { path: ["extFindings"], kind: "extFinding" },
  { path: ["fraudRisks"], kind: "fraudRisk", children: [{ path: ["actions"], kind: "fraudAction" }] },
  {
    path: ["processReviews"],
    kind: "processReview",
    children: [
      { path: ["findings"], kind: "procFinding" },
      { path: ["proposedSteps"], kind: "procStep" },
    ],
  },
  { path: ["auditUniverse"], kind: "auditUnit" },
  { path: ["iaSAList"], kind: "iaSa" },
  { path: ["departments"], kind: "department" },
  { path: ["exco", "recipientList"], kind: "excoRecipient" },
  { path: ["exco", "briefs"], kind: "excoBrief" },
];

export type Deleter = { id: string; name?: string };

export function isDeleted(rec: unknown): boolean {
  return !!rec && typeof rec === "object" && !!(rec as Obj).deletedAt;
}

function idOf(rec: unknown): string {
  return rec && typeof rec === "object" && (rec as Obj).id ? String((rec as Obj).id) : "";
}

function getAt(obj: Obj, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[k];
  }
  return cur;
}

/** Copy-on-write set: every object along the path is copied, nothing shared is mutated. */
function setAt(obj: Obj, path: string[], value: unknown): Obj {
  const [k, ...rest] = path;
  if (!rest.length) return { ...obj, [k]: value };
  const child = obj[k];
  const childObj = child && typeof child === "object" && !Array.isArray(child) ? (child as Obj) : {};
  return { ...obj, [k]: setAt(childObj, rest, value) };
}

/* ---------------- read side ---------------- */

function stripList(list: unknown[], children: Collection[] | undefined): unknown[] {
  let changed = false;
  const out: unknown[] = [];
  for (const r of list) {
    if (isDeleted(r)) {
      changed = true;
      continue;
    }
    const next = children ? stripRecord(r, children) : r;
    if (next !== r) changed = true;
    out.push(next);
  }
  return changed ? out : list;
}

function stripRecord(rec: unknown, specs: Collection[]): unknown {
  if (!rec || typeof rec !== "object") return rec;
  let out = rec as Obj;
  for (const spec of specs) {
    const list = getAt(out, spec.path);
    if (!Array.isArray(list)) continue;
    const next = stripList(list, spec.children);
    if (next !== list) out = setAt(out, spec.path, next);
  }
  return out;
}

/** The document as the application sees it: every deleted record removed. Returns the input
 *  unchanged (same reference) when nothing is deleted, and never mutates it. */
export function withoutDeleted(db: WorkspaceDb): WorkspaceDb {
  return stripRecord(db, COLLECTIONS) as WorkspaceDb;
}

/* ---------------- write side ---------------- */

function collectIds(rec: unknown, specs: Collection[], into: Map<string, Set<string>>): void {
  if (!rec || typeof rec !== "object") return;
  for (const spec of specs) {
    const list = getAt(rec as Obj, spec.path);
    if (!Array.isArray(list)) continue;
    let ids = into.get(spec.kind);
    if (!ids) into.set(spec.kind, (ids = new Set()));
    for (const r of list) {
      const id = idOf(r);
      if (id) ids.add(id);
      if (spec.children) collectIds(r, spec.children, into);
    }
  }
}

type Stamp = { deletedAt: string; deletedBy: string; deletedByName: string };

function mergeList(
  curList: unknown[],
  nextList: unknown[],
  spec: Collection,
  liveIds: Map<string, Set<string>>,
  stamp: Stamp,
): unknown[] {
  const curById = new Map<string, unknown>();
  for (const c of curList) {
    const id = idOf(c);
    if (id) curById.set(id, c);
  }
  const nextIds = new Set(nextList.map(idOf).filter(Boolean));
  let changed = false;

  // Records still present: carry their own deleted children across.
  const out = nextList.map((n) => {
    if (!spec.children) return n;
    const c = curById.get(idOf(n));
    if (!c) return n;
    const merged = mergeRecord(c, n, spec.children, liveIds, stamp);
    if (merged !== n) changed = true;
    return merged;
  });

  // Records the save left out: keep them, hidden.
  const live = liveIds.get(spec.kind);
  for (const c of curList) {
    const id = idOf(c);
    if (!id || nextIds.has(id)) continue;
    if (live && live.has(id)) continue; // moved under another parent, not deleted
    out.push(isDeleted(c) ? c : { ...(c as Obj), ...stamp });
    changed = true;
  }
  return changed ? out : nextList;
}

function mergeRecord(
  cur: unknown,
  next: unknown,
  specs: Collection[],
  liveIds: Map<string, Set<string>>,
  stamp: Stamp,
): unknown {
  if (!cur || typeof cur !== "object" || !next || typeof next !== "object") return next;
  let out = next as Obj;
  for (const spec of specs) {
    const curList = getAt(cur as Obj, spec.path);
    if (!Array.isArray(curList) || !curList.length) continue;
    const raw = getAt(out, spec.path);
    const nextList = Array.isArray(raw) ? raw : [];
    const merged = mergeList(curList, nextList, spec, liveIds, stamp);
    if (merged !== nextList) out = setAt(out, spec.path, merged);
  }
  return out;
}

/** Put back every stored record that `next` (the authorized document about to be written) left
 *  out — flagged as deleted, with who and when for the ones this save removed. */
export function retainDeleted(current: WorkspaceDb, next: WorkspaceDb, by: Deleter): WorkspaceDb {
  const liveIds = new Map<string, Set<string>>();
  collectIds(next, COLLECTIONS, liveIds);
  const stamp: Stamp = {
    deletedAt: new Date().toISOString(),
    deletedBy: by.id,
    deletedByName: by.name || "",
  };
  return mergeRecord(current, next, COLLECTIONS, liveIds, stamp) as WorkspaceDb;
}
