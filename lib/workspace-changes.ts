import type { WorkspaceDb } from "./db-data";

/* What a workspace save changed, described for the audit trail.
 *
 * WHY THIS EXISTS. The whole workspace is one JSON document that the browser overwrites on every
 * save (lib/workspace-authz.ts explains what that means for authorization). The audit trail used
 * to be written by the browser as well: each screen called logAudit() straight after mutate(),
 * before the debounced save had even run. So the trail recorded what the browser INTENDED —
 * including changes that a 409 conflict then refused and changes the authorization reconcilers
 * reverted — and recorded nothing at all for any edit whose screen never called it. A crafted
 * client could leave it out, or report something that never happened.
 *
 * Now app/api/data/route.ts diffs the stored document before the write against the document it
 * actually wrote (after authorization and the server-held grafts) and records one entry per
 * meaningful change, against the verified session. The trail is only ever what persisted.
 *
 * WHAT COUNTS. Records created, deleted and edited, and each step of the review workflows —
 * raise, approve, respond, verify, return, close, withdraw — named as that step rather than as a
 * list of fields. NOT view state that happens to live in the document (the plan year on screen,
 * which self-assessment is open, notification read flags): changing those is a click.
 *
 * HOSTILE INPUT. The document is untyped JSON that browsers have edited for years, and some of it
 * any signed-in user can shape (their own approval requests, their comments). Nothing here may
 * throw on it — a throw would drop the whole save's entries, which would make "put something odd
 * in the document" a way to act unrecorded. So values are read as own properties only, text is
 * taken only from scalars, recursion is depth-capped, and each section runs behind a net that
 * records, visibly, that part of the save could not be itemised.
 *
 * Pure and synchronous, no I/O — scripts/workspace-changes.test.mts drives it directly.
 */

type Obj = Record<string, unknown>;

export type FieldChange = { field: string; label: string; from: string; to: string };

export type ChangeEvent = {
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
};

/** An entry being assembled. `bulk` marks it as one of a kind that a single save can create or
 *  delete dozens of at once (a CSV import, an AI-generated plan, deleting an annual plan) — past
 *  BULK_THRESHOLD those become one entry listing them, instead of dozens. */
type Draft = ChangeEvent & { bulk?: { text: string; id: string; title: string } };

const BULK_THRESHOLD = 10;
/** A save touching more than this is a migration or a restore rather than someone working. The
 *  first entries are kept and one more says how many were left out, so the write stays bounded. */
const MAX_EVENTS = 150;
/** Deeper than any real record nests. Past it, values are compared by their serialisation. */
const MAX_DEPTH = 40;

/* ------------------------------------------------------------------ values */

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const NONE: ReadonlySet<string> = new Set();

/** Text of a scalar. Anything else — an object smuggled in where a name belongs — reads as blank:
 *  String() on `{toString: 0}` throws. */
function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** A record's OWN value for a key. Keys come from the documents themselves, and `record[key]` for
 *  one named "valueOf" or "constructor" would otherwise reach Object.prototype. */
function own(o: unknown, k: string): unknown {
  return isObj(o) && hasOwn(o, k) ? o[k] : undefined;
}

/** A fixed table looked up by a key that came from a document — own entries only, same reason. */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return hasOwn(table, key) ? table[key] : undefined;
}

function isBlank(v: unknown, depth = 0): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return depth < MAX_DEPTH && Object.values(v).every((x) => isBlank(x, depth + 1));
  return false;
}

/** Comparison form: key order ignored and blank members dropped, so a save that merely
 *  re-serialises a record — `{a: ""}` for `{}`, `null` for a missing field — is not a change. */
function canon(v: unknown, depth = 0): unknown {
  if (isBlank(v, depth)) return null;
  if (depth >= MAX_DEPTH) return safeJson(v);
  if (Array.isArray(v)) return v.map((x) => canon(x, depth + 1));
  if (isObj(v)) {
    const out: Obj = {};
    for (const k of Object.keys(v).sort()) {
      if (!isBlank(v[k], depth + 1)) out[k] = canon(v[k], depth + 1);
    }
    return out;
  }
  return v;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

function same(x: unknown, y: unknown): boolean {
  return safeJson(canon(x)) === safeJson(canon(y));
}

/** Fast path: a record the save never touched serialises byte-for-byte the same. */
function untouched(x: unknown, y: unknown): boolean {
  return x === y || safeJson(x) === safeJson(y);
}

/** Fields whose value differs between two versions of a record. `_`-prefixed keys are client
 *  bookkeeping and never count. */
function changedFields(x: Obj, y: Obj, ignore: ReadonlySet<string> = NONE): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(y), ...Object.keys(x)])) {
    if (ignore.has(k) || k.startsWith("_")) continue;
    if (!same(own(x, k), own(y, k))) out.push(k);
  }
  return out;
}

/** Records by id, first occurrence winning. */
function byId(list: Obj[]): Map<string, Obj> {
  const m = new Map<string, Obj>();
  for (const x of list) {
    const id = str(x.id);
    if (id && !m.has(id)) m.set(id, x);
  }
  return m;
}

/* ------------------------------------------------------------------ wording */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-30" and ISO timestamps read as "30 Sep 2026"; anything else is returned as is. */
function asDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s.trim());
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && mon ? `${Number(m[3])} ${mon} ${m[1]}` : s;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

const quoted = (s: string) => `“${s}”`;

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A value as it reads inside a sentence. */
function show(v: unknown, n = 60): string {
  if (isBlank(v)) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return clip(asDate(v), n);
  if (Array.isArray(v)) return plural(v.length, "item");
  return "(details)";
}

/** A value as it is kept in the entry's metadata: enough to see what it was, bounded in size. */
function detail(v: unknown): string {
  if (isBlank(v)) return "";
  if (typeof v === "string") return clip(v, 400);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const names = v
      .map((x) => (isObj(x) ? str(own(x, "name")) || str(own(x, "title")) || str(own(x, "text")) || str(own(x, "id")) : str(x)))
      .filter(Boolean);
    return clip(names.length ? names.join(", ") : plural(v.length, "item"), 400);
  }
  return clip(safeJson(v) || "(unreadable value)", 400);
}

/** Short enough to quote inline as "from → to"; long text is named instead. */
function inline(v: unknown): boolean {
  return (
    isBlank(v) ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    (typeof v === "string" && v.length <= 40 && !v.includes("\n"))
  );
}

const LABELS: Readonly<Record<string, string>> = {
  // observations & external findings
  ref: "reference", rootCause: "root cause", sopUpdate: "SOP update",
  managementResponse: "management response", dueDate: "due date", isRepeat: "repeat finding",
  repeatOf: "repeat of", attachments: "supporting documents", ownerResponse: "owner's response",
  ownerResponseEvidence: "owner's evidence", closureNote: "closure note",
  closureEvidence: "closure evidence", closureFile: "closure file", closureFiles: "closure evidence",
  closedDateISO: "closure date", closureDate: "closure date", sourceRef: "source reference",
  targetDate: "target date", obsApproval: "approval", rejectionFinal: "final rejection", withdrawal: "withdrawal request",
  raisedBy: "raised by (account)", raisedByName: "raised by", raisedAt: "raised on",
  ownerRectifiedBy: "responded by (account)", ownerRectifiedByName: "responded by",
  ownerRectifiedAt: "response submitted", reportVerifiedBy: "verified by (account)",
  reportVerifiedByName: "verified by", reportVerifiedAt: "verified on",
  headVerifiedBy: "signed off by (account)", headVerifiedByName: "signed off by",
  headVerifiedAt: "signed off on", verifiedBy: "verified by (legacy)",
  updateRequestedAt: "update requested", updateRequestedBy: "update requested by",
  progressReport: "progress report request", closureRejection: "return note", createdAt: "created",
  // audits, reports, tests
  leadAuditor: "lead auditor", refNo: "reference no.", reportDate: "report date",
  reportDateISO: "report date", outOfScope: "out of scope",
  areasForImprovement: "areas for improvement", auditOpinion: "audit opinion",
  assuranceLevel: "assurance level", execSummaryNarrative: "executive summary",
  keyRisks: "key risks", controlTested: "control tested", sampleBasis: "sample basis",
  resultNotes: "what was found", evidenceRef: "working-paper reference", testedBy: "tested by",
  testedDate: "test date",
  // fraud
  existingControls: "existing controls", controlStrength: "control strength",
  residualOverride: "residual rating override", preventionAction: "prevention action",
  text: "action", validationNote: "IA validation note", validationEvidence: "IA validation files",
  // annual plan
  factors: "risk factors", lastAudited: "last audited", plannedPeriod: "planned period",
  includeInPlan: "include in plan", engStatus: "engagement status", occDone: "quarters done",
  linkedAuditIds: "linked audits", linkedAuditId: "linked audit", ratingOverride: "rating override",
  frequencyOverride: "frequency override", carryOverFrom: "carried over from",
  // process reviews
  sopTitle: "SOP title", sopFileName: "SOP document", overallRating: "overall rating",
  keyRecommendations: "key recommendations", proposedSummary: "proposed summary",
  proposedSteps: "proposed process steps",
  // self-assessment
  lastEQA: "last external assessment", qaip: "improvement programme",
  // departments, brief, settings
  headName: "head", headEmail: "head's e-mail", headUserId: "head's account",
  org: "organisation name", signOffName: "sign-off name", signOffTitle: "sign-off title",
  strictClosureCheck: "strict closure check", subject: "e-mail subject", cc: "e-mail copy list",
};

