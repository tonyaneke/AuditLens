import type { WorkspaceDb } from "./db-data";
import { slimForClient } from "./workspace-payload";
import { FRAUD_VALIDATED, fraudActionDone } from "./workspace/fraud";
import {
  canSeeExt,
  canSeeFraudAction,
  canSeeFraudRisk,
  canSeeObs,
  isFullScope,
  viewerFor,
  visibleObsIds,
  type Viewer,
} from "./workspace-scope";

// Server-side authorization for writes to the shared workspace document (/api/data PUT).
//
// The whole workspace is one JSON blob that the client overwrites on every save. Role restrictions
// in the UI (who may edit/delete/withdraw/close observations, decide approvals, edit assessments,
// etc.) are therefore NOT self-enforcing — a crafted client could PUT anything. This module
// re-imposes those rules on the server: for a non-head user it rebuilds the document from the stored
// copy and re-applies only the changes that role is permitted to make. A well-behaved client never
// sends anything disallowed, so `data` comes back identical; a malicious one is silently neutralised.
//
// SEC-01 — since GET now scopes the document (lib/workspace-scope.ts), a scoped client's save
// legitimately OMITS every record it was never given. Each reconciler below therefore splits the
// "stored but missing from the incoming document" case three ways:
//
//   visible + missing      → delete attempt: violation, keep stored           (unchanged)
//   not visible + missing  → simply not sent: keep stored, NO violation       (new)
//   not visible + present  → sending back a record it never received:
//                            violation `out_of_scope_write`, keep stored      (new, tightening)
//
// Without the middle case an owner's ordinary save would log ~100 bogus `obs_delete_blocked`
// violations and drown the security trail. The third case makes an unseen record fully immutable,
// so no field-level reconciliation is needed for it at all.

const HEAD_ROLE = "head_of_audit";
const STAFF_ROLE = "audit_staff";

// Top-level sections a non-head user may modify. Everything else (auditUniverse,
// processReviews, the legacy single iaSA, planYear, org, signOff*, logo, branding, departments, exco*, …) is
// locked to the stored value — the default-deny that closes head-only content to non-head writes.
// fraudRisks/extFindings/notifications are in the set because they are reconciled below: action
// owners may write ONLY their own remediation surface, never the registers themselves.
const NON_HEAD_WRITABLE_SECTIONS = new Set([
  "audits",
  "extFindings",
  "approvals",
  "notifications",
  "fraudRisks",
  "iaSAList",
  "iaSAUserCurrent",
]);

// The implementation-progress surface of a fraud prevention action — what an assigned action
// owner reports back on, including the evidence files attached to each ownerUpdates entry.
// Everything else about a risk/action is IA-managed, including the "Validated" status and its
// note and working papers (see reconcileFraudRisks).
const OWNER_FRAUD_ACTION_FIELDS = ["status", "update", "ownerUpdates"];

/* The remediation surface of an external / regulatory finding — the mirror of
   OWNER_FRAUD_ACTION_FIELDS for extFindings. Everything else (severity, source, the finding text,
   owner assignment, target dates, the verification chain) is Internal-Audit-managed.
   `status` is NOT here: it is derived server-side from ownerRectifiedAt, exactly as observation
   status is, so an owner cannot write "Closed" directly. */
const OWNER_EXT_FIELDS = [
  "ownerResponse",
  "ownerResponseEvidence",
  "ownerRectifiedBy",
  "ownerRectifiedByName",
  "ownerRectifiedAt",
  "updates",
];

// A single save should never carry more than a handful of new notifications; a few hundred is
// already pathological. Caps a notification-flood via the workspace document.
const MAX_NEW_NOTIFICATIONS = 200;

// Observation fields that change only through an approved workflow or a head action. A non-head
// write can never alter these directly; they are forced back to the stored value.
const CONTROLLED_OBS_FIELDS = [
  "ref", "title", "category", "description", "criteria", "risk", "rootCause", "recommendation",
  "sopUpdate", "criticality", "managementResponse", "timeline", "dueDate", "isRepeat", "repeatOf",
  "owner", "ownerUserId", "departmentId", "secondaryOwner", "secondaryOwnerUserId",
  "status", "closedDateISO", "withdrawn", "withdrawnAt", "obsApproval", "rejectionFinal",
  "headVerifiedAt", "headVerifiedByName", "headComment", "closureRejection",
];
// Also locked for action owners: only auditors/head verify remediation or request updates.
// `attachments` is here because it is Internal Audit's supporting-document set for the finding —
// an owner adds their own evidence through `updates` and their closure response, and must not be
// able to rewrite or drop the papers the observation was raised on.
const AUDITOR_ONLY_OBS_FIELDS = [
  "reportVerifiedAt", "reportVerifiedByName", "closureNote", "closureEvidence", "closureFile", "closureFiles",
  "updateRequestedAt", "updateRequestedBy", "progressReport", "attachments",
];
// Controlled fields that audit staff may update directly to reassign an observation.
const STAFF_REASSIGN_FIELDS = new Set([
  "owner", "ownerUserId", "departmentId", "secondaryOwner", "secondaryOwnerUserId", "dueDate",
]);
/* A raise the Head REJECTED is sent back to Internal Audit for rework, not killed: staff may
   rewrite its content and resubmit it (rejected → pending). It was never published — owners
   cannot see it (canSeeObs) — so this is still their draft, not a live finding. Everything that
   is a decision stays locked: status, closure, withdrawal, and any obsApproval other than the
   one resubmit step. `ref` stays system-assigned. A rejection the Head made FINAL
   (`rejectionFinal`, head-only) is closed: no rework and no resubmit. */
