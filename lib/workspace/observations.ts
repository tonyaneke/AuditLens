// Observation-domain helpers ported 1:1 from public/audit-bot.js (the behavioral spec):
// role/verification checks, pending-approval bookkeeping, in-workspace notifications, the
// withdrawal stage machine, repeat-detection heuristics, CSV import parsing and the AI-draft
// normalizer. All pure over the db + explicit user/directory args — no globals.

import { emailAdminConsolidated, emailNotify } from "@/lib/client/notify";
import { headUsers, ownerEmailFor, ownerNameFor, dirUser } from "@/lib/client/directory";
import type { SessionUser } from "@/lib/permissions";
import { effectiveRole, isAdmin } from "@/lib/permissions";
import type {
  Approval,
  Audit,
  AuditTest,
  Observation,
  ObsUpdate,
  Report,
  WorkspaceDb,
} from "./types";
import { CRITS, approvals, extList, isoNow, uid } from "./selectors";

/* ---------------- constants (verbatim) ---------------- */

export const TIMELINES = ["Immediate", "Short-term", "Long-term"] as const;
export const RESULTS = ["Not Tested", "Passed", "Exception", "Partial", "N/A"] as const;
export const AUDIT_STATUS = ["Planned", "In progress", "Completed", "On hold"] as const;
export const AUDIT_STATUS_HEX: Record<string, string> = {
  Planned: "#64748b",
  "In progress": "#c9a300",
  Completed: "#2e7d32",
  "On hold": "#b00020",
};
export const ASSURANCE = [
  "High assurance",
  "Moderate assurance",
  "Limited assurance",
  "No assurance",
];

/** Comment classification tags: [label, background, colour]. */
export const OBS_COMMENT_TAGS: Record<string, [string, string, string]> = {
  feedback: ["feedback", "#e9f8f2", "#0d5a47"],
  progress: ["progress report", "#fbf3dd", "#a67c00"],
  closure: ["closure", "#eaf5eb", "#2e7d32"],
  closure_update: ["closure update", "#e7eef5", "#2c5f8a"],
  private: ["private", "#eef2ff", "#4b3fa0"],
};

export type ThreadEntry = Partial<ObsUpdate> & { tag?: string };
export function obsCommentTag(u: ThreadEntry): string {
  return u.tag || (u.audience === "owner" ? "private" : u.kind === "progress" ? "progress" : "feedback");
}

export function statusClass(s: string | undefined): string {
  return s === "Closed" ? "s-Closed" : s === "In Progress" ? "s-InProgress" : "s-Open";
}
/** QA-14 — re-exported from lib/permissions so there is one role→label map, not six. */
export { roleLabel } from "@/lib/permissions";
export function hasExecSummary(r: Report | undefined): boolean {
  return !!(
    r &&
    (r.objective || r.outOfScope || r.strengths || r.areasForImprovement || r.auditOpinion || r.conclusion || r.assuranceLevel)
  );
}
export function obsSortByAdded(a: Observation, b: Observation): number {
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return tb - ta;
}
export function isRecentlyCreated(o: Observation | undefined): boolean {
  if (!o || !o.createdAt) return false;
  return Date.now() - new Date(o.createdAt).getTime() < 24 * 60 * 60 * 1000;
}
export function stampClosed(o: Observation, status: string | undefined): void {
  if (status === "Closed") {
    if (!o.closedDateISO) o.closedDateISO = isoNow();
  } else {
    o.closedDateISO = "";
  }
}
export function obsWithdrawStage(o: Observation | undefined | null): string {
  return (o && o.withdrawal && (o.withdrawal.stage as string)) || "";
}
export function obsUpdates(o: Observation): ObsUpdate[] {
  o.updates = o.updates || [];
  return o.updates;
}

export function isWithdrawn(o: Observation | undefined | null): boolean {
  return !!(o && (o.withdrawn || obsWithdrawStage(o) === "withdrawn"));
}

/* ---------------- the observation conversation thread ----------------
   Port of the thread assembly inside legacy renderObservation / obsRemediationHTML. Two rules
   matter and both were missing from the first React port:

   1. The thread is NOT just `o.updates`. Three closure-stage entries are appended so the
      closure package reads as part of the conversation rather than a separate panel.
   2. It is audience-filtered. `audience: "owner"` is a private owner-to-owner note and must
      never reach Internal Audit or the Head; `audience: "ia_only"` (e.g. a Head→auditor
      rejection note) must never reach an action owner. Rendering the raw array leaks both. */