function label(field: string): string {
  return lookup(LABELS, field) || field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

/** "criticality High → Critical; due date 30 Sep 2026 → 31 Oct 2026; description" plus the
 *  structured list the log viewer shows as a before/after table. */
function describeFields(x: Obj, y: Obj, fields: string[]): { text: string; changes: FieldChange[] } {
  const parts: string[] = [];
  const changes: FieldChange[] = [];
  for (const f of fields) {
    const from = own(x, f);
    const to = own(y, f);
    changes.push({ field: f, label: label(f), from: detail(from), to: detail(to) });
    parts.push(inline(from) && inline(to) ? `${label(f)} ${show(from)} → ${show(to)}` : label(f));
  }
  return { text: clip(parts.join("; "), 320), changes };
}

function named(v: unknown, fallback: string): string {
  const s = clip(str(v), 90);
  return s ? quoted(s) : fallback;
}

/** An observation or finding as the trail names it: `19.1 “Weak access controls”`. */
function itemName(o: Obj): string {
  const title = named(o.title, "(untitled)");
  const ref = clip(str(o.ref), 20);
  return ref ? `${ref} ${title}` : title;
}

function excerpt(v: unknown, n = 140): string {
  const s = clip(str(v), n);
  return s ? `: ${quoted(s)}` : "";
}

/** " — 2 files attached", or nothing. */
function attached(files: unknown[]): string {
  return files.length ? ` — ${plural(files.length, "file")} attached` : "";
}

function paren(parts: unknown[]): string {
  const s = parts.map(str).filter(Boolean).join(", ");
  return s ? ` (${s})` : "";
}

/* ------------------------------------------------------------------ entry point */

export function describeWorkspaceChanges(
  before: WorkspaceDb | null | undefined,
  after: WorkspaceDb | null | undefined,
): ChangeEvent[] {
  const b = (isObj(before) ? before : {}) as Obj;
  const a = (isObj(after) ? after : {}) as Obj;
  const depts = new Map<string, string>();
  for (const d of [...arr(b.departments), ...arr(a.departments)]) {
    if (str(d.id)) depts.set(str(d.id), str(d.name));
  }
  const dept = (id: unknown) => (str(id) ? depts.get(str(id)) || str(id) : "—");

  const out: Draft[] = [];
  const sections: [name: string, run: () => void][] = [
    ["audits", () => diffAuditTree(b, a, dept, out)],
    ["external findings", () => diffExtFindings(b, a, dept, out)],
    ["fraud register", () => diffFraud(b, a, out)],
    ["annual plan", () => diffUniverse(b, a, out)],
    ["process reviews", () => diffProcessReviews(b, a, out)],
    ["self-assessments", () => diffSelfAssessments(b, a, out)],
    ["approvals", () => diffApprovals(b, a, out)],
    ["departments", () => diffDepartments(b, a, out)],
    ["executive brief", () => diffExco(b, a, out)],
    ["settings", () => diffSettings(b, a, out)],
  ];
  /* The net. Entries already produced for a section stand — each describes one record on its own —
     and the failure itself becomes an entry, so a save cannot go unrecorded by being odd. */
  const unreadable: string[] = [];
  for (const [name, run] of sections) {
    try {
      run();
    } catch (e) {
      unreadable.push(`${name}: ${e instanceof Error ? clip(e.message, 200) : "unknown error"}`);
    }
  }
  const events = finalize(out);
  if (unreadable.length) {
    events.push({
      action: "security.changes_unreadable",
      summary:
        `Part of this save could not be itemised (${unreadable.map((u) => u.split(":")[0]).join(", ")})` +
        " — the save was stored, but what it changed there is not listed",
      metadata: { errors: unreadable },
    });
  }
  return events;
}

/* ------------------------------------------------------------------ audits, reports, observations */

type Tree = {
  audits: Map<string, Obj>;
  reports: Map<string, { r: Obj; audit: Obj }>;
  obs: Map<string, { o: Obj; report: Obj; audit: Obj }>;
};

/** Every audit, report and observation by id. Reports and observations are keyed across the whole
 *  tree, so one that moves is an update rather than a delete plus a create. */
function indexTree(db: Obj): Tree {
  const t: Tree = { audits: new Map(), reports: new Map(), obs: new Map() };
  for (const audit of arr(db.audits)) {
    const aid = str(audit.id);
    if (!aid || t.audits.has(aid)) continue;
    t.audits.set(aid, audit);
    for (const r of arr(audit.reports)) {
      const rid = str(r.id);
      if (!rid || t.reports.has(rid)) continue;
      t.reports.set(rid, { r, audit });
      for (const o of arr(r.observations)) {
        const oid = str(o.id);
        if (oid && !t.obs.has(oid)) t.obs.set(oid, { o, report: r, audit });
      }
    }
  }
  return t;
}

const AUDIT_IGNORE = new Set(["id", "reports", "plan", "tor", "createdAt"]);
const REPORT_IGNORE = new Set(["id", "observations", "createdAt"]);

function diffAuditTree(b: Obj, a: Obj, dept: (id: unknown) => string, out: Draft[]): void {
  const B = indexTree(b);
  const A = indexTree(a);

  for (const [id, audit] of A.audits) {
    const prev = B.audits.get(id);
    const meta = { entity: "audit", auditId: id, title: str(audit.name) };
    if (!prev) {
      out.push({
        action: "audit.created",
        summary: `Created audit ${named(audit.name, "(unnamed)")}${paren([audit.type, audit.period])}`,
        metadata: meta,
        bulk: { text: "Created {n} audits", id, title: str(audit.name) },
      });
    } else {
      auditUpdated(prev, audit, meta, out);
    }
  }
  for (const [id, audit] of B.audits) {
    if (A.audits.has(id)) continue;
    const reports = arr(audit.reports);
    const obs = reports.flatMap((r) => arr(r.observations));
    out.push({
      action: "audit.deleted",
      summary:
        `Deleted audit ${named(audit.name, "(unnamed)")}` +
        (reports.length || obs.length
          ? ` — with ${plural(reports.length, "report")} and ${plural(obs.length, "observation")}`
          : ""),
      // What went with it, so the trail still says what was lost.
      metadata: {
        entity: "audit",
        auditId: id,
        title: str(audit.name),
        reports: reports.slice(0, 50).map((r) => ({ id: str(r.id), title: str(r.title) })),
        observations: obs.slice(0, 200).map((o) => ({ id: str(o.id), ref: str(o.ref), title: str(o.title) })),
      },
      bulk: { text: "Deleted {n} audits", id, title: str(audit.name) },
    });
  }

  for (const [id, { r, audit }] of A.reports) {
    const prev = B.reports.get(id);
    const where = ` in ${named(audit.name, "an audit")}`;
    const meta = { entity: "report", reportId: id, auditId: str(audit.id), title: str(r.title) };
    if (!prev) {
      out.push({
        action: "report.created",
        summary: `Created report ${named(r.title, "(untitled)")}${where}`,
        metadata: meta,
        bulk: { text: "Created {n} reports", id, title: str(r.title) },
      });
      continue;
    }
    const fields = changedFields(prev.r, r, REPORT_IGNORE);
    const moved = str(prev.audit.id) !== str(audit.id);
    if (!fields.length && !moved) continue;
    const d = describeFields(prev.r, r, fields);
    const parts = [moved ? `moved from ${named(prev.audit.name, "another audit")}` : "", d.text].filter(Boolean);
    out.push({
      action: "report.updated",
      summary: `Updated report ${named(r.title, "(untitled)")}${where}: ${parts.join("; ")}`,
      metadata: { ...meta, changes: d.changes, ...(moved ? { fromAuditId: str(prev.audit.id) } : {}) },
    });
  }
  for (const [id, { r, audit }] of B.reports) {
    if (A.reports.has(id) || !A.audits.has(str(audit.id))) continue; // gone with its audit
    const obs = arr(r.observations);
    out.push({
      action: "report.deleted",
      summary:
        `Deleted report ${named(r.title, "(untitled)")} in ${named(audit.name, "an audit")}` +
        (obs.length ? ` — with ${plural(obs.length, "observation")}` : ""),
      metadata: {
        entity: "report",
        reportId: id,
        auditId: str(audit.id),
        title: str(r.title),
        observations: obs.slice(0, 200).map((o) => ({ id: str(o.id), ref: str(o.ref), title: str(o.title) })),
      },
    });
  }

  for (const [id, at] of A.obs) {
    const prev = B.obs.get(id);
    const where = ` in ${named(at.audit.name, "an audit")}`;
    const meta = {
      entity: "observation",
      observationId: id,
      auditId: str(at.audit.id),
      reportId: str(at.report.id),
      ref: str(at.o.ref),
      title: str(at.o.title),
    };
    if (!prev) {
      itemCreated(OBS_KIND, at.o, where, meta, out);
      continue;
    }
    if (str(prev.report.id) !== str(at.report.id)) {
      out.push({
        action: "obs.moved",
        summary:
          `Moved observation ${itemName(at.o)} from report ${named(prev.report.title, "(untitled)")}` +
          ` to ${named(at.report.title, "(untitled)")}${where}`,
        metadata: { ...meta, fromReportId: str(prev.report.id), fromAuditId: str(prev.audit.id) },
      });
    }
    itemUpdated(OBS_KIND, prev.o, at.o, where, meta, dept, out);
  }
  for (const [id, at] of B.obs) {
    if (A.obs.has(id) || !A.reports.has(str(at.report.id))) continue; // gone with its report
    itemDeleted(OBS_KIND, at.o, ` in ${named(at.audit.name, "an audit")}`, {
      entity: "observation",
      observationId: id,
      auditId: str(at.audit.id),
      reportId: str(at.report.id),
      ref: str(at.o.ref),
      title: str(at.o.title),
    }, out);
  }
}

function auditUpdated(prev: Obj, audit: Obj, meta: Obj, out: Draft[]): void {
  const name = named(audit.name, "(unnamed)");

  /* Name, type, area, period, status, lead auditor. The lead auditor is stored twice (id and
     name) and read once, by name — reassigning it is recorded again as a security notice by the
     authorization layer when audit staff do it, because it grants the sign-off right. */
  const fields = changedFields(prev, audit, AUDIT_IGNORE);
  const shown = fields.includes("leadAuditorId")
    ? [...new Set(fields.map((f) => (f === "leadAuditorId" ? "leadAuditor" : f)))]
    : fields;
  if (shown.length) {
    const d = describeFields(prev, audit, shown);
    out.push({ action: "audit.updated", summary: `Updated audit ${name}: ${d.text}`, metadata: { ...meta, changes: d.changes } });
  }

  const torB = isObj(prev.tor) ? prev.tor : {};
  const torA = isObj(audit.tor) ? audit.tor : {};
  const torFields = changedFields(torB, torA);
  if (torFields.length) {
    const d = describeFields(torB, torA, torFields);
    out.push({
      action: "audit.tor_updated",
      summary: `Updated the terms of reference for ${name}: ${clip(torFields.map(label).join(", "), 200)}`,
      metadata: { ...meta, changes: d.changes },
    });
  }

  const planB = isObj(prev.plan) ? prev.plan : {};
  const planA = isObj(audit.plan) ? audit.plan : {};
  const planFields = changedFields(planB, planA, new Set(["tests"]));
  if (planFields.length) {
    const d = describeFields(planB, planA, planFields);
    out.push({
      action: "audit.plan_updated",
      summary: `Updated the audit programme for ${name}: ${clip(planFields.map(label).join(", "), 200)}`,
      metadata: { ...meta, changes: d.changes },
    });
  }
  diffTests(arr(planB.tests), arr(planA.tests), name, meta, out);
}

function testName(t: Obj): string {
  const title = clip(str(t.title) || str(t.name), 70);
  return [clip(str(t.ref), 12), title ? quoted(title) : ""].filter(Boolean).join(" ") || "a test";
}

/* Tests carry legacy/new field-name pairs that the app writes together (see AuditTest in
   lib/workspace/types.ts): an edit changes both, and should be reported once. */
const TEST_MIRRORS: Readonly<Record<string, string>> = { name: "title", control: "controlTested", notes: "resultNotes" };
const TEST_FIELDWORK = new Set(["result", "resultNotes", "testedBy", "testedDate", "evidenceRef"]);

function diffTests(before: Obj[], after: Obj[], auditName: string, meta: Obj, out: Draft[]): void {
  const B = byId(before);
  const A = byId(after);
  for (const [id, t] of A) {
    const prev = B.get(id);
    const m = { ...meta, testId: id, testRef: str(t.ref) };
    if (!prev) {
      out.push({
        action: "audit.test_added",
        summary: `Added test ${testName(t)} to ${auditName}`,
        metadata: m,
        bulk: { text: `Added {n} tests to ${auditName}`, id, title: str(t.ref) || str(t.title) || str(t.name) },
      });
      continue;
    }
    if (untouched(prev, t)) continue;
    const fields = [...new Set(changedFields(prev, t).map((f) => lookup(TEST_MIRRORS, f) || f))];
    const fieldwork = fields.filter((f) => TEST_FIELDWORK.has(f));
    const design = fields.filter((f) => !TEST_FIELDWORK.has(f));
    if (fieldwork.length) {
      const d = describeFields(prev, t, fieldwork);
      out.push({
        action: "audit.test_result",
        summary: fieldwork.includes("result")
          ? `Recorded the result of test ${testName(t)} in ${auditName}: ${show(prev.result)} → ${show(t.result)}`
          : `Updated the fieldwork for test ${testName(t)} in ${auditName}: ${d.text}`,
        metadata: { ...m, changes: d.changes },
      });
    }
    if (design.length) {
      const d = describeFields(prev, t, design);
      out.push({
        action: "audit.test_updated",
        summary: `Edited test ${testName(t)} in ${auditName}: ${d.text}`,
        metadata: { ...m, changes: d.changes },
      });
    }
  }
  for (const [id, t] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "audit.test_deleted",
      summary: `Deleted test ${testName(t)} from ${auditName}`,
      metadata: { ...meta, testId: id, testRef: str(t.ref) },
      bulk: { text: `Deleted {n} tests from ${auditName}`, id, title: str(t.ref) || str(t.title) || str(t.name) },
    });
  }
}

