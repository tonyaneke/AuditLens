"use client";

/* Audit communications — the engagement notice, the audit conclusion, and the information /
 * clarification requests that pass between Internal Audit and the audited department.
 *
 *   The NOTICE is composed in the Terms of Reference from the audit programme (objectives and
 *   scope) and issued to one or more departments at the start of the engagement.
 *
 *   The CONCLUSION is issued at the end, from a FINAL report: the parts of its executive summary the
 *   department is given (1.1, areas out of scope, 1.2, 1.3, 1.5), snapshotted as sent.
 *
 *   Issuing either is what puts the engagement on those departments' portal (Audits tab) — see
 *   lib/audit-comms-scope.ts for the shared rule.
 *
 *   A REQUEST is a thread on one engagement and one department. Internal Audit raises
 *   "information" requests (send us X); the department raises "clarification" requests (what do
 *   you mean by Y). Whose move it is next is read off the thread (requestAwaiting) rather than
 *   stored, so there is no status for either side to forge — lib/workspace-authz.ts keeps the
 *   thread append-only.
 *
 * Pure helpers plus the notification fan-out. Write helpers run inside mutate(). */

import { commReaches, engagementReaches, requestReaches } from "@/lib/audit-comms-scope";
import { deptLabel, deptMembers, deptScopeFor, normalizeDept } from "@/lib/dept-scope";
import { directory, headUsers, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import type { SessionUser } from "@/lib/permissions";
import { isInternalAudit } from "./observations";
import { raLinkIds } from "./ra";
import { fmtDate, uid } from "./selectors";
import type {
  Audit,
  AuditCloseout,
  AuditRequest,
  AuditSide,
  AuditUniverseUnit,
  Report,
  WorkspaceDb,
} from "./types";

/* ---------------- the engagement notice ---------------- */

export function auditTypeLabel(a: Pick<Audit, "type">): string {
  return a.type === "department" ? "Department audit" : "Process audit";
}

/** "The Treasury Operations Audit is commencing" reads; "The Treasury Operations is commencing"
 *  does not — so a name that does not already say what it is gets its audit type appended. */
export function engagementTitle(a: Pick<Audit, "name" | "type">): string {
  const name = String(a.name || "").trim() || "audit";
  return /\b(audit|review|engagement)\b/i.test(name) ? name : `${name} ${auditTypeLabel(a).toLowerCase()}`;
}

/** The notice as Internal Audit's standard wording, filled from the audit programme. Plain text:
 *  it is shown as written (RichText) and e-mailed as written. The fallbacks match the Terms of
 *  Reference export (exportTORWord), so the notice never promises less than the TOR does. */
export function noticeTemplate(a: Audit): string {
  const plan = a.plan || {};
  const objectives = (plan.objectives || []).map((o) => String(o).trim()).filter(Boolean);
  const scope = String(plan.scope || "").trim();
  const objText = objectives.length
    ? objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")
    : `To assess the adequacy and effectiveness of governance, risk management and internal controls over ${a.name}.`;
  return [
    `The ${engagementTitle(a)} is commencing. The engagement objectives and scope are presented below:`,
    `Objectives\n${objText}`,
    `Scope\n${scope || "To be confirmed during planning."}`,
    "Observations will be raised progressively throughout the engagement, and relevant management teams will be notified through the platform.",
    "Best regards,\nThe Internal Audit Team",
  ].join("\n\n");
}

/** True when the audit programme has nothing the notice can quote yet. */
export function programmeIsEmpty(a: Audit): boolean {
  const plan = a.plan || {};
  return !(plan.objectives || []).some((o) => String(o).trim()) && !String(plan.scope || "").trim();
}

export function noticeIssued(a: Audit | undefined): boolean {
  return !!a?.notice?.issuedAt;
}

/* ---------------- terms of reference: what fills itself ----------------
   The Terms of Reference and the notice are one dialog: issuing the notice is saving the TOR. Most
   of the TOR can be filled from what the system already knows, so the auditor reviews rather than
   types:
     addressed to       the departments the notice goes to (one picker for both)
     planned timing     the audit's own quarter ("Q2 2027" → 1 Apr – 30 Jun 2027) until narrowed
     background         the annual plan's rationale for the engagement this audit belongs to
     reporting channel  the house default below
     out of scope /     drafted by AI with the audit plan, or from it later (torDraftPrompt) —
     information needed nothing deterministic knows them */

/** Who the final report goes to unless the auditor says otherwise — the wording the TOR export
 *  has always fallen back to. */
export const DEFAULT_REPORTING_TO = "Executive Management and the Board Audit Committee";

/** "Q2 2027" (or "… - Q2" with a year elsewhere in the text) → the quarter's first and last day. */
export function quarterRange(period: unknown): { from: string; to: string } | null {
  const s = String(period || "");
  const q = /Q([1-4])/i.exec(s);
  const y = /(20\d{2})/.exec(s);
  if (!q || !y) return null;
  const n = Number(q[1]);
  const year = Number(y[1]);
  const pad = (v: number) => String(v).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, n * 3, 0)).getUTCDate();
  return { from: `${year}-${pad(n * 3 - 2)}-01`, to: `${year}-${pad(n * 3)}-${pad(lastDay)}` };
}