export function obsThread(o: Observation, ownerViewer: boolean): ThreadEntry[] {
  const closed = o.status === "Closed";
  const entries: ThreadEntry[] = [...obsUpdates(o)];

  // Owners always see their own closure response; everyone sees it once closed.
  if (o.ownerResponse && (closed || ownerViewer)) {
    entries.push({
      text: o.ownerResponse,
      byName: o.ownerRectifiedByName || "",
      role: "action_owner",
      at: o.ownerRectifiedAt || "",
      tag: "closure",
      evidence: o.ownerResponseEvidence || [],
    });
  }
  if (o.closureNote && closed) {
    entries.push({
      text: o.closureNote,
      byName: o.reportVerifiedByName || "",
      role: "audit_staff",
      at: o.reportVerifiedAt || "",
      tag: "closure_update",
      evidence: o.closureFile ? [o.closureFile] : [],
    });
  }
  if (o.headComment && closed) {
    entries.push({
      text: o.headComment,
      byName: o.headVerifiedByName || "",
      role: "head_of_audit",
      at: o.headVerifiedAt || "",
      tag: "closure_update",
    });
  }

  return entries
    .filter((u) => (u.audience !== "owner" || ownerViewer) && (u.audience !== "ia_only" || !ownerViewer))
    .sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
}

/* ---------------- audit-plan test accessors ----------------
   Legacy audit-bot.js writes `title` / `controlTested` / `resultNotes`; an earlier React
   dialog wrote `name` / `control` / `notes`. Read legacy-first with fallback so both eras
   of data render. */

export function testTitle(t: AuditTest): string {
  return String(t.title || t.name || "");
}
export function testControl(t: AuditTest): string {
  return String(t.controlTested || t.control || "");
}
export function testResultNotes(t: AuditTest): string {
  return String(t.resultNotes || t.notes || "");
}
export function testIsException(t: AuditTest): boolean {
  return t.result === "Exception" || t.result === "Partial";
}

/* ---------------- role & verification checks ---------------- */

export function isHead(user: SessionUser): boolean {
  return effectiveRole(user) === "head_of_audit";
}
export function isActionOwner(user: SessionUser): boolean {
  return effectiveRole(user) === "action_owner";
}

// Check if user is admin with specific active role
export function isAdminWithRole(user: SessionUser, role: string): boolean {
  return isAdmin(user) && user.activeRole === role;
}

// Check if user is admin who should receive head notifications
export function isAdminHead(user: SessionUser): boolean {
  return isAdmin(user) && (!user.activeRole || user.activeRole === "head_of_audit");
}

// Check if user is admin who should receive owner notifications
export function isAdminOwner(user: SessionUser): boolean {
  return isAdmin(user) && (!user.activeRole || user.activeRole === "action_owner");
}
export function isPrimaryOwner(user: SessionUser, o: Observation | undefined): boolean {
  return !!(o && o.ownerUserId && o.ownerUserId === user.id);
}
export function isSecondaryOwner(user: SessionUser, o: Observation | undefined): boolean {
  return !!(o && o.secondaryOwnerUserId && o.secondaryOwnerUserId === user.id);
}
/** Either owner. Gates the owner-side view: private notes, the composer, oversight copy. */
export function isOwnerViewer(user: SessionUser, o: Observation | undefined): boolean {
  return isPrimaryOwner(user, o) || isSecondaryOwner(user, o);
}
/* DEPARTS FROM LEGACY (deliberate, requested 2026-07-29): legacy gated "Ready for Closure" on
   isPrimaryOwner alone — a secondary owner could comment but not respond, and the legacy modal
   hard-refused them. Co-owners now carry the same responsibility as the primary owner. The
   server already permitted this: workspace-authz reconciles observations by ROLE, never by
   which user owns the record, so no authz change was needed to enable it. */
export function canRespondToObs(user: SessionUser, o: Observation | undefined): boolean {
  return isOwnerViewer(user, o);
}
/** The Head or the audit's lead auditor can verify anything on the report. */
export function canVerifyReport(user: SessionUser, a: Audit | undefined): boolean {
  return isHead(user) || !!(a && a.leadAuditorId && a.leadAuditorId === user.id);
}
/** …plus the auditor who raised the item. */
export function canVerifyItem(
  user: SessionUser,
  o: Observation | undefined,
  a: Audit | undefined,
): boolean {
  return canVerifyReport(user, a) || !!(o && o.raisedBy && o.raisedBy === user.id);
}

/* ---------------- locate ---------------- */