/* ------------------------------------------------------------------ observations & external findings */

type ItemKind = { prefix: "obs" | "ext"; noun: string; plural: string };
const OBS_KIND: ItemKind = { prefix: "obs", noun: "observation", plural: "observations" };
const EXT_KIND: ItemKind = { prefix: "ext", noun: "external finding", plural: "external findings" };

/* Each step's stamps travel with it: the step's entry already says who did it and when, so they
   are not reported again. A stamp that changes WITHOUT its step — "raised by" rewritten on a closed
   finding, say — is claimed by nothing and falls through to an edit, where it is seen. */
const OWNER_FIELDS = ["owner", "ownerUserId", "secondaryOwner", "secondaryOwnerUserId", "departmentId"];
const RESPONSE_STAMPS = ["ownerRectifiedAt", "ownerRectifiedBy", "ownerRectifiedByName"];
const VERIFY_STAMPS = ["reportVerifiedAt", "reportVerifiedBy", "reportVerifiedByName"];
const SIGNOFF_STAMPS = ["headVerifiedAt", "headVerifiedBy", "headVerifiedByName", "verifiedBy"];
const CLOSURE_EVIDENCE = ["closureNote", "closureEvidence", "closureFile", "closureFiles"];

type WithdrawalStep = { event: string; verb: string; reason: string };
const WITHDRAWAL_STEPS: Readonly<Record<string, WithdrawalStep>> = {
  owner_requested: { event: "review_requested", verb: "Requested the withdrawal of", reason: "ownerReason" },
  forwarded: { event: "withdraw_forwarded", verb: "Forwarded to the Head for withdrawal:", reason: "forwardNote" },
  declined: { event: "review_declined", verb: "Declined the withdrawal request for", reason: "declineReason" },
  withdrawn: { event: "withdrawn", verb: "Withdrew", reason: "headReason" },
  rejected: { event: "withdraw_rejected", verb: "Rejected the withdrawal of", reason: "headReason" },
};