const STAFF_REWORK_FIELDS = new Set([
  "title", "category", "description", "criteria", "risk", "rootCause", "recommendation",
  "sopUpdate", "criticality", "managementResponse", "timeline", "isRepeat", "repeatOf",
]);
const WITHDRAWAL_HEAD_FIELDS = ["headBy", "headByName", "headAt", "headReason"];
const WITHDRAWAL_FINAL_STAGES = ["withdrawn", "rejected"];

/* Audit governance metadata — the "✎ Edit Audit" dialog. Staff may write all of it (see
   reconcileAudits), but unlike routine fieldwork these changes are worth a server-side record:

     leadAuditorId  who is accountable for the engagement: it is who hears about its findings
                    (internalAuditWatcherIds) and whose "My audits" list it is on. It grants no
                    sign-off right — any audit staff member may verify (see justVerified) — but a
                    change of lead is still a change of accountability, so it is attributed.
     name / status / …  a rename or a premature "Completed" silently rewrites what the Word
                    exports and the EXCO brief say about an engagement already reported on.

   `plan` and `tor` are deliberately absent: recording a test result is ordinary fieldwork and
   would bury the entries above in noise. */
const AUDIT_GOVERNANCE_FIELDS = [
  "name", "type", "area", "period", "status", "leadAuditor", "leadAuditorId",
];

type Obj = Record<string, unknown>;

/** `violations` are changes that were REVERTED. `notices` are changes that were ALLOWED but are
 *  worth flagging for the security trail on top of the ordinary change entry that
 *  lib/workspace-changes.ts derives from every save. Both are recorded by app/api/data/route.ts. */
export type AuthzResult = { data: WorkspaceDb; violations: string[]; notices: string[] };

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function forceField(target: Obj, field: string, value: unknown): void {
  if (value === undefined) delete target[field];
  else target[field] = value;
}
function asArray(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}

export function authorizeWorkspaceWrite(
  role: string,
  userId: string,
  current: WorkspaceDb,
  incoming: WorkspaceDb,
  activeRole?: string,
  department?: string,
  extraDepartments?: string[],
): AuthzResult {
  /* Effective role and visibility come from one place each: effectiveRole() via viewerFor()
     (an admin acts as their switched activeRole, defaulting to head until they pick one). This
     used to be re-implemented inline here, which meant two copies of one security rule.
     The viewer is built against the STORED document, so the department scope a write is judged
     by is the one the server already served on GET — a client cannot widen its own scope by
     inventing department records in the document it sends back (`departments` is a locked
     section anyway, but the ordering is what makes that guarantee unconditional). */
  const viewer = viewerFor({ id: userId, role, activeRole, department, extraDepartments }, current);
  const effective = viewer.role;

  // The Head of Audit is fully trusted with the workspace document.
  if (effective === HEAD_ROLE) return { data: incoming, violations: [], notices: [] };

  const cur = (current || {}) as Obj;
  const inc = (incoming || {}) as Obj;
  const violations: string[] = [];
  const notices: string[] = [];

  // Start from the stored document — this locks every head-only section by default...
  const next = structuredClone(cur) as Obj;

  // ...then re-apply only the sections a non-head user is allowed to touch.
  next.notifications = reconcileNotifications(
    asArray(cur.notifications),
    asArray(inc.notifications),
    userId,
    violations,
  );
  next.extFindings = reconcileExtFindings(
    asArray(cur.extFindings),
    asArray(inc.extFindings),
    effective,
    userId,
    viewer,
    violations,
  );
  next.audits = reconcileAudits(
    asArray(cur.audits),
    asArray(inc.audits),
    effective,
    userId,
    viewer,
    violations,
    notices,
  );
  next.approvals = reconcileApprovals(
    asArray(cur.approvals),
    asArray(inc.approvals),
    current,
    viewer,
    violations,
  );
  next.fraudRisks = reconcileFraudRisks(
    asArray(cur.fraudRisks),
    asArray(inc.fraudRisks),
    effective,
    userId,
    viewer,
    violations,
  );

  // Audit staff maintain fraud plan narrative and BAC quarterly updates alongside the register.
  if (effective === STAFF_ROLE) {
    if (inc.fraudPlanNarrative !== undefined) next.fraudPlanNarrative = inc.fraudPlanNarrative;
    if (inc.fraudUpdate !== undefined) next.fraudUpdate = inc.fraudUpdate;
    next.iaSAList = reconcileIaSaList(
      asArray(cur.iaSAList),
      asArray(inc.iaSAList),
      userId,
      violations,
    );
    next.iaSAUserCurrent = reconcileIaSaUserCurrent(
      (cur.iaSAUserCurrent as Record<string, string>) || {},
      (inc.iaSAUserCurrent as Record<string, string>) || {},
      userId,
      violations,
    );
  }

  /* Note any attempt to change a locked section (informational — the change is already
     discarded). Compared against what this viewer was actually SERVED, not against raw storage:
     the GET payload withholds several things from a locked section, so storage is the wrong
     baseline in three separate ways —
       processReviews  SOP PDFs replaced by a sopPdfStored flag (every non-head)
       exco            brief tokens withheld (every non-head)
       departments     head name/email stripped (scoped viewers)
     Comparing to storage flagged `section:exco` and `section:processReviews` on EVERY audit-staff
     save. It must be slimForClient(), the same function GET calls, not scopeWorkspace() — which
     is only the first of its four trims and returns the document untouched for full-scope roles.
     Keys the client never received are absent from `inc`, so omission is never read as a change. */
  const shown = slimForClient(current, viewer) as Obj;
  for (const key of Object.keys(inc)) {
    if (NON_HEAD_WRITABLE_SECTIONS.has(key)) continue;
    if (!jsonEq(inc[key], shown[key])) violations.push(`section:${key}`);
  }

  return { data: next as WorkspaceDb, violations, notices };
}