/** Legacy findObs — aid "ext" resolves against the external findings register. */
export function findObsIn(
  db: WorkspaceDb,
  aid: string,
  rid: string,
  oid: string,
): Observation | null {
  if (aid === "ext") return (extList(db).find((x) => x.id === oid) as Observation | undefined) || null;
  const a = (db.audits || []).find((x) => x.id === aid);
  const r = a && (a.reports || []).find((x) => x.id === rid);
  return (r && (r.observations || []).find((x) => x.id === oid)) || null;
}

/* ---------------- pending approvals bookkeeping ---------------- */

export function pendingStatusChange(db: WorkspaceDb, oid: string): Approval | undefined {
  return approvals(db).find((a) => a.kind === "observation_status_change" && a.obsId === oid && a.status === "pending");
}
export function pendingUpdate(db: WorkspaceDb, oid: string): Approval | undefined {
  return approvals(db).find((a) => a.kind === "observation_update" && a.obsId === oid && a.status === "pending");
}
export function pendingDelete(db: WorkspaceDb, oid: string): Approval | undefined {
  return approvals(db).find((a) => a.kind === "observation_delete" && a.obsId === oid && a.status === "pending");
}
function supersede(db: WorkspaceDb, kind: string, oid: string, user: SessionUser): void {
  approvals(db).forEach((a) => {
    if (a.kind === kind && a.obsId === oid && a.status === "pending") {
      a.status = "superseded";
      a.decidedBy = user.id || "";
      a.decidedByName = user.name || "";
      a.decidedAt = new Date().toISOString();
    }
  });
}
export function cancelPendingStatusChange(db: WorkspaceDb, oid: string, user: SessionUser): void {
  supersede(db, "observation_status_change", oid, user);
}
export function supersedePendingUpdate(db: WorkspaceDb, oid: string, user: SessionUser): void {
  supersede(db, "observation_update", oid, user);
}
export function cancelPendingDelete(db: WorkspaceDb, oid: string, user: SessionUser): void {
  supersede(db, "observation_delete", oid, user);
}

/* ---------------- notifications (workspace bell + email fan-out) ---------------- */

export function notify(
  db: WorkspaceDb,
  userId: string | undefined,
  kind: string,
  text: string,
  link: string,
  obsId?: string,
): void {
  if (!userId) return;
  db.notifications = db.notifications || [];
  db.notifications.push({
    id: uid(),
    userId,
    kind: kind || "info",
    text: text || "",
    link: link || "",
    obsId: obsId || "",
    read: false,
    at: new Date().toISOString(),
  });
}

export function notifyBoth(
  db: WorkspaceDb,
  userId: string | undefined,
  kind: string,
  text: string,
  link: string,
  subject: string,
  body: string,
  obsId?: string,
): void {
  if (!userId) return;
  notify(db, userId, kind, text, link, obsId);
  const e = ownerEmailFor(db, userId);
  if (e) emailNotify([e], subject || "AuditLens notification", body || text);
}

export function notifyHeadsApproval(db: WorkspaceDb, title: string): void {
  const heads = headUsers();
  heads.forEach((h) => notify(db, h.id, "approval_needed", "Approval needed: " + title, "approvals"));
  
  // Send regular head notifications (including admin users acting as heads)
  emailNotify(
    heads.map((h) => h.email || "").filter(Boolean),
    "AuditLens — approval needed",
    `The observation "${title}" was raised and needs your approval in AuditLens.`,
  );
}