const stageOf = (o: Obj) => str(own(o.withdrawal, "stage"));
const isClosed = (o: Obj) => str(o.status) === "Closed";

/** The fields that identify a record after it is gone. */
function itemSnapshot(o: Obj): Obj {
  const keep = ["ref", "title", "criticality", "severity", "source", "status", "owner", "dueDate", "targetDate", "obsApproval"];
  return Object.fromEntries(keep.filter((k) => str(own(o, k))).map((k) => [k, str(own(o, k))]));
}

function itemCreated(kind: ItemKind, o: Obj, where: string, meta: Obj, out: Draft[]): void {
  const p = kind.prefix;
  const pending = p === "obs" && str(o.obsApproval) === "pending";
  const action = p === "ext" ? "ext.raised" : pending ? "obs.raise_requested" : "obs.raised";
  const verb =
    p === "ext" ? "Added external finding" : pending ? "Raised for the Head's approval: observation" : "Raised observation";
  out.push({
    action,
    summary:
      `${verb} ${itemName(o)}${where}` +
      paren([str(o.criticality) || str(o.severity), o.source, str(o.owner) ? `owner ${str(o.owner)}` : ""]),
    metadata: { ...meta, snapshot: itemSnapshot(o) },
    bulk: {
      text: p === "ext" ? "Added {n} external findings" : pending ? "Raised {n} observations for approval" : "Raised {n} observations",
      id: str(o.id),
      title: str(o.title),
    },
  });
}

function itemDeleted(kind: ItemKind, o: Obj, where: string, meta: Obj, out: Draft[]): void {
  out.push({
    action: `${kind.prefix}.deleted`,
    summary: `Deleted ${kind.noun} ${itemName(o)}${where}`,
    metadata: { ...meta, snapshot: itemSnapshot(o) },
    bulk: { text: `Deleted {n} ${kind.plural}`, id: str(o.id), title: str(o.title) },
  });
}

/* One save can carry several workflow steps at once (the Head approving an edit that also closes
   the item, say). Each step is recognised from the field that defines it, reported as that step,
   and claims its fields so they are not reported a second time. Whatever nobody claims is an edit
   to the record — including a stamp that moved without its step. */
function itemUpdated(
  kind: ItemKind,
  b: Obj,
  a: Obj,
  where: string,
  meta: Obj,
  dept: (id: unknown) => string,
  out: Draft[],
): void {
  if (untouched(b, a)) return;
  const p = kind.prefix;
  const name = itemName(a);
  const changed = new Set(changedFields(b, a, new Set(["id"])));
  if (!changed.size) return;
  const claim = (...fields: string[]) => fields.forEach((f) => changed.delete(f));
  const push = (event: string, summary: string, extra: Obj = {}) =>
    out.push({ action: `${p}.${event}`, summary, metadata: { ...meta, ...extra } });
  const setNow = (f: string) => changed.has(f) && isBlank(b[f]) && !isBlank(a[f]);
  const cleared = (f: string) => changed.has(f) && !isBlank(b[f]) && isBlank(a[f]);

  // The Head deciding on an observation Internal Audit raised for approval.
  // A rejection either sends the raise back for changes or, with rejectionFinal, closes it.
  if (changed.has("obsApproval")) {
    const to = str(a.obsApproval);
    if (to === "approved") push("approved", `Approved ${kind.noun} ${name}${where}`);
    else if (to === "rejected")
      push(
        "rejected",
        a.rejectionFinal === true
          ? `Rejected ${kind.noun} ${name}${where} for good — no further action`
          : `Rejected ${kind.noun} ${name}${where} and sent it back for changes`,
      );
    else if (to === "pending") push("raise_requested", `Resubmitted ${kind.noun} ${name} for the Head's approval${where}`);
    if (to === "approved" || to === "rejected" || to === "pending") claim("obsApproval", "rejectionFinal");
  }
  // The Head revisiting an existing rejection (reopening it for changes) without re-deciding it.
  if (changed.has("rejectionFinal")) {
    push(
      "edited",
      a.rejectionFinal === true
        ? `Closed the rejected ${kind.noun} ${name}${where} — no further action`
        : `Reopened the rejected ${kind.noun} ${name}${where} for changes`,
    );
    claim("rejectionFinal");
  }

  // Withdrawal: owner asks → Internal Audit forwards or declines → the Head decides. A note edited
  // within a stage is not a step, so it is left to be reported as an edit.
  const stageB = stageOf(b);
  const stageA = stageOf(a);
  if (stageB !== stageA) {
    const step = lookup(WITHDRAWAL_STEPS, stageA);
    if (step) push(step.event, `${step.verb} ${kind.noun} ${name}${excerpt(own(a.withdrawal, step.reason))}`);
    else if (!stageA) push("withdrawal_cleared", `Cleared the withdrawal request on ${kind.noun} ${name}`);
    else push("edited", `Set the withdrawal stage of ${kind.noun} ${name} to ${quoted(clip(stageA, 40))}`);
    claim("withdrawal");
    if (stageA === "withdrawn") claim("withdrawn", "withdrawnAt", "status");
  }
  if (changed.has("withdrawn")) {
    if (a.withdrawn === true) push("withdrawn", `Withdrew ${kind.noun} ${name}${where}`);
    else push("reinstated", `Reinstated ${kind.noun} ${name}${where}`);
    claim("withdrawn", "withdrawnAt");
  }

  // Closed by the Head, or reopened.
  if (!isClosed(b) && isClosed(a)) {
    push(
      "closed",
      `Closed ${kind.noun} ${name}${where}` + (str(a.closedDateISO) ? ` — closure date ${show(a.closedDateISO)}` : ""),
      { comment: detail(a.headComment) },
    );
    claim("status", "closedDateISO", "closureDate", "headComment", "closureRejection", ...SIGNOFF_STAMPS);
  } else if (isClosed(b) && !isClosed(a)) {
    push("reopened", `Reopened ${kind.noun} ${name}${where} (status ${show(b.status)} → ${show(a.status)})`);
    claim("status", "closedDateISO", "closureDate", "headComment", ...SIGNOFF_STAMPS);
  }

  /* Sent back for more work — to the owner by their auditor or the Head, or to the auditor by the
     Head. Recognised by the note (closureRejection) or, if a flow unwinds without one, by the
     response or verification being withdrawn. */
  const ownerUnwound = cleared("ownerRectifiedAt");
  const auditorUnwound = cleared("reportVerifiedAt");
  const rejection = isObj(a.closureRejection) ? a.closureRejection : null;
  const newRejection = changed.has("closureRejection") && !!rejection && !isBlank(rejection);
  if (newRejection || ownerUnwound || auditorUnwound) {
    const target = newRejection ? str(rejection!.target) : auditorUnwound ? "auditor" : "owner";
    push(
      "closure_rejected",
      `Returned ${kind.noun} ${name} to ${target === "auditor" ? "the auditor" : "the action owner"} for more work` +
        excerpt(own(rejection, "note"), 160),
      { returnedTo: target === "auditor" ? "auditor" : "owner" },
    );
    claim("closureRejection", "status");
    if (ownerUnwound) claim(...RESPONSE_STAMPS, "ownerResponse", "ownerResponseEvidence");
    if (auditorUnwound) claim(...VERIFY_STAMPS, ...CLOSURE_EVIDENCE, "closedDateISO");
  }

  // The auditor verifies the remediation and sends it to the Head for sign-off.
  if (setNow("reportVerifiedAt")) {
    push(
      "report_verified",
      `Verified the remediation of ${kind.noun} ${name} and sent it to the Head for sign-off` +
        (str(a.closedDateISO) && !isClosed(a) ? ` — proposed closure date ${show(a.closedDateISO)}` : ""),
      { closureNote: detail(a.closureNote) },
    );
    claim(...VERIFY_STAMPS, ...CLOSURE_EVIDENCE, "closedDateISO", "closureRejection");
  }

  // The action owner submits their closure response. The server derives the status change, the
  // cleared progress-report request and the dropped return note from it (lib/workspace-authz.ts).
  if (setNow("ownerRectifiedAt")) {
    const files = arr(a.ownerResponseEvidence).length;
    push(
      "ready_for_closure",
      `Submitted the closure response for ${kind.noun} ${name}` +
        (files ? ` with ${plural(files, "evidence file")}` : "") +
        excerpt(a.ownerResponse),
      { response: detail(a.ownerResponse) },
    );
    claim(...RESPONSE_STAMPS, "ownerResponse", "ownerResponseEvidence", "status", "closureRejection", "progressReport");
  }

  // Internal Audit chasing the owner — a first request or a repeat of one still outstanding.
  if (changed.has("updateRequestedAt") && !isBlank(a.updateRequestedAt)) {
    push("owner_update_requested", `Requested an update from the action owner on ${kind.noun} ${name}`);
    claim("updateRequestedAt", "updateRequestedBy");
  }
  if (changed.has("progressReport") && !isBlank(a.progressReport)) {
    push("progress_requested", `Requested a progress report on ${kind.noun} ${name}`);
    claim("progressReport");
  }

  if (OWNER_FIELDS.some((f) => changed.has(f))) {
    const parts: string[] = [];
    if (changed.has("owner") || changed.has("ownerUserId")) parts.push(`owner ${show(b.owner)} → ${show(a.owner)}`);
    if (changed.has("secondaryOwner") || changed.has("secondaryOwnerUserId")) {
      parts.push(`co-owner ${show(b.secondaryOwner)} → ${show(a.secondaryOwner)}`);
    }
    if (changed.has("departmentId")) parts.push(`department ${dept(b.departmentId)} → ${dept(a.departmentId)}`);
    push("reassigned", `Reassigned ${kind.noun} ${name}: ${parts.join("; ")}`, {
      changes: describeFields(b, a, OWNER_FIELDS.filter((f) => changed.has(f))).changes,
    });
    claim(...OWNER_FIELDS);
  }

  // A status change no workflow step accounts for — the Head setting it directly, or an approved request.
  if (changed.has("status")) {
    push("status_changed", `Changed the status of ${kind.noun} ${name}: ${show(b.status)} → ${show(a.status)}`);
    claim("status");
  }

  if (changed.has("updates")) {
    const added = describeConversation(kind, b.updates, a.updates, name, push);
    claim("updates");
    // An owner's reply is what clears an outstanding update request (lib/workspace-authz.ts).
    if (added && cleared("updateRequestedAt")) claim("updateRequestedAt", "updateRequestedBy");
  }

  if (changed.size) {
    const d = describeFields(b, a, [...changed]);
    push("edited", `Edited ${kind.noun} ${name}: ${d.text}`, { changes: d.changes });
  }
}

