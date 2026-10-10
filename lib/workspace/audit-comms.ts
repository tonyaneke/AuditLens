"use client";

/* Audit communications — the engagement notice and the information / clarification requests that
 * pass between Internal Audit and the audited department during an engagement.
 *
 *   The NOTICE is composed in the Terms of Reference from the audit programme (objectives and
 *   scope) and issued to one or more departments. Issuing it is what puts the engagement on those
 *   departments' portal (Audits tab) — see lib/audit-comms-scope.ts for the shared rule.
 *
 *   A REQUEST is a thread on one engagement and one department. Internal Audit raises
 *   "information" requests (send us X); the department raises "clarification" requests (what do
 *   you mean by Y). Whose move it is next is read off the thread (requestAwaiting) rather than
 *   stored, so there is no status for either side to forge — lib/workspace-authz.ts keeps the
 *   thread append-only.
 *
 * Pure helpers plus the notification fan-out. Write helpers run inside mutate(). */

import { auditNoticedTo, requestReaches } from "@/lib/audit-comms-scope";
import { deptLabel, deptMembers, deptScopeFor, normalizeDept } from "@/lib/dept-scope";
import { directory, headUsers, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import type { SessionUser } from "@/lib/permissions";
import { isInternalAudit } from "./observations";
import { uid } from "./selectors";
import type { Audit, AuditRequest, AuditSide, WorkspaceDb } from "./types";

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

/** Departments the audit's `area` already names — the notice dialog's starting selection. */
export function suggestNoticeDepartments(a: Audit, departments: readonly string[]): string[] {
  const key = normalizeDept(a.area);
  return key ? departments.filter((d) => normalizeDept(d) === key) : [];
}

/* ---------------- who sees what ---------------- */

type PortalUser = { id: string; department?: string; extraDepartments?: string[] };

/** Engagements noticed to this user's department(s), newest notice first. Mirrors
 *  auditNoticedToViewer() in lib/workspace-scope.ts — the server served exactly these. */
export function portalAudits(db: WorkspaceDb, user: PortalUser | undefined): Audit[] {
  const scope = deptScopeFor(db, user);
  return (db.audits || [])
    .filter((a) => auditNoticedTo(a, scope))
    .sort((x, y) => String(y.notice?.issuedAt || "").localeCompare(String(x.notice?.issuedAt || "")));
}

/** The departments of this user's that an audit's notice reached, as notice-department names —
 *  what a clarification raised from the portal may be raised for. */
export function myNoticedDepartments(db: WorkspaceDb, a: Audit, user: PortalUser | undefined): string[] {
  const scope = deptScopeFor(db, user);
  return (a.notice?.departments || []).filter((d) => scope.keys.has(normalizeDept(d)));
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

export function awaitingLabel(r: AuditRequest): string {
  const w = requestAwaiting(r);
  if (w === "closed") return "Closed";
  return w === "dept" ? `Awaiting ${deptLabel(r.department) || "department"}` : "Awaiting Internal Audit";
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

export function portalRequestHref(requestId?: string): string {
  return `/portal/audits${requestId ? `?request=${encodeURIComponent(requestId)}` : ""}`;
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

/** The engagement notice, to every member of each department it is issued to; e-mail to their
 *  heads (or, for a department without a head on record, to its members). */
export function notifyNoticeIssued(db: WorkspaceDb, a: Audit, departments: string[], reissued: boolean): void {
  const subject = `AuditLens — ${a.name}: ${reissued ? "updated " : ""}engagement notice`;
  const text = a.notice?.text || noticeTemplate(a);
  for (const dept of departments) {
    const members = deptMembers(directory(), dept);
    for (const u of members) {
      bell(db, u.id, "audit_notice", `${reissued ? "Updated audit notice" : "Audit notice"}: ${a.name} is commencing`, "myaudits", a.id);
    }
    const heads = deptHeadIds(db, dept);
    const to = emailsFor(db, heads.length ? heads : members.map((u) => u.id));
    if (to.length) void emailNotify(to, subject, text, origin() + portalRequestHref(), "View the engagement in AuditLens");
  }
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

/** Tell the OTHER side about a new request, a reply, or a close / reopen. The actor is never
 *  notified about their own action. */
export function notifyRequestActivity(
  db: WorkspaceDb,
  a: Audit | undefined,
  r: AuditRequest,
  actor: { id: string; side: AuditSide },
  event: "raised" | "reply" | "closed" | "reopened",
): void {
  const actorId = actor.id;
  const auditName = a?.name || "an audit";
  const what = `${r.ref ? r.ref + " " : ""}“${r.subject}”`;
  const msgs = r.messages || [];
  const lastText = event === "reply" ? msgs[msgs.length - 1]?.text || "" : event === "raised" ? r.text : "";
  const toDept = actor.side === "ia";

  const line =
    event === "raised"
      ? r.kind === "information"
        ? `Information requested on ${auditName}: ${what}`
        : `Clarification requested on ${auditName}: ${what}`
      : event === "reply"
        ? `New reply on ${what} (${auditName})`
        : `${what} on ${auditName} was ${event}`;
  const subject = `AuditLens — ${line}`;
  const body = [line, lastText ? `\n${lastText}` : "", r.dueDate && event === "raised" ? `\nRequired by: ${r.dueDate}` : ""].join("");

  if (toDept) {
    const p = deptParticipants(db, r);
    for (const id of p.bell) if (id !== actorId) bell(db, id, "audit_request", line, "myaudits", r.auditId, r.id);
    const to = emailsFor(db, p.email.filter((id) => id !== actorId));
    if (to.length) void emailNotify(to, subject, body, origin() + portalRequestHref(r.id), "Open the request");
  } else {
    const ids = iaParticipants(a, r).filter((id) => id !== actorId);
    for (const id of ids) bell(db, id, "audit_request", line, "audit", r.auditId, r.id);
    const to = emailsFor(db, ids);
    if (to.length) void emailNotify(to, subject, body, origin() + auditRequestHref(r.auditId, r.id), "Open the request");
  }
}
