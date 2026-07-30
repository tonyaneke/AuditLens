import type { WorkspaceDb } from "./db-data";
import { effectiveRole, type SessionUser } from "./permissions";

/* SEC-01 — who may SEE what in the workspace document.
 *
 * GET /api/data used to return the complete organisation dataset to every authenticated user.
 * The client-side route guard only hides sidebar links; calling the API directly returned all
 * observations, the whole fraud register, every external finding, the audit universe and the
 * approvals queue — to action owners whose UI shows six screens about their own remediation.
 *
 * This module is the single definition of visibility, and it is deliberately shared by BOTH
 * sides of the request:
 *
 *   - GET  — slimForClient() calls scopeWorkspace() to build the payload.
 *   - PUT  — authorizeWorkspaceWrite() calls the canSee* predicates so it can tell
 *            "absent because the client was never given it" (keep stored, silently) apart from
 *            "absent though visible" (a delete attempt → violation).
 *
 * They MUST NOT drift. If the read trims a record the write does not know about, an owner's
 * ordinary save — which now legitimately omits ~100 observations it never received — logs ~100
 * bogus `obs_delete_blocked` violations against `security.workspace_write_filtered`, and the
 * security trail becomes noise. That coupling is the reason this lives in one file.
 *
 * Scope is by ROLE, not department: `User.department` is display-only free text, `Audit` carries
 * no department at all, and Internal Audit staff are expected to audit across the whole
 * organisation. Head of Audit and audit staff therefore keep the full document; action owners
 * get their own records and nothing else.
 */

export type Viewer = { id: string; role: string };

type Obj = Record<string, unknown>;

const HEAD_ROLE = "head_of_audit";
const STAFF_ROLE = "audit_staff";

// Roles that legitimately need the whole document. Everything else is scoped to its own records.
const FULL_SCOPE_ROLES = new Set([HEAD_ROLE, STAFF_ROLE]);

/** The viewer a session represents. Uses effectiveRole so an admin viewing as an action owner is
 *  scoped like an action owner — the same rule the UI applies. */
export function viewerFor(session: {
  id: string;
  role: string;
  activeRole?: string;
}): Viewer {
  return { id: session.id, role: effectiveRole(session as SessionUser) };
}

export function isFullScope(viewer: Viewer): boolean {
  return FULL_SCOPE_ROLES.has(viewer.role);
}

export function isHead(viewer: Viewer): boolean {
  return viewer.role === HEAD_ROLE;
}

/* ---------------- record-level predicates ----------------
   Structurally typed so they work against both the loose server-side WorkspaceDb and the strict
   client types in lib/workspace/types.ts. The ownership rule is the one in
   lib/workspace/portal.ts (myObsList / myExtList): primary OR secondary owner, with the truthy
   guards that stop an undefined userId matching an unassigned record. */

export function ownedBy(
  rec: { ownerUserId?: unknown; secondaryOwnerUserId?: unknown } | null | undefined,
  userId: string | undefined,
): boolean {
  if (!rec || !userId) return false;
  return (
    (!!rec.ownerUserId && rec.ownerUserId === userId) ||
    (!!rec.secondaryOwnerUserId && rec.secondaryOwnerUserId === userId)
  );
}

// Mirrors isWithdrawn() in lib/workspace/selectors.ts:166.
function obsWithdrawn(o: Obj): boolean {
  const w = o.withdrawal as Obj | undefined;
  return !!(o.withdrawn || (w && w.stage === "withdrawn"));
}

// Mirrors obsIsApproved() in lib/workspace/selectors.ts:169.
function obsApproved(o: Obj): boolean {
  return o.obsApproval !== "pending" && o.obsApproval !== "rejected";
}

/** An observation an action owner may see: assigned to them, and either approved (myObsList) or
 *  withdrawn (myWithdrawnObs). One still awaiting Head approval is not yet a finding and is not
 *  theirs to read. */
export function canSeeObs(o: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  return ownedBy(o, viewer.id) && (obsApproved(o) || obsWithdrawn(o));
}

/** Mirrors myExtList(). */
export function canSeeExt(f: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  return ownedBy(f, viewer.id);
}

/** Mirrors myFraudRisks(): the risk is theirs, or any of its prevention actions is individually
 *  assigned to them. Note fraud risks use risk-level `ownerUserId` only — there is no secondary
 *  owner on a risk — but ownedBy() is harmless here and keeps one rule. */
export function canSeeFraudRisk(f: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  if (f.ownerUserId === viewer.id && !!viewer.id) return true;
  return fraudActionsOf(f).some((a) => !!a.ownerUserId && a.ownerUserId === viewer.id);
}