/** Comments, progress updates and private notes on an observation or finding. Returns how many
 *  were added. */
function describeConversation(
  kind: ItemKind,
  before: unknown,
  after: unknown,
  name: string,
  push: (event: string, summary: string, extra?: Obj) => void,
): number {
  const key = (u: Obj) => str(u.id) || `${str(u.at)}|${str(u.by)}|${clip(str(u.text), 40)}`;
  const B = new Map(arr(before).map((u) => [key(u), u]));
  const A = new Map(arr(after).map((u) => [key(u), u]));
  const added = [...A.entries()].filter(([k]) => !B.has(k)).map(([, u]) => u);
  const removed = [...B.entries()].filter(([k]) => !A.has(k)).map(([, u]) => u);
  const edited = [...A.entries()].filter(([k, u]) => B.has(k) && !same(B.get(k), u)).map(([, u]) => u);

  if (added.length === 1) {
    const u = added[0];
    const files = arr(u.evidence).length;
    const what =
      str(u.kind) === "progress"
        ? "Filed a progress update on"
        : u.audience === "owner"
          ? "Posted a private co-owner note on"
          : u.audience === "ia_only"
            ? "Posted an Internal Audit-only note on"
            : "Commented on";
    push(
      "update",
      `${what} ${kind.noun} ${name}` + (files ? ` (${plural(files, "file")} attached)` : "") + excerpt(u.text),
      { comment: detail(u.text), audience: str(u.audience) || "all", attachments: files },
    );
  } else if (added.length > 1) {
    push("update", `Posted ${added.length} comments on ${kind.noun} ${name}`, {
      comments: added.map((u) => detail(u.text)),
    });
  }
  if (edited.length) {
    push("update_edited", `Edited ${edited.length === 1 ? "a comment" : `${edited.length} comments`} on ${kind.noun} ${name}`, {
      comments: edited.map((u) => ({ from: detail(B.get(key(u))?.text), to: detail(u.text) })),
    });
  }
  if (removed.length) {
    push("update_deleted", `Deleted ${removed.length === 1 ? "a comment" : `${removed.length} comments`} on ${kind.noun} ${name}`, {
      comments: removed.map((u) => ({ text: detail(u.text), by: str(u.byName) || str(u.by), at: str(u.at) })),
    });
  }
  return added.length;
}

function diffExtFindings(b: Obj, a: Obj, dept: (id: unknown) => string, out: Draft[]): void {
  const B = byId(arr(b.extFindings));
  const A = byId(arr(a.extFindings));
  const metaFor = (f: Obj) => ({ entity: "extFinding", findingId: str(f.id), ref: str(f.ref), title: str(f.title) });
  for (const [id, f] of A) {
    const prev = B.get(id);
    if (!prev) itemCreated(EXT_KIND, f, "", metaFor(f), out);
    else itemUpdated(EXT_KIND, prev, f, "", metaFor(f), dept, out);
  }
  for (const [id, f] of B) if (!A.has(id)) itemDeleted(EXT_KIND, f, "", metaFor(f), out);
}

/* ------------------------------------------------------------------ fraud register */

function diffFraud(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.fraudRisks));
  const A = byId(arr(a.fraudRisks));
  for (const [id, risk] of A) {
    const prev = B.get(id);
    const name = named(risk.scheme, "(unnamed risk)");
    const meta = { entity: "fraudRisk", fraudRiskId: id, title: str(risk.scheme) };
    if (!prev) {
      const acts = arr(risk.actions).length;
      out.push({
        action: "fraud.risk_created",
        summary:
          `Added fraud risk ${name}` +
          paren([
            risk.category,
            str(risk.likelihood) ? `likelihood ${str(risk.likelihood)} × impact ${str(risk.impact)}` : "",
            acts ? plural(acts, "prevention action") : "",
          ]),
        metadata: meta,
        bulk: { text: "Added {n} fraud risks", id, title: str(risk.scheme) },
      });
      continue;
    }
    if (untouched(prev, risk)) continue;
    const actionsChanged = diffFraudActions(prev, risk, name, meta, out);
    // The risk's status is rolled up from its actions; when those moved, the roll-up is not news.
    const fields = changedFields(prev, risk, new Set(["id", "actions", "createdAt", ...(actionsChanged ? ["status"] : [])]));
    if (fields.length) {
      const d = describeFields(prev, risk, fields);
      out.push({ action: "fraud.risk_updated", summary: `Updated fraud risk ${name}: ${d.text}`, metadata: { ...meta, changes: d.changes } });
    }
  }
  for (const [id, risk] of B) {
    if (A.has(id)) continue;
    const acts = arr(risk.actions).length;
    out.push({
      action: "fraud.risk_deleted",
      summary: `Deleted fraud risk ${named(risk.scheme, "(unnamed risk)")}` + (acts ? ` — with ${plural(acts, "prevention action")}` : ""),
      metadata: { entity: "fraudRisk", fraudRiskId: id, title: str(risk.scheme), category: str(risk.category) },
      bulk: { text: "Deleted {n} fraud risks", id, title: str(risk.scheme) },
    });
  }
}

