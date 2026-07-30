import type { WorkspaceDb } from "./db-data";

// Server-side authorization for writes to the shared workspace document (/api/data PUT).
//
// The whole workspace is one JSON blob that the client overwrites on every save. Role restrictions
// in the UI (who may edit/delete/withdraw/close observations, decide approvals, edit assessments,
// etc.) are therefore NOT self-enforcing — a crafted client could PUT anything. This module
// re-imposes those rules on the server: for a non-head user it rebuilds the document from the stored
// copy and re-applies only the changes that role is permitted to make. A well-behaved client never
// sends anything disallowed, so `data` comes back identical; a malicious one is silently neutralised.

const HEAD_ROLE = "head_of_audit";
const STAFF_ROLE = "audit_staff";

// Top-level sections a non-head user may modify. Everything else (auditUniverse,
// processReviews, iaSA/iaSAList, planYear, org, signOff*, logo, branding, departments, exco*, …) is
// locked to the stored value — the default-deny that closes head-only content to non-head writes.
// fraudRisks is in the set because it is reconciled below: action owners may write ONLY the
// implementation-progress surface of their own actions, never the register itself.
const NON_HEAD_WRITABLE_SECTIONS = new Set([
  "audits",
  "extFindings",
  "approvals",
  "notifications",
  "fraudRisks",
]);

// The implementation-progress surface of a fraud prevention action — what an assigned action
// owner reports back on. Everything else about a risk/action is IA-managed.
const OWNER_FRAUD_ACTION_FIELDS = ["status", "update", "ownerUpdates"];

// Observation fields that change only through an approved workflow or a head action. A non-head
// write can never alter these directly; they are forced back to the stored value.
const CONTROLLED_OBS_FIELDS = [
  "ref", "title", "category", "description", "criteria", "risk", "rootCause", "recommendation",
  "sopUpdate", "criticality", "managementResponse", "timeline", "dueDate", "isRepeat", "repeatOf",
  "owner", "ownerUserId", "departmentId", "secondaryOwner", "secondaryOwnerUserId",
  "status", "closedDateISO", "withdrawn", "withdrawnAt", "obsApproval",
  "headVerifiedAt", "headVerifiedByName", "headComment", "closureRejection",
];
// Also locked for action owners: only auditors/head verify remediation or request updates.
const AUDITOR_ONLY_OBS_FIELDS = [
  "reportVerifiedAt", "reportVerifiedByName", "closureNote", "closureEvidence", "closureFile",
  "updateRequestedAt", "updateRequestedBy", "progressReport",
];
const WITHDRAWAL_HEAD_FIELDS = ["headBy", "headByName", "headAt", "headReason"];
const WITHDRAWAL_FINAL_STAGES = ["withdrawn", "rejected"];

type Obj = Record<string, unknown>;
export type AuthzResult = { data: WorkspaceDb; violations: string[] };

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
): AuthzResult {
  // Effective role: an admin acts as their switched activeRole, defaulting to head until
  // they pick one (mirrors effectiveRole() in lib/permissions.ts).
  const effective = role === "admin" ? activeRole || HEAD_ROLE : role;

  // The Head of Audit is fully trusted with the workspace document.
  if (effective === HEAD_ROLE) return { data: incoming, violations: [] };

  const cur = (current || {}) as Obj;
  const inc = (incoming || {}) as Obj;
  const violations: string[] = [];

  // Start from the stored document — this locks every head-only section by default...
  const next = structuredClone(cur) as Obj;

  // ...then re-apply only the sections a non-head user is allowed to touch.
  next.notifications = inc.notifications ?? cur.notifications ?? [];
  next.extFindings = inc.extFindings ?? cur.extFindings ?? []; // remediation-writable (owners respond)
  next.audits = reconcileAudits(asArray(cur.audits), asArray(inc.audits), effective, userId, violations);
  next.approvals = reconcileApprovals(asArray(cur.approvals), asArray(inc.approvals), violations);
  next.fraudRisks = reconcileFraudRisks(
    asArray(cur.fraudRisks),
    asArray(inc.fraudRisks),
    effective,
    userId,
    violations,
  );

  // Note any attempt to change a locked section (informational — the change is already discarded).
  for (const key of Object.keys(inc)) {
    if (NON_HEAD_WRITABLE_SECTIONS.has(key)) continue;
    if (!jsonEq(inc[key], cur[key])) violations.push(`section:${key}`);
  }

  return { data: next as WorkspaceDb, violations };
}