function reconcileAudits(
  curAudits: Obj[],
  incAudits: Obj[],
  role: string,
  userId: string,
  viewer: Viewer,
  violations: string[],
  notices: string[],
): Obj[] {
  const incById = new Map(incAudits.map((a) => [a.id as string, a]));
  const curIds = new Set(curAudits.map((a) => a.id as string));
  /* CREATING and DELETING an audit stays head-only — the client only offers "+ New audit" to the
     Head. Editing an EXISTING one is audit staff's job and is taken wholesale, the same trust they
     already hold over report metadata below and over the external / fraud registers:

       plan   scope, objectives, key risks and the whole test programme, including each test's
              fieldwork result, tester, test date, what-was-found note and working-paper reference
       tor    terms of reference
       name / type / area / period / status   the "✎ Edit Audit" dialog
       leadAuditor / leadAuditorId            ditto — staff may reassign an engagement

     All of it used to be locked to storage while the audit detail page offered every one of those
     controls to staff ungated, so their edits were silently discarded: the PUT returned 200, the
     client kept its optimistic copy and toasted success, and the change was gone on the next load. */
  const out = curAudits.map((curA) => {
    const incA = incById.get(curA.id as string);
    if (!incA) {
      /* A scoped viewer only receives audits that still hold an observation they can see, so an
         absent audit is usually "never sent" rather than "deleted". Only flag it when the viewer
         could see something inside it. Either way the stored audit survives untouched. */
      if (auditIsVisible(curA, viewer)) violations.push(`audit_delete_blocked:${curA.id}`);
      return { ...curA };
    }
    /* Staff are full-scope, so nothing at audit level was withheld from them on GET and taking
       `incA` wholesale cannot blank a field they never received. `id` is pinned because it keyed
       this match. A scoped viewer never reaches here as STAFF_ROLE, so their audit stays locked. */
    const outA: Obj = role === STAFF_ROLE ? { ...incA, id: curA.id } : { ...curA };
    if (role === STAFF_ROLE) noteGovernanceChanges(curA, incA, notices);
    outA.reports = reconcileReports(
      asArray(curA.reports),
      asArray(incA.reports),
      role,
      userId,
      viewer,
      violations,
    );
    return outA;
  });
  // Non-head users cannot create audits.
  for (const incA of incAudits) {
    if (!curIds.has(incA.id as string)) violations.push(`audit_create_blocked:${incA.id}`);
  }
  return out;
}

/** Record a non-head change to an audit's governance metadata. The change is ALLOWED — this only
 *  flags it for the security trail; the edit itself is recorded like any other (audit.updated).
 *  Reassigning the lead auditor is called out separately because it moves accountability for the
 *  engagement, and who is told about its findings, to someone else. */
function noteGovernanceChanges(curA: Obj, incA: Obj, notices: string[]): void {
  const shown = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));
  for (const f of AUDIT_GOVERNANCE_FIELDS) {
    if (jsonEq(incA[f], curA[f])) continue;
    if (f === "leadAuditorId") {
      notices.push(`audit_lead_reassigned:${curA.id}:${shown(curA[f])}->${shown(incA[f])}`);
    } else {
      notices.push(`audit_meta:${curA.id}:${f}:${shown(curA[f])}->${shown(incA[f])}`);
    }
  }
}

/** True when any observation inside this audit is visible to the viewer — i.e. the audit was part
 *  of the document they were served, so its absence from their save is a deletion attempt. */