export function notifyOwnerAssigned(db: WorkspaceDb, o: Observation): void {
  if (!o) return;
  const primaryName = ownerNameFor(db, o.ownerUserId) || o.owner || "the primary action owner";
  
  // Track admin users who need consolidated notifications
  const adminNotifications: { email: string; name: string; headNotifs: { title: string; link: string }[]; ownerNotifs: { title: string; link: string }[] }[] = [];
  
  if (o.ownerUserId) {
    notify(db, o.ownerUserId, "assigned", "New action assigned to you: " + o.title, "myobs", o.id);
    const e = ownerEmailFor(db, o.ownerUserId);
    const u = dirUser(o.ownerUserId);
    
    // Check if this is an admin user
    if (u && u.role === "admin") {
      // Find or create admin notification record
      let adminRec = adminNotifications.find(a => a.email === e);
      if (!adminRec && e) {
        adminRec = { email: e, name: u.name, headNotifs: [], ownerNotifs: [] };
        adminNotifications.push(adminRec);
      }
      if (adminRec) {
        adminRec.ownerNotifs.push({ title: o.title, link: "myobs" });
      }
    } else if (e) {
      // Regular owner notification
      emailNotify(
        [e],
        "AuditLens — An Observation was raised against your department",
        `An audit observation "${o.title}" has been raised against your department and assigned to you as the primary action owner. Sign in to AuditLens to view the details, respond and close the observation.`,
      );
    }
  }
  
  if (o.secondaryOwnerUserId && o.secondaryOwnerUserId !== o.ownerUserId) {
    notify(db, o.secondaryOwnerUserId, "assigned", "You have oversight on: " + o.title, "myobs", o.id);
    const e2 = ownerEmailFor(db, o.secondaryOwnerUserId);
    const u2 = dirUser(o.secondaryOwnerUserId);
    
    // Check if this is an admin user
    if (u2 && u2.role === "admin") {
      let adminRec = adminNotifications.find(a => a.email === e2);
      if (!adminRec && e2) {
        adminRec = { email: e2, name: u2.name, headNotifs: [], ownerNotifs: [] };
        adminNotifications.push(adminRec);
      }
      if (adminRec) {
        adminRec.ownerNotifs.push({ title: o.title + " (oversight)", link: "myobs" });
      }
    } else if (e2) {
      // Regular owner notification
      emailNotify(
        [e2],
        "AuditLens — observation raised (oversight)",
        `An audit observation "${o.title}" has been raised against your department and assigned to ${primaryName}. You have oversight of the remediation — sign in to AuditLens to follow progress and add comments.`,
      );
    }
  }
  
  // Send consolidated emails to admin users (server-side via /api/notify)
  for (const admin of adminNotifications) {
    if (admin.ownerNotifs.length > 0) {
      emailAdminConsolidated({
        to: admin.email,
        name: admin.name,
        headNotifications: admin.headNotifs,
        ownerNotifications: admin.ownerNotifs,
      });
    }
  }
}

/* ---------------- repeat detection (fuzzy title match) ---------------- */

const REP_STOP = new Set(
  "the a an of in for to and or on at by with from is are was were not no this that these those over under within across into out control controls gap gaps deficiency deficiencies weakness weaknesses inadequate inadequacy lack absence ambiguity ambiguities issue issues observed observation observations finding findings risk risks process processes governance people system systems".split(
    /\s+/,
  ),
);
function repTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !REP_STOP.has(w));
}
function repBigrams(s: string): string[] {
  s = (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const g: string[] = [];
  for (let i = 0; i < s.length - 1; i++) g.push(s.slice(i, i + 2));
  return g;
}
function repDice(a: string, b: string): number {
  const A = repBigrams(a), B = repBigrams(b);
  if (!A.length || !B.length) return 0;
  const m: Record<string, number> = {};
  A.forEach((g) => (m[g] = (m[g] || 0) + 1));
  let inter = 0;
  B.forEach((g) => {
    if (m[g] > 0) {
      inter++;
      m[g]--;
    }
  });
  return (2 * inter) / (A.length + B.length);
}
function repSim(a: string, b: string): { score: number; shared: number; dice: number } {
  const ta = repTokens(a), tb = repTokens(b);
  if (!ta.length || !tb.length) return { score: 0, shared: 0, dice: 0 };
  const A = new Set(ta), B = new Set(tb);
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  const jac = inter / (A.size + B.size - inter);
  const dice = repDice(a, b);
  return { score: 0.65 * jac + 0.35 * dice, shared: inter, dice };
}

export type RepeatCandidate = { score: number; obs: Observation; report: Report; audit: Audit };
export function findRepeatCandidates(
  db: WorkspaceDb,
  title: string,
  excludeReportId: string,
  excludeObsId: string,
): RepeatCandidate[] {
  if (!title || title.trim().length < 4) return [];
  const out: RepeatCandidate[] = [];
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) => {
      if (r.id === excludeReportId) return; // only OTHER reports
      (r.observations || []).forEach((o) => {
        if (o.id === excludeObsId) return;
        const s = repSim(title, o.title);
        if ((s.shared >= 1 && s.score >= 0.33) || s.dice >= 0.62)
          out.push({ score: s.score, obs: o, report: r, audit: a });
      });
    }),
  );
  return out.sort((x, y) => y.score - x.score).slice(0, 5);
}
export function repLabel(c: RepeatCandidate): string {
  return (
    (c.report.refNo || c.report.title) +
    (c.report.period ? " (" + c.report.period + ")" : "") +
    " — " +
    c.obs.title
  );
}
export type PriorObs = { ref: string; title: string; audit: string; report: string; status: string };
export function priorObsForRepeat(db: WorkspaceDb, rid: string): PriorObs[] {
  const out: PriorObs[] = [];
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) => {
      if (r.id === rid) return;
      (r.observations || []).forEach((o) =>
        out.push({ ref: o.ref || o.id, title: o.title, audit: a.name, report: r.title, status: (o.status as string) || "Open" }),
      );
    }),
  );
  return out;
}