function reconcileAudits(
  curAudits: Obj[],
  incAudits: Obj[],
  role: string,
  userId: string,
  violations: string[],
): Obj[] {
  const incById = new Map(incAudits.map((a) => [a.id as string, a]));
  const curIds = new Set(curAudits.map((a) => a.id as string));
  // Creating/editing/deleting an audit is head-only (the client gates it on isStaff). Audit-level
  // metadata is therefore taken from storage; only the reports within existing audits are reconciled.
  const out = curAudits.map((curA) => {
    const incA = incById.get(curA.id as string);
    if (!incA) {
      violations.push(`audit_delete_blocked:${curA.id}`);
      return curA;
    }
    const outA = { ...curA }; // lock audit metadata (name, area, leadAuditorId, status, …)
    outA.reports = reconcileReports(asArray(curA.reports), asArray(incA.reports), role, userId, violations);
    return outA;
  });
  // Non-head users cannot create audits.
  for (const incA of incAudits) {
    if (!curIds.has(incA.id as string)) violations.push(`audit_create_blocked:${incA.id}`);
  }
  return out;
}

function reconcileReports(
  curReps: Obj[],
  incReps: Obj[],
  role: string,
  userId: string,
  violations: string[],
): Obj[] {
  const incById = new Map(incReps.map((r) => [r.id as string, r]));
  const curIds = new Set(curReps.map((r) => r.id as string));
  // Audit staff may edit report metadata and add new reports; observations are reconciled so they
  // can't be edited/deleted directly, and a report cannot be dropped (that would nuke its observations).
  const out = curReps.map((curR) => {
    const incR = incById.get(curR.id as string);
    if (!incR) {
      violations.push(`report_delete_blocked:${curR.id}`);
      return curR;
    }
    const outR = { ...incR }; // report metadata is editable by non-head
    outR.observations = reconcileObservations(
      asArray(curR.observations),
      asArray(incR.observations),
      role,
      userId,
      violations,
    );
    return outR;
  });
  for (const incR of incReps) {
    if (curIds.has(incR.id as string)) continue;
    const outR = { ...incR };
    outR.observations = reconcileObservations([], asArray(incR.observations), role, userId, violations);
    out.push(outR);
  }
  return out;
}

function reconcileObservations(
  curObs: Obj[],
  incObs: Obj[],
  role: string,
  userId: string,
  violations: string[],
): Obj[] {
  const incById = new Map(incObs.map((o) => [o.id as string, o]));
  const curIds = new Set(curObs.map((o) => o.id as string));
  // Existing observations: cannot be deleted; controlled fields are locked.
  const out: Obj[] = curObs.map((curO) => {
    const incO = incById.get(curO.id as string);
    if (!incO) {
      violations.push(`obs_delete_blocked:${curO.id}`);
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

function reconcileOneObs(cur: Obj, inc: Obj, role: string, userId: string, violations: string[]): Obj {
  const next: Obj = { ...inc };
  for (const f of CONTROLLED_OBS_FIELDS) {
    if (!jsonEq(inc[f], cur[f])) violations.push(`obs_field:${cur.id}:${f}`);
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
function applyDerivedStageTransition(cur: Obj, inc: Obj, next: Obj, role: string, userId: string): void {
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
  const auditorJustVerified = role === STAFF_ROLE && !cur.reportVerifiedAt && !!inc.reportVerifiedAt;
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
  const auditorReturnedToOwner = role === STAFF_ROLE && !!cur.ownerRectifiedAt && !inc.ownerRectifiedAt;
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
  violations: string[],
): Obj[] {
  // Audit staff maintain the register alongside the Head (same trust as reports/extFindings).
  if (role === STAFF_ROLE) return incRisks;

  const incById = new Map(incRisks.map((f) => [f.id as string, f]));
  const curIds = new Set(curRisks.map((f) => f.id as string));
  const out = curRisks.map((curF) => {
    const incF = incById.get(curF.id as string);
    if (!incF) {
      violations.push(`fraud_delete_blocked:${curF.id}`);
      return curF;
    }
    const ownsRisk = curF.ownerUserId === userId;
    const incActById = new Map(asArray(incF.actions).map((a) => [a.id as string, a]));
    const actions = asArray(curF.actions).map((curA) => {
      const incA = incActById.get(curA.id as string);
      if (!incA) return curA; // owners cannot drop an action
      if (!ownsRisk && curA.ownerUserId !== userId) return curA; // not theirs — fully locked
      const outA = { ...curA };
      for (const f of OWNER_FRAUD_ACTION_FIELDS) forceField(outA, f, incA[f]);
      return outA;
    });
    // Risk metadata stays stored; the overall status is re-derived from the reconciled
    // actions server-side (rollupFraud), never taken from the client.
    const outF: Obj = { ...curF, actions };
    if (actions.length) {
      outF.status = actions.every((a) => a.status === "Implemented")
        ? "Mitigated"
        : actions.some((a) => a.status === "Implemented" || a.status === "In Progress")
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

function reconcileApprovals(curApps: Obj[], incApps: Obj[], violations: string[]): Obj[] {
  const curById = new Map(curApps.map((a) => [a.id as string, a]));
  const seen = new Set<string>();
  const out: Obj[] = [];
  for (const inc of incApps) {
    const id = inc.id as string;
    seen.add(id);
    const cur = curById.get(id);
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
    if (!seen.has(cur.id as string)) {
      violations.push(`approval_delete_blocked:${cur.id}`);
      out.push(cur);
    }
  }
  return out;
}