/** "10 Jan 2027 – 20 Jan 2027", or whichever end is known. */
export function formatTiming(from: string | undefined, to: string | undefined): string {
  const f = from ? fmtDate(from) : "";
  const t = to ? fmtDate(to) : "";
  return f && t ? `${f} – ${t}` : f ? `From ${f}` : t ? `Until ${t}` : "";
}

/** The annual-plan engagement (Audit Risk Assessment) this audit was created under, if linked. */
export function planUnitFor(db: WorkspaceDb, a: Audit): AuditUniverseUnit | undefined {
  return (db.auditUniverse || []).find((u) => !u.deletedAt && raLinkIds(u).includes(a.id));
}

/** Background & purpose from the annual plan: why the engagement is in the plan, in the plan's own
 *  words. Empty when the audit is not linked to the plan — then AI drafting fills it. */
export function defaultBackground(db: WorkspaceDb, a: Audit): string {
  const u = planUnitFor(db, a);
  const why = String(u?.rationale || "").trim();
  if (!u || !why) return "";
  const year = /20\d{2}/.exec(String(a.period || ""))?.[0] || String(db.planYear || "");
  return `This engagement forms part of the ${year ? year + " " : ""}risk-based internal audit plan ("${u.name}"). ${why}`;
}

/** The department addressed in the TOR export: "Head of Department — Finance, IT". */
export function addressedToLine(departments: readonly string[]): string {
  return departments.length ? `Head of Department — ${departments.map(deptLabel).join(", ")}` : "";
}

export type TorDraft = { background: string; outOfScope: string; infoRequired: string };

/** The AI brief for the TOR's three judgement fields, from everything the audit already knows. */
export function torDraftPrompt(db: WorkspaceDb, a: Audit): string {
  const plan = a.plan || {};
  const unit = planUnitFor(db, a);
  const tests = (plan.tests || [])
    .slice(0, 25)
    .map((t) => `- ${String(t.title || t.name || "")}${t.population ? ` (population: ${String(t.population)})` : ""}`)
    .join("\n");
  return `Act as the internal audit function of ${String(db.org || "the organisation")}. Draft three sections of the Terms of Reference for the engagement below. Write for the management of the audited department: plain, professional, specific to this engagement.

Audit: ${a.name}
Basis: ${auditTypeLabel(a)}
Process / Department: ${a.area || "(not specified)"}
Period: ${a.period || "(not specified)"}
Annual plan rationale: ${String(unit?.rationale || "(none)")}
Scope: ${String(plan.scope || "(not yet defined)")}
Objectives:
${(plan.objectives || []).map((o) => `- ${o}`).join("\n") || "(none)"}
Key risks:
${(plan.keyRisks || []).map((r) => `- ${r}`).join("\n") || "(none)"}
Planned tests:
${tests || "(none)"}

Return ONLY a JSON object (no commentary) with these exact keys:
{
  "background": "one or two short paragraphs: why this engagement is being performed and what it aims to give management assurance over",
  "outOfScope": ["an area deliberately excluded from this engagement", "another"],
  "infoRequired": ["a document, report, data extract or system access the audit team will need from management", "another"]
}`;
}