/** Returns whether any prevention action changed. */
function diffFraudActions(prev: Obj, risk: Obj, riskName: string, meta: Obj, out: Draft[]): boolean {
  const B = byId(arr(prev.actions));
  const A = byId(arr(risk.actions));
  let any = false;
  for (const [id, act] of A) {
    const was = B.get(id);
    const name = named(act.text, "a prevention action");
    const m = { ...meta, fraudActionId: id };
    if (!was) {
      any = true;
      out.push({
        action: "fraud.action_added",
        summary: `Added prevention action ${name} to fraud risk ${riskName}` + paren([str(act.owner) ? `owner ${str(act.owner)}` : ""]),
        metadata: m,
      });
      continue;
    }
    if (untouched(was, act)) continue;
    const changed = new Set(changedFields(was, act, new Set(["id"])));
    if (!changed.size) continue;
    any = true;
    if (changed.has("owner") || changed.has("ownerUserId")) {
      out.push({
        action: "fraud.action_assigned",
        summary: `Assigned prevention action ${name} (${riskName}): ${show(was.owner)} → ${show(act.owner)}`,
        metadata: m,
      });
      changed.delete("owner");
      changed.delete("ownerUserId");
    }
    // Who/when of an IA validation are bookkeeping for the entry below, not edits in their own
    // right; the note travels with the status change that awards or withdraws the validation.
    for (const f of ["validatedAt", "validatedBy", "validatedByName"]) changed.delete(f);
    if (changed.has("status")) {
      changed.delete("validationNote");
      changed.delete("validationEvidence");
      if (str(act.status) === "Validated") {
        const files = arr(act.validationEvidence);
        out.push({
          action: "fraud.action_validated",
          summary: `Validated prevention action ${name} (${riskName})${excerpt(act.validationNote)}${attached(files)}`,
          metadata: { ...m, note: detail(act.validationNote), ...(files.length ? { files: detail(files) } : {}) },
        });
      } else {
        out.push({
          action: "fraud.action_status_updated",
          summary: `Changed the status of prevention action ${name} (${riskName}): ${show(was.status)} → ${show(act.status)}`,
          metadata: m,
        });
      }
      changed.delete("status");
    }
    if (changed.has("ownerUpdates") || changed.has("update")) {
      const seen = new Set(arr(was.ownerUpdates).map((u) => `${str(u.at)}|${str(u.by)}`));
      const fresh = arr(act.ownerUpdates).filter((u) => !seen.has(`${str(u.at)}|${str(u.by)}`));
      const text = fresh.length ? fresh[fresh.length - 1].text : act.update;
      const files = fresh.flatMap((u) => arr(u.evidence));
      out.push({
        action: "fraud.action_update",
        summary: `Posted an implementation update on prevention action ${name} (${riskName})${excerpt(text)}${attached(files)}`,
        metadata: { ...m, update: detail(text), ...(files.length ? { files: detail(files) } : {}) },
      });
      changed.delete("ownerUpdates");
      changed.delete("update");
    }
    if (changed.size) {
      const d = describeFields(was, act, [...changed]);
      out.push({
        action: "fraud.action_edited",
        summary: `Edited prevention action ${name} (${riskName}): ${d.text}`,
        metadata: { ...m, changes: d.changes },
      });
    }
  }
  for (const [id, act] of B) {
    if (A.has(id)) continue;
    any = true;
    out.push({
      action: "fraud.action_deleted",
      summary: `Deleted prevention action ${named(act.text, "a prevention action")} from fraud risk ${riskName}`,
      metadata: { ...meta, fraudActionId: id },
    });
  }
  return any;
}

/* ------------------------------------------------------------------ annual plan (audit universe) */

function diffUniverse(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.auditUniverse));
  const A = byId(arr(a.auditUniverse));
  const quarters = (v: unknown) => new Set(Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  for (const [id, u] of A) {
    const prev = B.get(id);
    const name = named(u.name, "(unnamed unit)");
    const meta = { entity: "auditableUnit", unitId: id, title: str(u.name) };
    if (!prev) {
      out.push({
        action: "plan.unit_created",
        summary: `Added auditable unit ${name}${paren([str(u.plannedPeriod) ? `planned ${str(u.plannedPeriod)}` : ""])}`,
        metadata: meta,
        bulk: { text: "Added {n} auditable units", id, title: str(u.name) },
      });
      continue;
    }
    if (untouched(prev, u)) continue;
    const changed = new Set(changedFields(prev, u, new Set(["id", "createdAt"])));
    if (!changed.size) continue;
    if (str(u.engStatus) === "Completed" && str(prev.engStatus) !== "Completed") {
      out.push({ action: "plan.completed", summary: `Marked the engagement ${name} complete`, metadata: meta });
      changed.delete("engStatus");
      changed.delete("occDone"); // completion ticks every planned quarter
    }
    const parts: string[] = [];
    if (changed.has("occDone")) {
      const was = quarters(prev.occDone);
      const now = quarters(u.occDone);
      const done = [...now].filter((q) => !was.has(q));
      const undone = [...was].filter((q) => !now.has(q));
      if (done.length) parts.push(`${done.join(", ")} marked done`);
      if (undone.length) parts.push(`${undone.join(", ")} marked not done`);
      changed.delete("occDone");
    }
    if (changed.has("factors")) {
      const fb = isObj(prev.factors) ? prev.factors : {};
      const fa = isObj(u.factors) ? u.factors : {};
      const fs = changedFields(fb, fa);
      if (fs.length) parts.push(`risk factors: ${fs.map((f) => `${label(f)} ${show(own(fb, f))} → ${show(own(fa, f))}`).join(", ")}`);
      changed.delete("factors");
    }
    const d = describeFields(prev, u, [...changed]);
    if (d.text) parts.push(d.text);
    if (!parts.length) continue;
    out.push({
      action: "plan.unit_updated",
      summary: `Updated auditable unit ${name}: ${clip(parts.join("; "), 320)}`,
      metadata: { ...meta, changes: d.changes },
    });
  }
  for (const [id, u] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "plan.unit_deleted",
      summary: `Deleted auditable unit ${named(u.name, "(unnamed unit)")}`,
      metadata: { entity: "auditableUnit", unitId: id, title: str(u.name) },
      bulk: { text: "Deleted {n} auditable units", id, title: str(u.name) },
    });
  }
}

/* ------------------------------------------------------------------ process reviews */

function diffProcessReviews(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.processReviews));
  const A = byId(arr(a.processReviews));
  const titleOf = (r: Obj) => str(r.sopTitle) || str(r.unit) || str(r.name);
  const nameOf = (r: Obj) => named(titleOf(r), "(untitled review)");
  for (const [id, r] of A) {
    const prev = B.get(id);
    const meta = { entity: "processReview", processReviewId: id, title: titleOf(r) };
    if (!prev) {
      out.push({
        action: "process.review_created",
        summary: `Created process review ${nameOf(r)}${paren([str(r.unit) && str(r.sopTitle) ? r.unit : "", r.period])}`,
        metadata: meta,
        bulk: { text: "Created {n} process reviews", id, title: meta.title },
      });
      continue;
    }
    // The SOP PDF is held server-side and grafted back on every save; sopPdfStored is the flag the
    // GET payload puts in its place. Neither is an edit — a new upload shows as sopFileName.
    const fields = changedFields(prev, r, new Set(["id", "createdAt", "sopPdfBase64", "sopPdfStored"]));
    const parts: string[] = [];
    for (const f of ["findings", "proposedSteps"]) {
      if (!fields.includes(f)) continue;
      const fb = byId(arr(prev[f]));
      const fa = byId(arr(r[f]));
      const added = [...fa.keys()].filter((k) => !fb.has(k)).length;
      const removed = [...fb.keys()].filter((k) => !fa.has(k)).length;
      const edited = [...fa.keys()].filter((k) => fb.has(k) && !same(fb.get(k), fa.get(k))).length;
      const counts = [added && `${added} added`, edited && `${edited} edited`, removed && `${removed} removed`].filter(Boolean);
      parts.push(`${label(f)}${counts.length ? ` (${counts.join(", ")})` : ""}`);
    }
    const rest = fields.filter((f) => f !== "findings" && f !== "proposedSteps");
    const d = describeFields(prev, r, rest);
    if (d.text) parts.push(d.text);
    if (!parts.length) continue;
    out.push({
      action: "process.review_updated",
      summary: `Updated process review ${nameOf(r)}: ${clip(parts.join("; "), 320)}`,
      metadata: { ...meta, changes: d.changes },
    });
  }
  for (const [id, r] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "process.review_deleted",
      summary: `Deleted process review ${nameOf(r)}`,
      metadata: { entity: "processReview", processReviewId: id, title: titleOf(r) },
    });
  }
}

