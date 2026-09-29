// Approvals domain — pure helpers ported 1:1 from public/audit-bot.js (approvalKindLabel/
// approvalItemTitle/OBS_FIELD_LABELS/applyStatusChange and the viewApprovals sort). Everything
// takes the workspace db explicitly. Shared observation-side helpers (stampClosed, notify*,
// supersede/cancel bookkeeping) live in ./observations; the queue selectors live in ./selectors.

import { approvals, findAudit, findReport } from "./selectors";
import { stampClosed } from "./observations";
import type { Approval, Observation, Report, WorkspaceDb } from "./types";

/** Human label for an approval kind (legacy approvalKindLabel). */
export function approvalKindLabel(k: string | undefined): string {
  return k === "observation_raise"
    ? "New observation"
    : k === "engagement_completion"
      ? "Plan completion"
      : k === "observation_status_change"
        ? "Status change"
        : k === "observation_update" || k === "observation_update_request"
          ? "Edit request"
          : k === "observation_delete"
            ? "Delete request"
            : k === "observation_withdraw"
              ? "Withdrawal request"
              : k || "—";
}

/** Title shown for an approval row / dialog (legacy approvalItemTitle). */
export function approvalItemTitle(db: WorkspaceDb, a: Approval): string {
  if (a.kind === "engagement_completion") {
    const e = (db.auditUniverse || []).find((x) => x.id === a.unitId);
    return e ? e.name : a.unitName || "(removed unit)";
  }
  // The live title, not the snapshot taken at request time: the Head can edit an observation
  // while reviewing it, and the queue should show what is about to be approved. The snapshot
  // still names an observation that has since been deleted.
  const live = a.obsId ? findApprovalObs(db, a).o : undefined;
  return live?.title || a.obsTitle || a.unitName || "(item)";
}

/** The observation behind a pending "New observation" request — what the Head may edit before
 *  deciding it (the Edit action on the Approvals page). */
export function raiseUnderReview(db: WorkspaceDb, a: Approval): Observation | undefined {
  if (a.kind !== "observation_raise" || a.status !== "pending") return undefined;
  return findApprovalObs(db, a).o;
}

/** The open "New observation" request for an observation — what the observation page's review
 *  banner decides, through the same approveAny/rejectAny as the Approvals page. */
export function pendingRaise(db: WorkspaceDb, obsId: string): Approval | undefined {
  return approvals(db).find((a) => a.kind === "observation_raise" && a.obsId === obsId && a.status === "pending");
}

/** A pending edit to an observation whose raise was rejected. Approving it approves the
 *  observation as well — see the observation_update case in components/approvals/decisions.tsx. */
export function editApprovesRejectedObs(db: WorkspaceDb, a: Approval): boolean {
  if (a.kind !== "observation_update" || a.status !== "pending") return false;
  return findApprovalObs(db, a).o?.obsApproval === "rejected";
}

/** Observation fields rendered in the approval details dialog (legacy OBS_FIELD_LABELS). */
export const OBS_FIELD_LABELS: readonly (readonly [string, string])[] = [
  ["ref", "Ref"],
  ["title", "Title"],
  ["criticality", "Criticality"],
  ["status", "Status"],
  ["category", "Category / control theme"],
  ["description", "Detailed description"],
  ["criteria", "Criteria / expectation"],
  ["risk", "Impact / risk"],
  ["rootCause", "Possible root cause"],
  ["recommendation", "Recommendation"],
  ["sopUpdate", "Proposed SOP update"],
  ["managementResponse", "Management response"],
  ["owner", "Action owner"],
  ["timeline", "Resolution timeline"],
  ["dueDate", "Closure action"],
];

/** All approval requests, newest first (legacy viewApprovals sort). */
export function sortedApprovals(db: WorkspaceDb): Approval[] {
  return approvals(db)
    .slice()
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
}

/** The report + observation an approval points at (legacy report(audit(...)) lookup). */
export function findApprovalObs(
  db: WorkspaceDb,
  ap: Approval,
): { r: Report | undefined; o: Observation | undefined } {
  const r = findReport(findAudit(db, ap.auditId), ap.reportId);
  const o = r ? (r.observations || []).find((x) => x.id === ap.obsId) : undefined;
  return { r, o };
}

/** Mutating (run inside mutate): apply a status change with the closure stamp (legacy applyStatusChange). */
export function applyStatusChange(o: Observation, v: string): void {
  stampClosed(o, v);
  o.status = v;
}