/** The AI's answer as the dialog's three text fields — lists become one item per line. */
export function parseTorDraft(raw: unknown): TorDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lines = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).join("\n") : String(v || "").trim();
  const draft = { background: lines(o.background), outOfScope: lines(o.outOfScope), infoRequired: lines(o.infoRequired) };
  return draft.background || draft.outOfScope || draft.infoRequired ? draft : null;
}

/** What a notice or conclusion can be addressed to: the roster first, then any department someone
 *  actually belongs to that the roster does not name (a person's department is what decides who is
 *  notified, so a department with members must be reachable), then any a stored communication
 *  already names. Once each by normalised name, roster spelling winning; never Internal Audit. */
export function commDepartmentOptions(
  roster: readonly string[],
  users: readonly { department?: string; extraDepartments?: string[]; active?: boolean }[],
  stored: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set([normalizeDept("Internal Audit")]);
  const add = (d: unknown) => {
    const name = String(d || "").trim();
    const k = normalizeDept(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(name);
  };
  roster.forEach(add);
  for (const u of users) {
    if (u.active === false) continue;
    add(u.department);
    (u.extraDepartments || []).forEach(add);
  }
  stored.forEach(add);
  return out;
}

/** Departments the audit's `area` already names — the notice dialog's starting selection. */
export function suggestNoticeDepartments(a: Audit, departments: readonly string[]): string[] {
  const key = normalizeDept(a.area);
  return key ? departments.filter((d) => normalizeDept(d) === key) : [];
}

/* ---------------- the audit conclusion ---------------- */

/** The executive-summary parts a department is given, in report order, with the report's own
 *  numbering. 1.4 (the internal audit opinion and assurance rating) is deliberately not among them. */
export const CLOSEOUT_SECTIONS: readonly [CloseoutSectionKey, string][] = [
  ["objective", "1.1 Audit objective & scope"],
  ["outOfScope", "Areas out of scope"],
  ["strengths", "1.2 Highlights of strengths"],
  ["areasForImprovement", "1.3 Areas for strategic improvement"],
  ["conclusion", "1.5 Conclusion"],
];

export type CloseoutSectionKey = "objective" | "outOfScope" | "strengths" | "areasForImprovement" | "conclusion";
export type CloseoutContent = Pick<AuditCloseout, "reportId" | "reportTitle" | CloseoutSectionKey>;

/** Reports the conclusion may be issued from — a draft's executive summary is not the conclusion. */
export function finalReports(a: Audit): Report[] {
  return (a.reports || []).filter((r) => r.status === "Final");
}

/** The executive-summary parts as they stand on the report now. 1.1 falls back to the report's
 *  scope exactly as the report page and the Word export do. */
export function closeoutFromReport(r: Report): CloseoutContent {
  const t = (v: unknown) => String(v || "").trim();
  return {
    reportId: r.id,
    reportTitle: r.title,
    objective: t(r.objective || r.scope),
    outOfScope: t(r.outOfScope),
    strengths: t(r.strengths),
    areasForImprovement: t(r.areasForImprovement),
    conclusion: t(r.conclusion),
  };
}

export function closeoutIssued(a: Audit | undefined): boolean {
  return !!a?.closeout?.issuedAt;
}

/** The conclusion as one plain-text message — the e-mail body. */
export function closeoutText(a: Audit, c: CloseoutContent): string {
  const parts = CLOSEOUT_SECTIONS.map(([k, title]) => {
    const v = String(c[k] || "").trim();
    return v ? `${title}\n${v}` : "";
  }).filter(Boolean);
  return [
    `The ${engagementTitle(a)} has concluded. The highlights of the executive summary are presented below:`,
    ...parts,
    "Thank you for your cooperation throughout the engagement. Agreed actions will continue to be tracked through the platform.",
    "Best regards,\nThe Internal Audit Team",
  ].join("\n\n");
}

/* ---------------- who sees what ---------------- */

type PortalUser = { id: string; department?: string; extraDepartments?: string[] };

/** When the department last heard about this engagement — the sort key for the Audits tab. */
function lastCommunicated(a: Audit): string {
  const n = a.notice;
  const c = a.closeout;
  return [n?.issuedAt, n?.revisedAt, c?.issuedAt, c?.revisedAt].map((x) => String(x || "")).sort().pop() || "";
}

/** Engagements communicated to this user's department(s), most recent first. Mirrors
 *  auditReachesViewer() in lib/workspace-scope.ts — the server served exactly these. */
export function portalAudits(db: WorkspaceDb, user: PortalUser | undefined): Audit[] {
  const scope = deptScopeFor(db, user);
  return (db.audits || [])
    .filter((a) => engagementReaches(a, scope))
    .sort((x, y) => lastCommunicated(y).localeCompare(lastCommunicated(x)));
}

/** Whether the notice / the conclusion was addressed to this user's department. */
export function reachesMe(db: WorkspaceDb, comm: unknown, user: PortalUser | undefined): boolean {
  return commReaches(comm, deptScopeFor(db, user));
}

/** Every department the engagement was communicated to (notice or conclusion), by the names those
 *  communications used, once each — what an information request may be addressed to. */
export function engagementDepartments(a: Audit): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const comm of [a.notice, a.closeout]) {
    if (!comm?.issuedAt) continue;
    for (const d of comm.departments || []) {
      const k = normalizeDept(d);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}

/** This user's departments among them — what a clarification raised from the portal may be raised for. */
export function myEngagementDepartments(db: WorkspaceDb, a: Audit, user: PortalUser | undefined): string[] {
  const scope = deptScopeFor(db, user);
  return engagementDepartments(a).filter((d) => scope.keys.has(normalizeDept(d)));
}

export function requestsForAudit(db: WorkspaceDb, auditId: string): AuditRequest[] {
  return (db.auditRequests || [])
    .filter((r) => r.auditId === auditId)
    .sort((x, y) => String(y.raisedAt || "").localeCompare(String(x.raisedAt || "")));
}

/** Requests this user's department may see and answer — mirrors canSeeAuditRequest(). */
export function portalRequests(db: WorkspaceDb, user: PortalUser | undefined, auditId?: string): AuditRequest[] {
  const scope = deptScopeFor(db, user);
  const audits = new Map((db.audits || []).map((a) => [a.id, a]));
  return (db.auditRequests || [])
    .filter((r) => (!auditId || r.auditId === auditId) && requestReaches(r, audits.get(r.auditId), scope))
    .sort((x, y) => String(y.raisedAt || "").localeCompare(String(x.raisedAt || "")));
}

export function viewerSide(user: SessionUser): AuditSide {
  return isInternalAudit(user) ? "ia" : "dept";
}

/* ---------------- whose move it is ---------------- */

export type Awaiting = "ia" | "dept" | "closed";

/** Closed, or the side that owes the next message: whoever did NOT write the latest one. */
export function requestAwaiting(r: AuditRequest): Awaiting {
  if (r.closedAt) return "closed";
  const msgs = r.messages || [];
  const last = msgs.length ? msgs[msgs.length - 1].side : r.side;
  return last === "ia" ? "dept" : "ia";
}

export function lastActivity(r: AuditRequest): string {
  const msgs = r.messages || [];
  return msgs.length ? msgs[msgs.length - 1].at : r.raisedAt;
}

/** Open requests waiting on this user's department — the portal's Audits badge. */
export function myAuditRequestsPendingCount(db: WorkspaceDb, user: PortalUser | undefined): number {
  return portalRequests(db, user).filter((r) => requestAwaiting(r) === "dept").length;
}

/** IR-01 for information, CR-01 for clarification, numbered per audit and per kind. */
export function nextRequestRef(db: WorkspaceDb, auditId: string, kind: AuditRequest["kind"]): string {
  const prefix = kind === "information" ? "IR" : "CR";
  let max = 0;
  for (const r of db.auditRequests || []) {
    if (r.auditId !== auditId) continue;
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(r.ref || ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/** Who may close or reopen a request: Internal Audit any; the department only the clarifications it
 *  raised (the same rule reconcileAuditRequests enforces). */
export function canCloseRequest(r: AuditRequest, side: AuditSide): boolean {
  return side === "ia" || (r.kind === "clarification" && r.side === "dept");
}

/* ---------------- notifications ----------------
   The bell reaches everyone who can act (the department shares the work, as with observations);
   e-mail goes to the accountable people only — the department's heads, or Internal Audit's
   participants — so one engagement does not fill a whole department's inbox. */

function origin(): string {
  try {
    return location.origin;
  } catch {
    return "";
  }
}

/** The engagement's page on the department's portal, opened on a request when there is one. */
export function portalAuditHref(auditId: string, requestId?: string): string {
  return `/portal/audits/${encodeURIComponent(auditId)}${requestId ? `?request=${encodeURIComponent(requestId)}` : ""}`;
}

export function auditRequestHref(auditId: string, requestId?: string): string {
  return `/audits/${auditId}${requestId ? `?request=${encodeURIComponent(requestId)}` : ""}`;
}

function bell(
  db: WorkspaceDb,
  userId: string,
  kind: string,
  text: string,
  link: "myaudits" | "audit",
  auditId: string,
  requestId = "",
): void {
  if (!userId) return;
  db.notifications = db.notifications || [];
  db.notifications.push({
    id: uid(),
    userId,
    kind,
    text,
    link,
    auditId,
    requestId,
    read: false,
    at: new Date().toISOString(),
  });
}

/** The department's heads, by the department records that carry its name. */
function deptHeadIds(db: WorkspaceDb, department: string): string[] {
  const key = normalizeDept(department);
  return [
    ...new Set(
      (db.departments || [])
        .filter((d) => d.headUserId && normalizeDept(d.name) === key)
        .map((d) => String(d.headUserId)),
    ),
  ];
}

function emailsFor(db: WorkspaceDb, ids: string[]): string[] {
  return [...new Set(ids.map((id) => ownerEmailFor(db, id)).filter(Boolean))];
}

/** A communication to every member of each department (bell); e-mail to their heads, or — for a
 *  department without a head on record — to its members. */
function notifyDepartments(
  db: WorkspaceDb,
  a: Audit,
  departments: string[],
  kind: string,
  bellText: string,
  subject: string,
  body: string,
): void {
  for (const dept of departments) {
    const members = deptMembers(directory(), dept);
    for (const u of members) bell(db, u.id, kind, bellText, "myaudits", a.id);
    const heads = deptHeadIds(db, dept);
    const to = emailsFor(db, heads.length ? heads : members.map((u) => u.id));
    if (to.length) void emailNotify(to, subject, body, origin() + portalAuditHref(a.id), "View the engagement in AuditLens");
  }
}

/** The engagement notice, to each department it is issued to. */
export function notifyNoticeIssued(db: WorkspaceDb, a: Audit, departments: string[], reissued: boolean): void {
  notifyDepartments(
    db,
    a,
    departments,
    "audit_notice",
    `${reissued ? "Updated audit notice" : "Audit notice"}: ${a.name} is commencing`,
    `AuditLens — ${a.name}: ${reissued ? "updated " : ""}engagement notice`,
    a.notice?.text || noticeTemplate(a),
  );
}

/** The audit conclusion, to each department it is issued to. */
export function notifyCloseoutIssued(db: WorkspaceDb, a: Audit, departments: string[], reissued: boolean): void {
  if (!a.closeout) return;
  notifyDepartments(
    db,
    a,
    departments,
    "audit_conclusion",
    `${reissued ? "Updated audit conclusion" : "Audit concluded"}: ${a.name} — executive summary available`,
    `AuditLens — ${a.name}: ${reissued ? "updated " : ""}audit conclusion`,
    closeoutText(a, a.closeout),
  );
}

/** The Internal Audit people an engagement's requests concern: its lead auditor, the request's IA
 *  raiser and anyone in IA who has written on it. The Head(s) when there is nobody else. */
function iaParticipants(a: Audit | undefined, r: AuditRequest): string[] {
  const ids = new Set<string>();
  if (a?.leadAuditorId) ids.add(a.leadAuditorId);
  if (r.side === "ia" && r.raisedBy) ids.add(r.raisedBy);
  for (const m of r.messages || []) if (m.side === "ia" && m.by) ids.add(m.by);
  if (!ids.size) for (const h of headUsers()) ids.add(h.id);
  return [...ids];
}

/** The department people a request concerns: its department raiser and anyone in the department
 *  who has written on it — or, before anyone has, the whole department (bell) and its heads (e-mail). */
function deptParticipants(db: WorkspaceDb, r: AuditRequest): { bell: string[]; email: string[] } {
  const ids = new Set<string>();
  if (r.side === "dept" && r.raisedBy) ids.add(r.raisedBy);
  for (const m of r.messages || []) if (m.side === "dept" && m.by) ids.add(m.by);
  if (ids.size) return { bell: [...ids], email: [...ids] };
  const members = deptMembers(directory(), r.department).map((u) => u.id);
  const heads = deptHeadIds(db, r.department);
  return { bell: members, email: heads.length ? heads : members };
}

/** Tell the OTHER side about a new request, a response, or a close / reopen — in the app (bell)
 *  AND by e-mail, the e-mail carrying what was said and the names of any files that came with it,
 *  so a response is known about without opening AuditLens to look for it.
 *
 *  Recipients are always the other side's people, so the actor is not normally among them. The one
 *  person who can be is someone holding both roles — an admin, who acts on one side and is told on
 *  the other. They are notified like anyone else on that side: excluding them by id is what left a
 *  tester playing both parts never seeing a response arrive. */
export function notifyRequestActivity(
  db: WorkspaceDb,
  a: Audit | undefined,
  r: AuditRequest,
  actor: { id: string; side: AuditSide; name?: string },
  event: "raised" | "reply" | "closed" | "reopened",
): void {
  const auditName = a?.name || "an audit";
  const what = `${r.ref ? r.ref + " " : ""}“${r.subject}”`;
  const msgs = r.messages || [];
  const last = event === "reply" ? msgs[msgs.length - 1] : undefined;
  const said = event === "reply" ? last?.text || "" : event === "raised" ? r.text : "";
  const files = (event === "reply" ? last?.evidence : event === "raised" ? r.evidence : undefined) || [];
  const dept = deptLabel(r.department) || "the department";
  const who = actor.side === "ia" ? `Internal Audit${actor.name ? ` (${actor.name})` : ""}` : `${actor.name || "The department"} (${dept})`;
  const toDept = actor.side === "ia";

  const line =
    event === "raised"
      ? r.kind === "information"
        ? `Information requested on ${auditName}: ${what}`
        : `Comment from ${dept} on ${auditName}: ${what}`
      : event === "reply"
        ? `New response from ${who} on ${what}`
        : `${what} on ${auditName} was ${event}`;
  const subject = `AuditLens — ${line}`;
  const body = [
    event === "reply" ? `${who} responded on ${what} — ${auditName}:` : line,
    said,
    files.length
      ? `Attached (${files.length}): ${files.map((f) => f.name).join(", ")} — open the request in AuditLens to download.`
      : "",
    r.dueDate && event === "raised" ? `Required by: ${fmtDate(r.dueDate)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (toDept) {
    const p = deptParticipants(db, r);
    for (const id of p.bell) bell(db, id, "audit_request", line, "myaudits", r.auditId, r.id);
    const to = emailsFor(db, p.email);
    if (to.length) void emailNotify(to, subject, body, origin() + portalAuditHref(r.auditId, r.id), "Open the request");
  } else {
    const ids = iaParticipants(a, r);
    for (const id of ids) bell(db, id, "audit_request", line, "audit", r.auditId, r.id);
    const to = emailsFor(db, ids);
    if (to.length) void emailNotify(to, subject, body, origin() + auditRequestHref(r.auditId, r.id), "Open the request");
  }
}