function auditIsVisible(curA: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  return asArray(curA.reports).some((r) => reportIsVisible(r, viewer));
}

function reportIsVisible(curR: Obj, viewer: Viewer): boolean {
  if (isFullScope(viewer)) return true;
  return asArray(curR.observations).some((o) => canSeeObs(o, viewer));
}

function reconcileReports(
  curReps: Obj[],
  incReps: Obj[],
  role: string,
  userId: string,
  viewer: Viewer,
  violations: string[],
): Obj[] {
  const incById = new Map(incReps.map((r) => [r.id as string, r]));
  const curIds = new Set(curReps.map((r) => r.id as string));
  // Audit staff may edit report metadata and add new reports; observations are reconciled so they
  // can't be edited/deleted directly, and a report cannot be dropped (that would nuke its observations).
  const out = curReps.map((curR) => {
    const incR = incById.get(curR.id as string);
    if (!incR) {
      if (reportIsVisible(curR, viewer)) violations.push(`report_delete_blocked:${curR.id}`);
      return curR;
    }
    /* Report metadata is editable by non-head STAFF only. A scoped viewer receives the report
       stripped of execSummary, so taking `incR` wholesale for them would blank it. */
    const outR = role === STAFF_ROLE ? { ...incR } : { ...curR };
    outR.observations = reconcileObservations(
      asArray(curR.observations),
      asArray(incR.observations),
      role,
      userId,
      viewer,
      violations,
    );
    return outR;
  });
  for (const incR of incReps) {
    if (curIds.has(incR.id as string)) continue;
    if (role !== STAFF_ROLE) {
      violations.push(`report_create_blocked:${incR.id}`);
      continue;
    }
    const outR = { ...incR };
    outR.observations = reconcileObservations(
      [],
      asArray(incR.observations),
      role,
      userId,
      viewer,
      violations,
    );
    out.push(outR);
  }
  return out;
}

function reconcileObservations(
  curObs: Obj[],
  incObs: Obj[],
  role: string,
  userId: string,
  viewer: Viewer,
  violations: string[],
): Obj[] {
  const incById = new Map(incObs.map((o) => [o.id as string, o]));
  const curIds = new Set(curObs.map((o) => o.id as string));
  // Existing observations: cannot be deleted; controlled fields are locked.
  const out: Obj[] = curObs.map((curO) => {
    const visible = canSeeObs(curO, viewer);
    const incO = incById.get(curO.id as string);
    if (!incO) {
      // Missing: a deletion attempt only if they had it in the first place.
      if (visible) violations.push(`obs_delete_blocked:${curO.id}`);
      return curO;
    }
    if (!visible) {
      // Present but never served — the client is echoing back a record it was not given.
      violations.push(`out_of_scope_write:obs:${curO.id}`);
      return curO;
    }
    return reconcileOneObs(curO, incO, role, userId, violations);
  });
  // New observations: audit staff may add them (forced to pending); action owners cannot.
  for (const incO of incObs) {
    if (curIds.has(incO.id as string)) continue;
    if (role === STAFF_ROLE) out.push(sanitizeNewObs(incO, userId));
    else violations.push(`obs_create_blocked:${incO.id}`);
  }
  return out;
}

/* WHO MAY SIGN OFF REMEDIATION: any audit staff member, on any observation — and the Head, who never
   reaches here (authorizeWorkspaceWrite() returns early as fully trusted). That covers both halves
   of the verify dialog: VERIFY (confirm the remediation and propose the closure date) and SEND BACK
   (unwind the owner's response, with a note saying what still needs doing — applyDerivedStageTransition).
   Action owners are kept out by AUDITOR_ONLY_OBS_FIELDS. The UI applies the same rule through
   canVerifyItem() in lib/workspace/observations.ts.

   It was narrower for a while: from 2026-08-13 only the audit's lead auditor or the auditor who
   raised the item could sign off. It was widened to all of Internal Audit on purpose on 2026-09-02
   (confirmed 2026-09-29). The control that remains is the Head's: only the Head can set
   headVerifiedAt or close an observation. Narrowing it again means changing canVerifyItem() in the
   same change — a server that refuses what the UI offers reverts saves silently. */

/** An audit staff member is verifying this item in THIS save. One definition, used by both the
 *  controlled-field pass (which excuses the closure date it legitimately carries) and the derived
 *  transition (which applies it) — they must not drift. */
function justVerified(cur: Obj, inc: Obj, role: string): boolean {
  return role === STAFF_ROLE && !cur.reportVerifiedAt && !!inc.reportVerifiedAt;
}