/** Mirrors myFraudActionsFor(): all actions when the risk itself is theirs, otherwise only the
 *  actions assigned to them directly. */
export function canSeeFraudAction(risk: Obj, action: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  if (!!viewer.id && risk.ownerUserId === viewer.id) return true;
  return !!action.ownerUserId && action.ownerUserId === viewer.id;
}

/** Read-only equivalent of fraudActionsView() — a risk still carrying only the pre-migration
 *  single `preventionAction` has no actions array yet. Returns [] rather than synthesising one:
 *  the synthetic action is a rendering concern, and scoping must not invent records. */
function fraudActionsOf(f: Obj): Obj[] {
  return Array.isArray(f.actions) ? (f.actions as Obj[]) : [];
}

function asArray(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}

/** Every observation id this viewer can see — used to scope the approvals queue, and by the
 *  write path to resolve approvals that reference an observation. */
export function visibleObsIds(db: WorkspaceDb, viewer: Viewer): Set<string> {
  const ids = new Set<string>();
  for (const a of asArray(db.audits)) {
    for (const r of asArray(a.reports)) {
      for (const o of asArray(r.observations)) {
        if (canSeeObs(o, viewer)) ids.add(String(o.id));
      }
    }
  }
  return ids;
}

/* ---------------- the document trim ---------------- */

/* An owner's document is built as an ALLOWLIST — sections are copied in, never deleted out — so
   a new top-level section added to the workspace later is invisible to owners by default rather
   than leaking until someone remembers to deny it.
   Omitted by construction: auditUniverse, processReviews, iaSAList/iaSACurrentId/iaSA, exco,
   caeReport, extCommentary, fraudPlanNarrative, fraudUpdate, planYears, lastBackup, logo. Every
   one of those sits outside NON_HEAD_WRITABLE_SECTIONS in lib/workspace-authz.ts, so the write
   path restores them from storage — omitting them here cannot lose data. */

// Branding and labels the shell renders for every role.
const OWNER_KEPT_SCALARS = ["org", "signOffName", "signOffTitle", "planYear"];

/**
 * The workspace document as this viewer is allowed to see it.
 *
 * Full-scope roles get the document unchanged. An action owner gets: the audits/reports skeleton
 * for the observations assigned to them (the shell needs `_a`/`_r` context and the
 * audit/report ids to build observation URLs), their own external findings, the fraud risks they
 * implement actions on, approvals that concern them, and department names.
 */
export function scopeWorkspace(db: WorkspaceDb, viewer: Viewer): WorkspaceDb {
  if (isFullScope(viewer)) return db;

  const src = db as Obj;
  const out: Obj = {};

  for (const key of OWNER_KEPT_SCALARS) {
    if (src[key] !== undefined) out[key] = src[key];
  }

  // Audits and reports survive only where they still hold a visible observation. Report
  // metadata rides along (the portal reads _a.name / _a.area, and due-date maths reads the
  // report date) minus execSummary, which is an Internal Audit narrative, not owner content.
  const audits: Obj[] = [];
  for (const a of asArray(src.audits)) {
    const reports: Obj[] = [];
    for (const r of asArray(a.reports)) {
      const observations = asArray(r.observations).filter((o) => canSeeObs(o, viewer));
      if (!observations.length) continue;
      const { execSummary: _dropped, ...restReport } = r;
      void _dropped;
      reports.push({ ...restReport, observations });
    }
    if (reports.length) audits.push({ ...a, reports });
  }
  out.audits = audits;

  out.extFindings = asArray(src.extFindings).filter((f) => canSeeExt(f, viewer));

  out.fraudRisks = asArray(src.fraudRisks)
    .filter((f) => canSeeFraudRisk(f, viewer))
    .map((f) => {
      if (!Array.isArray(f.actions)) return f;
      return { ...f, actions: fraudActionsOf(f).filter((a) => canSeeFraudAction(f, a, viewer)) };
    });

  // Notifications are filtered again in slimForClient() (that trim applies to every role,
  // including the Head). Carried through untouched here.
  if (src.notifications !== undefined) out.notifications = src.notifications;

  const obsIds = visibleObsIds(db, viewer);
  out.approvals = asArray(src.approvals).filter(
    (ap) =>
      (!!viewer.id && ap.requestedBy === viewer.id) ||
      (!!ap.obsId && obsIds.has(String(ap.obsId))),
  );

  // Departments resolve observation.departmentId to a label. The head's name and email are
  // directory data an owner has no need for in this payload.
  out.departments = asArray(src.departments).map((d) => ({ id: d.id, name: d.name }));

  return out as WorkspaceDb;
}