/* ---------------- AI draft & CSV import ---------------- */

export function normCrit(s: string | undefined): string {
  s = (s || "").trim();
  if (!s) return "Moderate";
  if (/^med/i.test(s)) return "Moderate";
  if (/^pi$|^proc|improv/i.test(s)) return "Process Improvement";
  return CRITS.find((c) => c.toLowerCase() === s!.toLowerCase()) || "Moderate";
}

export type AiObsDraft = Record<string, unknown>;
export function obsFromAi(d: AiObsDraft): Observation {
  let crit = String(d.criticality || "Moderate");
  crit = CRITS.find((c) => c.toLowerCase() === crit.toLowerCase()) || "Moderate";
  return {
    id: uid(),
    ref: String(d.ref || ""),
    title: String(d.title || "(untitled)"),
    category: String(d.category || ""),
    description: String(d.description || ""),
    criteria: String(d.criteria || ""),
    risk: String(d.risk || d.impact || ""),
    rootCause: String(d.rootCause || d.root_cause || ""),
    recommendation: String(d.recommendation || ""),
    sopUpdate: "",
    criticality: crit as Observation["criticality"],
    managementResponse: "",
    owner: String(d.owner || ""),
    timeline: TIMELINES.includes(d.timeline as (typeof TIMELINES)[number]) ? (d.timeline as string) : "",
    dueDate: "",
    agreedTarget: String(d.agreedTarget || d.agreed_target || ""),
    isRepeat: false,
    repeatOf: "",
    status: "Open",
    createdAt: new Date().toISOString(),
  };
}

export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function findOrCreateAudit(db: WorkspaceDb, name: string, type: string, area: string): Audit {
  let a = (db.audits || []).find((x) => x.name.toLowerCase().trim() === name.toLowerCase().trim());
  if (!a) {
    a = {
      id: uid(),
      name: name.trim(),
      type: type && /^dep/i.test(type.trim()) ? "department" : "process",
      area: area || "",
      period: "",
      leadAuditor: "",
      status: "In progress",
      createdAt: new Date().toISOString(),
      reports: [],
    };
    db.audits.push(a);
  } else if (area && !a.area) {
    a.area = area;
  }
  return a;
}
export function findOrCreateReport(a: Audit, title: string): Report {
  let r = (a.reports || []).find((x) => x.title.toLowerCase().trim() === title.toLowerCase().trim());
  if (!r) {
    r = {
      id: uid(),
      title: title.trim(),
      refNo: "",
      period: a.period || "",
      status: "Draft",
      scope: "",
      createdAt: new Date().toISOString(),
      observations: [],
    };
    a.reports.push(r);
  }
  return r;
}

/* ---------------- report refs & quarters ---------------- */

export function nextReportRef(db: WorkspaceDb): string {
  const year = new Date().getFullYear();
  let max = 0;
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) => {
      const m = String(r.refNo || "").match(/(\d{1,4})\s*$/);
      if (m) {
        const n = +m[1];
        if (n > max) max = n;
      }
    }),
  );
  let ref = "";
  let n = max;
  const existing = new Set<string>();
  (db.audits || []).forEach((a) => (a.reports || []).forEach((r) => existing.add((r.refNo || "").trim())));
  do {
    n++;
    ref = "IA/" + year + "/" + String(n).padStart(3, "0");
  } while (existing.has(ref) && n < 9999);
  return ref;
}
export function curQuarter(): string {
  const d = new Date();
  return "Q" + (Math.floor(d.getMonth() / 3) + 1) + " " + d.getFullYear();
}
export function quarterChoices(sel?: string): string[] {
  const y = new Date().getFullYear();
  const opts: string[] = [];
  for (let yr = y + 1; yr >= y - 2; yr--) for (let q = 4; q >= 1; q--) opts.push("Q" + q + " " + yr);
  if (sel && !opts.includes(sel)) opts.unshift(sel);
  return opts;
}

/* ---------------- criticality tallies ---------------- */

export function zc(): Record<string, number> {
  const o: Record<string, number> = {};
  CRITS.forEach((c) => (o[c] = 0));
  return o;
}
export function worstCrit(c: Record<string, number>, n: number): string {
  return n ? CRITS.find((k) => c[k] > 0) || "Low" : "—";
}

/* ---------------- departments & assignment choices ---------------- */

export function departments(db: WorkspaceDb) {
  db.departments = db.departments || [];
  return db.departments;
}
export function deptById(db: WorkspaceDb, id: string | undefined) {
  return departments(db).find((d) => d.id === id);
}