function reconcileOneObs(
  cur: Obj,
  inc: Obj,
  role: string,
  userId: string,
  violations: string[],
): Obj {
  const next: Obj = { ...inc };
  /* Verification proposes the closure date, so a legitimate sign-off always arrives carrying
     `closedDateISO` — a controlled field. Flagging it logged a spurious obs_field violation into
     security.workspace_write_filtered on every genuine verification. The value is still forced
     back here and re-applied by the derived transition below; only the false alarm is dropped. */
  const verifying = justVerified(cur, inc, role);
  // Judged on the STORED approval, so one save cannot reject-then-rewrite its way past the lock.
  const reworking = role === STAFF_ROLE && cur.obsApproval === "rejected" && !cur.rejectionFinal;
  for (const f of CONTROLLED_OBS_FIELDS) {
    const excused = verifying && f === "closedDateISO";
    const staffReassign = role === STAFF_ROLE && STAFF_REASSIGN_FIELDS.has(f);
    const staffRework = reworking && STAFF_REWORK_FIELDS.has(f);
    if (staffReassign || staffRework) {
      forceField(next, f, inc[f]);
      continue;
    }
    if (reworking && f === "obsApproval" && inc[f] === "pending") {
      forceField(next, f, "pending"); // resubmitted for the Head's approval
      continue;
    }
    if (!excused && !jsonEq(inc[f], cur[f])) violations.push(`obs_field:${cur.id}:${f}`);
    forceField(next, f, cur[f]);
  }
  if (role !== STAFF_ROLE) {
    for (const f of AUDITOR_ONLY_OBS_FIELDS) {
      if (!jsonEq(inc[f], cur[f])) violations.push(`obs_field:${cur.id}:${f}`);
      forceField(next, f, cur[f]);
    }
  }
  applyDerivedStageTransition(cur, inc, next, role, userId);
  next.withdrawal = reconcileWithdrawal(
    cur.withdrawal as Obj | undefined,
    inc.withdrawal as Obj | undefined,
    String(cur.id),
    violations,
  );
  return next;
}

/* The remediation workflow advances through fields a non-head user is NOT allowed to write
   (`status`, `closedDateISO`, `closureRejection`, `progressReport`). Legacy set them straight
   from the client; here they are derived on the SERVER from the one field the actor *is*
   permitted to set, so the legitimate stage advance still happens while an arbitrary
   "status: Closed" write stays blocked. Head of Audit never reaches this — it returns early
   as fully trusted.

   Ordering note: this runs AFTER the controlled fields have been forced back to stored values,
   so it is writing on top of a known-good baseline, not on top of whatever the client sent. */
function applyDerivedStageTransition(
  cur: Obj,
  inc: Obj,
  next: Obj,
  role: string,
  userId: string,
): void {
  const rejection = cur.closureRejection as { target?: string } | null | undefined;

  // 1. An action owner (primary OR secondary) submits their closure response. The only field
  //    they can set is ownerRectifiedAt; everything else about the transition follows from it.
  const ownerJustResponded = !cur.ownerRectifiedAt && !!inc.ownerRectifiedAt;
  if (ownerJustResponded) {
    if (cur.status === "Open") next.status = "In Progress";
    next.progressReport = null; // the outstanding request is satisfied by this response
    if (rejection && rejection.target === "owner") next.closureRejection = null;
  }

  // 2. An auditor verifies the remediation and sends it to the Head for sign-off. Verification
  //    proposes the closure date; the Head confirms it. Status stays un-Closed either way —
  //    only the Head can set that, and only via the trusted path above.
  const auditorJustVerified = justVerified(cur, inc, role);
  if (auditorJustVerified) {
    if (inc.closedDateISO) next.closedDateISO = inc.closedDateISO;
    if (rejection && rejection.target === "auditor") next.closureRejection = null;
  }

  // 3. An auditor returns the owner's closure response for more work. The Head could already
  //    do this ("escalate to owner"); the auditor who actually reviews the response could not,
  //    so a weak response could only be pushed UP to the Head. Unwinding ownerRectifiedAt is
  //    already within an auditor's rights — but closureRejection is a controlled field, so
  //    without this the note explaining WHY reverted and the owner was sent back with no
  //    feedback. Restricted to target "owner": an auditor still cannot fabricate a Head
  //    "reject to auditor", and this can never close or withdraw anything.
  const auditorReturnedToOwner =
    role === STAFF_ROLE && !!cur.ownerRectifiedAt && !inc.ownerRectifiedAt;
  if (auditorReturnedToOwner) {
    const incRej = inc.closureRejection as { target?: string } | null | undefined;
    if (incRej && incRej.target === "owner") next.closureRejection = incRej;
  }

  // 4. An owner's comment to Internal Audit satisfies an outstanding "update requested" flag
  //    (legacy addObsUpdate cleared it client-side; owners can't write updateRequestedAt here,
  //    so derive the clear from the one thing they can do — append a non-private update they
  //    authored themselves). Private co-owner notes don't count as a response.
  if (cur.updateRequestedAt && role !== STAFF_ROLE) {
    const curIds = new Set(
      asArray(cur.updates).map((u) => u.id as string).filter(Boolean),
    );
    const responded = asArray(inc.updates).some(
      (u) => !curIds.has(u.id as string) && u.by === userId && u.audience !== "owner",
    );
    if (responded) {
      next.updateRequestedAt = "";
      next.updateRequestedBy = "";
    }
  }
}