/* ------------------------------------------------------------------ IA self-assessments */

function diffSelfAssessments(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.iaSAList));
  const A = byId(arr(a.iaSAList));
  const nameOf = (s: Obj) =>
    named(s.period, "(undated)") + (str(s.userId) ? ` by ${str(s.assessor) || "a staff member"}` : " (organisation-wide)");
  for (const [id, s] of A) {
    const prev = B.get(id);
    const meta = { entity: "selfAssessment", selfAssessmentId: id, title: str(s.period), ownerUserId: str(s.userId) };
    if (!prev) {
      out.push({ action: "iasa.created", summary: `Started the self-assessment ${nameOf(s)}`, metadata: meta });
      continue;
    }
    if (untouched(prev, s)) continue;
    const changed = new Set(changedFields(prev, s, new Set(["id", "startedAt", "createdAt"])));
    if (!changed.size) continue;
    if (str(s.status) === "completed" && str(prev.status) !== "completed") {
      out.push({ action: "iasa.completed", summary: `Completed the self-assessment ${nameOf(s)}`, metadata: meta });
      changed.delete("status");
      changed.delete("completedAt");
    }
    const parts: string[] = [];
    for (const [f, noun] of [["std", "standard"], ["items", "principle"]] as const) {
      if (!changed.has(f)) continue;
      const xb = isObj(prev[f]) ? prev[f] : {};
      const xa = isObj(s[f]) ? s[f] : {};
      const keys = changedFields(xb, xa);
      if (keys.length) parts.push(`${plural(keys.length, noun)} updated (${clip(keys.join(", "), 80)})`);
      changed.delete(f);
    }
    const d = describeFields(prev, s, [...changed]);
    if (d.text) parts.push(d.text);
    if (!parts.length) continue;
    out.push({
      action: "iasa.updated",
      summary: `Updated the self-assessment ${nameOf(s)}: ${clip(parts.join("; "), 320)}`,
      metadata: { ...meta, changes: d.changes },
    });
  }
  for (const [id, s] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "iasa.deleted",
      summary: `Deleted the self-assessment ${nameOf(s)}`,
      metadata: { entity: "selfAssessment", selfAssessmentId: id, title: str(s.period), ownerUserId: str(s.userId) },
    });
  }
}

/* ------------------------------------------------------------------ approvals */

type ApprovalSpec = { requested: string; approved: string; rejected: string; what: (ap: Obj) => string };

/* Requests the Head decides. `null` kinds are not reported from the approvals queue at all: the
   request IS the observation's own raise or withdrawal step, which itemUpdated() already reports
   — reporting both would say everything twice. */
const APPROVAL_KINDS: Readonly<Record<string, ApprovalSpec | null>> = {
  observation_raise: null,
  observation_withdraw: null,
  observation_status_change: {
    requested: "obs.status_change_requested",
    approved: "obs.status_change_approved",
    rejected: "obs.status_change_rejected",
    what: (ap) =>
      `the status change of ${named(ap.obsTitle, "an observation")}` +
      (str(ap.newStatus) ? ` (${show(ap.fromStatus)} → ${show(ap.newStatus)})` : ""),
  },
  observation_update: {
    requested: "obs.edit_requested",
    approved: "obs.update_approved",
    rejected: "obs.update_rejected",
    what: (ap) =>
      `an edit to ${named(ap.obsTitle, "an observation")}` +
      (isObj(ap.changes) && Object.keys(ap.changes).length ? ` (${clip(Object.keys(ap.changes).map(label).join(", "), 120)})` : ""),
  },
  observation_delete: {
    requested: "obs.delete_requested",
    approved: "obs.delete_approved",
    rejected: "obs.delete_rejected",
    what: (ap) => `the deletion of ${named(ap.obsTitle, "an observation")}`,
  },
  engagement_completion: {
    requested: "plan.completion_requested",
    approved: "plan.completion_approved",
    rejected: "plan.completion_rejected",
    what: (ap) => `the completion of the engagement ${named(ap.unitName, "(unnamed unit)")}`,
  },
};

const GENERIC_APPROVAL: ApprovalSpec = {
  requested: "approval.requested",
  approved: "approval.approved",
  rejected: "approval.rejected",
  what: (ap) => `a ${clip(str(ap.kind).replace(/_/g, " "), 60) || "request"}`,
};

/* Who asked is deliberately NOT quoted from the request in any summary: requestedBy/requestedByName
   are written by the requesting browser, so a request could name someone else. The request's own
   entry is attributed to the session that made it — that is the record of who asked. */
function diffApprovals(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.approvals));
  const A = byId(arr(a.approvals));
  const specOf = (ap: Obj): ApprovalSpec | null => {
    const kind = str(ap.kind);
    return hasOwn(APPROVAL_KINDS, kind) ? APPROVAL_KINDS[kind] : GENERIC_APPROVAL;
  };
  const metaOf = (ap: Obj) => ({
    entity: "approval",
    approvalId: str(ap.id),
    kind: str(ap.kind),
    observationId: str(ap.obsId),
    unitId: str(ap.unitId),
    requesterAsStatedOnRequest: str(ap.requestedByName) || str(ap.requestedBy),
  });

  for (const [id, ap] of A) {
    const prev = B.get(id);
    const spec = specOf(ap);
    if (!spec) continue;
    if (!prev) {
      out.push({
        action: spec.requested,
        summary: `Requested approval for ${spec.what(ap)}${excerpt(ap.reason)}`,
        metadata: metaOf(ap),
      });
      continue;
    }
    const from = str(prev.status);
    const to = str(ap.status);
    if (from === to) continue; // anything else on a request is bookkeeping around its decision
    if (to === "approved") {
      out.push({ action: spec.approved, summary: `Approved ${spec.what(ap)}${excerpt(ap.headReason)}`, metadata: metaOf(ap) });
    } else if (to === "rejected") {
      out.push({ action: spec.rejected, summary: `Rejected ${spec.what(ap)}${excerpt(ap.headReason)}`, metadata: metaOf(ap) });
    } else if (to === "superseded") {
      out.push({ action: "approval.superseded", summary: `The request for ${spec.what(ap)} was withdrawn or replaced`, metadata: metaOf(ap) });
    }
  }
  for (const [id, ap] of B) {
    if (A.has(id)) continue;
    const spec = specOf(ap);
    if (!spec) continue;
    out.push({ action: "approval.deleted", summary: `Removed the approval request for ${spec.what(ap)}`, metadata: metaOf(ap) });
  }
}

/* ------------------------------------------------------------------ departments */

function diffDepartments(b: Obj, a: Obj, out: Draft[]): void {
  const B = byId(arr(b.departments));
  const A = byId(arr(a.departments));
  for (const [id, d] of A) {
    const prev = B.get(id);
    const meta = { entity: "department", departmentId: id, title: str(d.name) };
    if (!prev) {
      out.push({
        action: "settings.department_added",
        summary: `Added department ${named(d.name, "(unnamed)")}${paren([str(d.headName) ? `head ${str(d.headName)}` : ""])}`,
        metadata: meta,
      });
      continue;
    }
    // The head is stored as a name, an e-mail and an account id; read by name and e-mail.
    const fields = changedFields(prev, d, new Set(["id", "createdAt"]));
    const shown = fields.includes("headUserId") && !fields.includes("headName")
      ? fields.map((f) => (f === "headUserId" ? "headName" : f))
      : fields.filter((f) => f !== "headUserId");
    if (!shown.length) continue;
    const ch = describeFields(prev, d, shown);
    out.push({
      action: "settings.department_updated",
      summary: `Updated department ${named(d.name, "(unnamed)")}: ${ch.text}`,
      metadata: { ...meta, changes: ch.changes },
    });
  }
  for (const [id, d] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "settings.department_removed",
      summary: `Removed department ${named(d.name, "(unnamed)")}${paren([str(d.headName) ? `head ${str(d.headName)}` : ""])}`,
      metadata: { entity: "department", departmentId: id, title: str(d.name), headUserId: str(d.headUserId) },
    });
  }
}