/* The fraud register itself (schemes, ratings, controls, owners, the actions' definitions) is
   IA-managed. What an action owner legitimately sends back is the implementation progress on
   the actions assigned to them — status, the update text, and the ownerUpdates trail. This was
   silently reverted before fraudRisks was reconciled at all, so owner updates never persisted
   even though the "Internal Audit has been notified" bell did. */
function reconcileFraudRisks(
  curRisks: Obj[],
  incRisks: Obj[],
  role: string,
  userId: string,
  viewer: Viewer,
  violations: string[],
): Obj[] {
  // Audit staff maintain the register alongside the Head (same trust as reports/extFindings).
  if (role === STAFF_ROLE) return incRisks;

  const incById = new Map(incRisks.map((f) => [f.id as string, f]));
  const curIds = new Set(curRisks.map((f) => f.id as string));
  const out = curRisks.map((curF) => {
    const visible = canSeeFraudRisk(curF, viewer);
    const incF = incById.get(curF.id as string);
    if (!incF) {
      if (visible) violations.push(`fraud_delete_blocked:${curF.id}`);
      return curF;
    }
    if (!visible) {
      violations.push(`out_of_scope_write:fraud:${curF.id}`);
      return curF;
    }
    const ownsRisk = !!userId && curF.ownerUserId === userId;
    const incActById = new Map(asArray(incF.actions).map((a) => [a.id as string, a]));
    const actions = asArray(curF.actions).map((curA) => {
      const incA = incActById.get(curA.id as string);
      if (!incA) return curA; // owners cannot drop an action
      if (!canSeeFraudAction(curF, curA, viewer)) return curA; // never served — fully locked
      if (!ownsRisk && curA.ownerUserId !== userId) return curA; // not theirs — fully locked
      const outA = { ...curA };
      for (const f of OWNER_FRAUD_ACTION_FIELDS) forceField(outA, f, incA[f]);
      /* "Validated" is Internal Audit's sign-off on the owner's "Implemented": the owner can
         neither award it to their own action nor move one IA has validated. The validation
         note and stamps are not owner fields, so they already stay as stored. */
      if (
        (curA.status === FRAUD_VALIDATED || incA.status === FRAUD_VALIDATED) &&
        !jsonEq(incA.status, curA.status)
      ) {
        violations.push(`fraud_validate_blocked:${curF.id}:${curA.id}`);
        forceField(outA, "status", curA.status);
      }
      return outA;
    });
    // Risk metadata stays stored; the overall status is re-derived from the reconciled
    // actions server-side (rollupFraud), never taken from the client.
    const outF: Obj = { ...curF, actions };
    if (actions.length) {
      outF.status = actions.every((a) => fraudActionDone(a.status))
        ? "Mitigated"
        : actions.some((a) => fraudActionDone(a.status) || a.status === "In Progress")
          ? "Mitigating"
          : "Identified";
    }
    return outF;
  });
  for (const incF of incRisks) {
    if (!curIds.has(incF.id as string)) violations.push(`fraud_create_blocked:${incF.id}`);
  }
  return out;
}

/* External / regulatory findings used to be taken WHOLESALE from the client:
     next.extFindings = inc.extFindings ?? cur.extFindings ?? [];
   so any authenticated non-head user could rewrite or delete every finding the regulator raised
   — the same class of defect the fraud register had before it was reconciled. Reconciled here on
   the same shape: audit staff maintain the register; an action owner may write only the
   remediation surface of the findings assigned to them, and the status transition is derived
   server-side from ownerRectifiedAt rather than taken from the client. */
function reconcileExtFindings(
  curExts: Obj[],
  incExts: Obj[],
  role: string,
  userId: string,
  viewer: Viewer,
  violations: string[],
): Obj[] {
  // Audit staff maintain the external register alongside the Head.
  if (role === STAFF_ROLE) return incExts;

  const incById = new Map(incExts.map((f) => [f.id as string, f]));
  const curIds = new Set(curExts.map((f) => f.id as string));

  const out = curExts.map((curF) => {
    const visible = canSeeExt(curF, viewer);
    const incF = incById.get(curF.id as string);
    if (!incF) {
      if (visible) violations.push(`ext_delete_blocked:${curF.id}`);
      return curF;
    }
    if (!visible) {
      violations.push(`out_of_scope_write:ext:${curF.id}`);
      return curF;
    }
    // Assigned to them: everything is stored-value except the remediation surface.
    const outF: Obj = { ...curF };
    for (const f of OWNER_EXT_FIELDS) forceField(outF, f, incF[f]);
    for (const f of Object.keys(incF)) {
      if (OWNER_EXT_FIELDS.includes(f)) continue;
      if (!jsonEq(incF[f], curF[f])) violations.push(`ext_field:${curF.id}:${f}`);
    }
    // Derived transition: submitting a closure response moves an Open finding to In Progress.
    // "Closed" stays unreachable from here — only Internal Audit verification closes a finding.
    if (!curF.ownerRectifiedAt && !!incF.ownerRectifiedAt && (curF.status || "Open") === "Open") {
      outF.status = "In Progress";
    }
    return outF;
  });

  // Owners cannot raise external findings — those come from a regulator or external auditor.
  for (const incF of incExts) {
    if (!curIds.has(incF.id as string)) violations.push(`ext_create_blocked:${incF.id}`);
  }
  return out;
}