/* ------------------------------------------------------------------ executive assurance brief */

// Bookkeeping the send flow and the scheduler keep for themselves.
const EXCO_IGNORE = new Set(["briefs", "recipientList", "recipientsList", "autoState", "lastSentAt"]);

function diffExco(b: Obj, a: Obj, out: Draft[]): void {
  const eb = isObj(b.exco) ? b.exco : {};
  const ea = isObj(a.exco) ? a.exco : {};
  if (untouched(eb, ea)) return;

  const B = byId(arr(eb.briefs));
  const A = byId(arr(ea.briefs));
  const period = (br: Obj) => named(br.period, "(undated)");
  /* `delivered` is the send's outcome, stamped by whoever sent it (the brief page or the scheduler).
     Briefs sent before it existed have none, and read as sent, as they always did. */
  const sent = (br: Obj) => {
    const n = plural(num(br.sentTo), "recipient");
    const failed = br.delivered === false;
    out.push({
      action: "exco.sent",
      summary: failed
        ? `Tried to send the Executive Assurance Brief for ${period(br)} to ${n} — delivery could not be confirmed`
        : `Sent the Executive Assurance Brief for ${period(br)} to ${n}`,
      metadata: {
        entity: "excoBrief",
        briefId: str(br.id),
        period: str(br.period),
        recipients: num(br.sentTo),
        delivered: br.delivered === true ? true : failed ? false : "not recorded",
      },
    });
  };
  for (const [id, br] of A) {
    const prev = B.get(id);
    if (!prev) {
      out.push({
        action: "exco.generated",
        summary: `Generated the Executive Assurance Brief for ${period(br)}`,
        metadata: { entity: "excoBrief", briefId: id, period: str(br.period) },
      });
      if (str(br.sentAt)) sent(br); // the scheduler generates and sends in one save
    } else if (str(br.sentAt) && str(br.sentAt) !== str(prev.sentAt)) {
      sent(br);
    }
  }
  for (const [id, br] of B) {
    if (A.has(id)) continue;
    out.push({
      action: "exco.brief_deleted",
      summary: `Deleted the Executive Assurance Brief for ${period(br)} — its public link no longer works`,
      metadata: { entity: "excoBrief", briefId: id, period: str(br.period) },
    });
  }

  // Who receives it. Keyed by e-mail, the thing that decides where the brief goes.
  const who = (r: Obj) => `${str(r.name) || str(r.email)}${str(r.name) && str(r.email) ? ` <${str(r.email)}>` : ""}`;
  const RB = new Map(arr(eb.recipientList).map((r) => [str(r.email).toLowerCase(), r]));
  const RA = new Map(arr(ea.recipientList).map((r) => [str(r.email).toLowerCase(), r]));
  const added = [...RA.entries()].filter(([k]) => !RB.has(k)).map(([, r]) => who(r));
  const removed = [...RB.entries()].filter(([k]) => !RA.has(k)).map(([, r]) => who(r));
  const edited = [...RA.entries()].filter(([k, r]) => RB.has(k) && !same(RB.get(k), r)).map(([, r]) => who(r));
  if (added.length || removed.length || edited.length) {
    const parts = [
      added.length ? `added ${added.join(", ")}` : "",
      removed.length ? `removed ${removed.join(", ")}` : "",
      edited.length ? `edited ${edited.join(", ")}` : "",
    ].filter(Boolean);
    out.push({
      action: "settings.exco_recipients_updated",
      summary: `Updated the MD & EXCO brief recipients: ${clip(parts.join("; "), 360)}`,
      metadata: { entity: "excoRecipients", added, removed, edited },
    });
  }

  const fields = changedFields(eb, ea, EXCO_IGNORE);
  if (fields.length) {
    const d = describeFields(eb, ea, fields);
    out.push({
      action: "exco.updated",
      summary: `Updated the Executive Assurance Brief settings: ${d.text}`,
      metadata: { entity: "exco", changes: d.changes },
    });
  }
}

/* ------------------------------------------------------------------ top-level settings */

const TOP_HANDLED = new Set([
  "audits", "extFindings", "fraudRisks", "auditUniverse", "processReviews", "iaSAList",
  "approvals", "departments", "exco", "planYears",
]);
/* View state and bookkeeping that live in the document without being part of the record: which
   plan year and which self-assessment are on screen, notification read flags, the migrated
   pre-list assessment, the backup stamp. Changing any of them is a click. */
const TOP_IGNORED = new Set([
  "planYear", "iaSACurrentId", "iaSAUserCurrent", "iaSA", "notifications", "lastBackup", "logo", "updatedAt",
]);
const TOP_NAMED: Readonly<Record<string, [action: string, summary: string]>> = {
  fraudPlanNarrative: ["fraud.plan_updated", "Updated the fraud prevention plan narrative"],
  fraudUpdate: ["fraud.plan_updated", "Updated the BAC quarterly fraud update"],
  extCommentary: ["ext.commentary_updated", "Updated the external findings commentary"],
  caeReport: ["report.cae_updated", "Updated the CAE quarterly report"],
};

function diffSettings(b: Obj, a: Obj, out: Draft[]): void {
  const years = (v: unknown) => new Set(Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const yearsB = years(b.planYears);
  const yearsA = years(a.planYears);
  for (const y of yearsA) {
    if (!yearsB.has(y)) out.push({ action: "plan.year_created", summary: `Opened the ${clip(y, 20)} annual plan`, metadata: { year: y } });
  }
  for (const y of yearsB) {
    if (!yearsA.has(y)) out.push({ action: "plan.year_removed", summary: `Removed the ${clip(y, 20)} annual plan`, metadata: { year: y } });
  }

  const general: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (TOP_HANDLED.has(k) || TOP_IGNORED.has(k) || k.startsWith("_")) continue;
    if (same(own(b, k), own(a, k))) continue;
    const spec = lookup(TOP_NAMED, k);
    if (spec) {
      const d = describeFields(b, a, [k]);
      out.push({ action: spec[0], summary: spec[1], metadata: { entity: "workspace", changes: d.changes } });
    } else {
      general.push(k);
    }
  }
  if (general.length) {
    const d = describeFields(b, a, general);
    out.push({ action: "settings.updated", summary: `Changed settings: ${d.text}`, metadata: { entity: "workspace", changes: d.changes } });
  }
}

/* ------------------------------------------------------------------ bulk + cap */

function finalize(drafts: Draft[]): ChangeEvent[] {
  const groups = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (!d.bulk) continue;
    const key = `${d.action}\u0000${d.bulk.text}`;
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }
  const dropped = new Set<Draft>();
  const replaced = new Map<Draft, ChangeEvent>();
  for (const list of groups.values()) {
    if (list.length <= BULK_THRESHOLD) continue;
    const first = list[0];
    const sample = list.slice(0, 3).map((d) => quoted(clip(d.bulk!.title || d.bulk!.id, 50))).join(", ");
    replaced.set(first, {
      action: first.action,
      summary: `${first.bulk!.text.replace("{n}", String(list.length))}: ${sample}, …`,
      metadata: {
        bulk: true,
        count: list.length,
        items: list.slice(0, 200).map((d) => ({ id: d.bulk!.id, title: d.bulk!.title })),
      },
    });
    for (const d of list.slice(1)) dropped.add(d);
  }

  const out: ChangeEvent[] = [];
  for (const d of drafts) {
    if (dropped.has(d)) continue;
    out.push(replaced.get(d) ?? { action: d.action, summary: d.summary, metadata: d.metadata });
  }
  if (out.length <= MAX_EVENTS) return out;

  const kept = out.slice(0, MAX_EVENTS - 1);
  const rest = out.slice(MAX_EVENTS - 1);
  const tally = new Map<string, number>();
  for (const e of rest) tally.set(e.action, (tally.get(e.action) || 0) + 1);
  kept.push({
    action: "workspace.changes_truncated",
    summary: `…and ${plural(rest.length, "more change")} in the same save`,
    metadata: { count: rest.length, actions: Object.fromEntries(tally) },
  });
  return kept;
}