/* Notifications were also taken wholesale, and graftServerHeld() let an incoming row overwrite an
   EXISTING notification belonging to someone else on id collision — its text, its link, its read
   state. Owners do legitimately create notifications for other people (assigning an owner,
   requesting an approval — see pushNotification in lib/workspace/portal.ts), so the rule is
   create-but-never-modify:
     - a new id addressed to anyone   → accepted, but stamped with the real author and time
     - an existing id owned by SOMEONE ELSE → immutable, stored row wins
     - an existing id owned by the CALLER   → only `read` may change (mark-as-read)
   Rows stored for other users are re-seeded by graftServerHeld(), which is what stops a scoped
   client's save from dropping them by omission. */
function reconcileNotifications(
  curNotifs: Obj[],
  incNotifs: Obj[],
  userId: string,
  violations: string[],
): Obj[] {
  const curById = new Map(curNotifs.map((n) => [String(n.id), n]));
  const out: Obj[] = [];
  const seen = new Set<string>();
  let created = 0;

  for (const inc of incNotifs) {
    if (!inc || !inc.id) continue;
    const id = String(inc.id);
    if (seen.has(id)) continue;
    seen.add(id);

    const cur = curById.get(id);
    if (!cur) {
      if (created >= MAX_NEW_NOTIFICATIONS) {
        violations.push(`notif_flood_blocked:${id}`);
        continue;
      }
      created++;
      // Stamp authorship and time server-side so a forged notification is always attributable.
      out.push({ ...inc, byUserId: userId, at: new Date().toISOString() });
      continue;
    }
    if (String(cur.userId || "") !== userId) {
      // Someone else's notification — immutable.
      if (!jsonEq(inc, cur)) violations.push(`notif_foreign_write_blocked:${id}`);
      out.push(cur);
      continue;
    }
    // Their own: only the read flag moves.
    const outN: Obj = { ...cur, read: !!inc.read };
    for (const f of Object.keys(inc)) {
      if (f === "read") continue;
      if (!jsonEq(inc[f], cur[f])) violations.push(`notif_field:${id}:${f}`);
    }
    out.push(outN);
  }

  // Stored rows the client did not send back survive untouched (a scoped client only ever holds
  // its own). graftServerHeld() re-seeds other users' rows on top of this.
  for (const cur of curNotifs) {
    if (cur && cur.id && !seen.has(String(cur.id))) out.push(cur);
  }
  return out;
}

function reconcileWithdrawal(
  cur: Obj | undefined,
  inc: Obj | undefined,
  obsId: string,
  violations: string[],
): Obj | undefined {
  if (!inc) return cur; // dropping the record isn't a privilege escalation; keep stored
  const next: Obj = { ...inc };
  // Only the Head of Audit may finalise a withdrawal (approve→"withdrawn" / reject→"rejected").
  if (WITHDRAWAL_FINAL_STAGES.includes(String(inc.stage)) && (!cur || cur.stage !== inc.stage)) {
    violations.push(`withdraw_finalize_blocked:${obsId}`);
    return cur;
  }
  for (const f of WITHDRAWAL_HEAD_FIELDS) forceField(next, f, cur ? cur[f] : undefined);
  return next;
}

function sanitizeNewObs(inc: Obj, userId: string): Obj {
  const next: Obj = {
    ...inc,
    obsApproval: "pending", // staff-raised observations always require Head approval
    withdrawn: false,
    status: "Open", // a newly raised observation starts Open — it cannot arrive pre-closed
    raisedBy: userId, // cannot impersonate another raiser
  };
  // A newly raised observation cannot arrive pre-verified or pre-closed.
  for (const f of ["headVerifiedAt", "headVerifiedByName", "headComment", "reportVerifiedAt", "closedDateISO", "withdrawnAt", "withdrawal"]) {
    delete next[f];
  }
  return next;
}

function reconcileApprovals(
  curApps: Obj[],
  incApps: Obj[],
  current: WorkspaceDb,
  viewer: Viewer,
  violations: string[],
): Obj[] {
  /* Which approvals this viewer was served — the queue itself is head-only, but an owner does
     receive the requests that concern their own observations. Mirrors the approvals filter in
     scopeWorkspace(). */
  const obsIds = isFullScope(viewer) ? null : visibleObsIds(current, viewer);
  const sawApproval = (ap: Obj) =>
    obsIds === null ||
    (!!viewer.id && ap.requestedBy === viewer.id) ||
    (!!ap.obsId && obsIds.has(String(ap.obsId)));

  const curById = new Map(curApps.map((a) => [a.id as string, a]));
  const seen = new Set<string>();
  const out: Obj[] = [];
  for (const inc of incApps) {
    const id = inc.id as string;
    seen.add(id);
    const cur = curById.get(id);
    if (cur && !sawApproval(cur)) {
      violations.push(`out_of_scope_write:approval:${id}`);
      out.push(cur);
      continue;
    }
    if (!cur) {
      // A new approval request must be pending and undecided.
      if (inc.status && inc.status !== "pending") violations.push(`approval_new_prestatus:${id}`);
      const clean: Obj = { ...inc, status: "pending" };
      delete clean.decidedBy;
      delete clean.decidedByName;
      delete clean.decidedAt;
      delete clean.headReason;
      out.push(clean);
    } else if (cur.status === "pending") {
      // A non-head user may withdraw (supersede) their own pending request but never decide it.
      if (inc.status === "superseded") {
        out.push({ ...cur, status: "superseded", decidedAt: inc.decidedAt ?? cur.decidedAt });
      } else {
        if (inc.status && inc.status !== "pending") violations.push(`approval_decide_blocked:${id}`);
        out.push(cur);
      }
    } else {
      out.push(cur); // already decided → immutable for non-head
    }
  }
  for (const cur of curApps) {
    if (seen.has(cur.id as string)) continue;
    // Absent because it was never served is not a deletion attempt; the row survives either way.
    if (sawApproval(cur)) violations.push(`approval_delete_blocked:${cur.id}`);
    out.push(cur);
  }
  return out;
}

/* Who started a self-assessment. Legacy per-person records carry it as `userId`. Mirrors
   iaSaCreatorId() in lib/workspace/iasa.ts. */
const IA_SA_CREATOR_FIELDS = ["createdBy", "createdByName", "userId"];
function iaSaCreatorId(rec: Obj): string {
  return String(rec.createdBy || rec.userId || "");
}
// Same reading as normOneIASA(): an old record may have completedAt but no status.
function isCompletedIaSa(rec: Obj): boolean {
  return rec.status === "completed" || (!rec.status && !!rec.completedAt);
}

/** The self-assessment is the Internal Audit function's, not a person's: audit staff work on every
 *  record alongside the Head — rate standards, record evidence, generate, mark complete, and keep
 *  the QAIP tracker current (which happens AFTER completion, so completed records stay editable).
 *  What stays controlled, matching canDeleteIaSa()/canReopenIaSa() in lib/workspace/iasa.ts:
 *    - a completed assessment is never deleted, and only the Head reopens one — otherwise
 *      reopen-then-delete would get round the first rule;
 *    - an in-progress one may be deleted only by the person who started it (or the Head);
 *    - who started it is not rewritable, since it carries that delete right. */
function reconcileIaSaList(
  curList: Obj[],
  incList: Obj[],
  userId: string,
  violations: string[],
): Obj[] {
  const incById = new Map(incList.map((s) => [s.id as string, s]));
  const seen = new Set<string>();
  const out: Obj[] = [];

  for (const cur of curList) {
    const id = cur.id as string;
    seen.add(id);
    const inc = incById.get(id);

    if (!inc) {
      if (!isCompletedIaSa(cur) && iaSaCreatorId(cur) === userId) continue; // own draft
      violations.push(`iaSa_delete_blocked:${id}`);
      out.push(cur);
      continue;
    }

    const next: Obj = { ...inc };
    if (IA_SA_CREATOR_FIELDS.some((f) => !jsonEq(next[f], cur[f]))) {
      violations.push(`iaSa_creator_change:${id}`);
      for (const f of IA_SA_CREATOR_FIELDS) forceField(next, f, cur[f]);
    }
    if (isCompletedIaSa(cur) && next.status !== "completed") {
      violations.push(`iaSa_reopen_blocked:${id}`);
      next.status = "completed";
      forceField(next, "completedAt", cur.completedAt);
    }
    out.push(next);
  }

  for (const inc of incList) {
    const id = inc.id as string;
    if (seen.has(id)) continue;
    // A new record must name its creator, and only as the caller — both the current field and the
    // legacy one, so neither can plant a record deletable by (or attributed to) somebody else.
    const claimed = [inc.createdBy, inc.userId].filter(Boolean).map(String);
    if (!claimed.length || claimed.some((c) => c !== userId)) {
      violations.push(`iaSa_create_other_blocked:${id}`);
      continue;
    }
    out.push(inc);
  }

  return out;
}

function reconcileIaSaUserCurrent(
  cur: Record<string, string>,
  inc: Record<string, string>,
  userId: string,
  violations: string[],
): Record<string, string> {
  const out = { ...cur };
  for (const [k, v] of Object.entries(inc)) {
    if (k === userId) out[k] = v;
    else if (v !== cur[k]) violations.push(`iaSa_userCurrent_other:${k}`);
  }
  return out;
}
