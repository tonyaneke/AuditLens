"use client";

// Approval decision actions — React port of approveAny/rejectAny and the per-kind legacy
// decision functions in audit-bot.js (approveObservation/rejectObservation, approveStatusChange/
// rejectStatusChange, approveUpdate/rejectUpdate, approveDelete/rejectDelete, approveCompletion/
// rejectCompletion, modalDecideWithdraw/finalizeWithdraw) including their notification, email
// and audit-log side effects. Decisions are Head-of-Audit-only — mirrored server-side by the
// reconciler (lib/workspace-authz.ts).

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { logAudit } from "@/lib/client/audit-log";
import { loadDirectory } from "@/lib/client/directory";
import { applyStatusChange, findApprovalObs } from "@/lib/workspace/approvals";
import {
  cancelPendingStatusChange,
  notify,
  notifyBoth,
  notifyOwnerAssigned,
  stampClosed,
  supersedePendingUpdate,
} from "@/lib/workspace/observations";
import { parseQuarters } from "@/lib/workspace/ra";
import { approvals } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type LogEntry = { action: string; summary: string; metadata?: Record<string, unknown> };

export function useApprovalDecisions() {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const isHead = user.role === "head_of_audit";

  /** Per-kind decision for every kind except observation_withdraw (which needs a reason dialog). */
  async function decide(aid: string, approve: boolean): Promise<void> {
    if (!isHead) {
      toast(`Only the Head of Audit can ${approve ? "approve" : "reject"}.`, "error");
      return;
    }
    // Warm the directory cache (emails resolve through it) BEFORE touching the workspace —
    // never read db across an await.
    await loadDirectory();
    const logs: LogEntry[] = [];
    mutate((d) => {
      const ap = approvals(d).find((x) => x.id === aid);
      if (!ap || ap.status !== "pending") return;
      ap.status = approve ? "approved" : "rejected";
      ap.decidedBy = user.id || "";
      ap.decidedByName = user.name || "";
      ap.decidedAt = new Date().toISOString();
      switch (ap.kind) {
        case "observation_raise": {
          const { o } = findApprovalObs(d, ap);
          if (approve) {
            if (o) {
              o.obsApproval = "approved";
              notifyOwnerAssigned(d, o);
              if (o.raisedBy)
                notifyBoth(
                  d,
                  o.raisedBy,
                  "obs_approved",
                  "Approved: " + o.title,
                  "audits",
                  "AuditLens — observation approved",
                  `Your observation "${o.title}" was approved by the Head of Audit and the action owner has been notified.`,
                  o.id,
                );
            }
            logs.push({
              action: "obs.approved",
              summary: "Approved observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          } else {
            if (o) {
              o.obsApproval = "rejected";
              if (o.raisedBy)
                notifyBoth(
                  d,
                  o.raisedBy,
                  "obs_rejected",
                  "Rejected: " + o.title,
                  "audits",
                  "AuditLens — observation not approved",
                  `Your observation "${o.title}" was not approved by the Head of Audit.`,
                  o.id,
                );
            }
            logs.push({
              action: "obs.rejected",
              summary: "Rejected observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          }
          break;
        }
        case "observation_status_change": {
          const { o } = findApprovalObs(d, ap);
          if (approve) {
            if (o) {
              applyStatusChange(o, ap.newStatus || "");
              if (o.raisedBy)
                notifyBoth(
                  d,
                  o.raisedBy,
                  "status_approved",
                  "Status change approved: " + o.title,
                  "tracker",
                  "AuditLens — status change approved",
                  `Your status change for "${o.title}" was approved — it is now ${ap.newStatus}.`,
                  o.id,
                );
              if (o.ownerUserId)
                notifyBoth(
                  d,
                  o.ownerUserId,
                  "status",
                  o.title + " status is now " + ap.newStatus,
                  "myobs",
                  "AuditLens — status updated",
                  `The status of "${o.title}" is now ${ap.newStatus}.`,
                  o.id,
                );
            }
            logs.push({
              action: "obs.status_change_approved",
              summary: "Approved status → " + ap.newStatus + ": " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          } else {
            if (o && o.raisedBy)
              notifyBoth(
                d,
                o.raisedBy,
                "status_rejected",
                "Status change rejected: " + o.title,
                "tracker",
                "AuditLens — status change rejected",
                `Your status change for "${o.title}" was not approved by the Head of Audit.`,
                o.id,
              );
            logs.push({
              action: "obs.status_change_rejected",
              summary: "Rejected status change: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          }
          break;
        }
        case "observation_update": {
          const { o } = findApprovalObs(d, ap);
          if (approve) {
            if (o && ap.changes) {
              const nb = ap.changes;
              stampClosed(o, (nb.status as string) || (o.status as string));
              Object.assign(o, nb);
              if (((nb.status as string) || o.status) === "Closed" && nb.closedDateISO)
                o.closedDateISO = nb.closedDateISO as string;
            }
            notifyBoth(
              d,
              ap.requestedBy,
              "obs_update_approved",
              "Edit approved: " + (ap.obsTitle || ""),
              "audits",
              "AuditLens — edit approved",
              `Your proposed edit to "${ap.obsTitle || "an observation"}" was approved by the Head of Audit and applied.`,
              ap.obsId,
            );
            logs.push({
              action: "obs.update_approved",
              summary: "Approved edit to observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          } else {
            notifyBoth(
              d,
              ap.requestedBy,
              "obs_update_rejected",
              "Edit not approved: " + (ap.obsTitle || ""),
              "audits",
              "AuditLens — edit not approved",
              `Your proposed edit to "${ap.obsTitle || "an observation"}" was not approved by the Head of Audit.`,
              ap.obsId,
            );
            logs.push({
              action: "obs.update_rejected",
              summary: "Rejected edit to observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          }
          break;
        }
        case "observation_delete": {
          if (approve) {
            const { r } = findApprovalObs(d, ap);
            if (r) {
              r.observations = r.observations.filter((x) => x.id !== ap.obsId);
              supersedePendingUpdate(d, ap.obsId || "", user);
              cancelPendingStatusChange(d, ap.obsId || "", user);
            }
            notifyBoth(
              d,
              ap.requestedBy,
              "obs_delete_approved",
              "Deletion approved: " + (ap.obsTitle || ""),
              "audits",
              "AuditLens — deletion approved",
              `Your request to delete "${ap.obsTitle || "an observation"}" was approved by the Head of Audit.`,
            );
            logs.push({
              action: "obs.delete_approved",
              summary: "Approved deletion of observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          } else {
            notifyBoth(
              d,
              ap.requestedBy,
              "obs_delete_rejected",
              "Deletion not approved: " + (ap.obsTitle || ""),
              "audits",
              "AuditLens — deletion not approved",
              `Your request to delete "${ap.obsTitle || "an observation"}" was not approved by the Head of Audit.`,
              ap.obsId,
            );
            logs.push({
              action: "obs.delete_rejected",
              summary: "Rejected deletion of observation: " + (ap.obsTitle || ""),
              metadata: { observationId: ap.obsId },
            });
          }
          break;
        }
        case "engagement_completion": {
          if (approve) {
            const e = (d.auditUniverse || []).find((x) => x.id === ap.unitId);
            if (e) {
              e.engStatus = "Completed";
              e.occDone = parseQuarters(e.plannedPeriod).slice();
            }
            logs.push({
              action: "plan.completion_approved",
              summary: "Approved completion: " + (ap.unitName || ""),
              metadata: { unitId: ap.unitId },
            });
          } else {
            logs.push({
              action: "plan.completion_rejected",
              summary: "Rejected completion: " + (ap.unitName || ""),
              metadata: { unitId: ap.unitId },
            });
          }
          break;
        }
      }
    });
    logs.forEach((l) => logAudit(l.action, l.summary, l.metadata));
  }

  /** Legacy modalDecideWithdraw — the Head decides a withdrawal with a reason for the owner. */
  function openDecideWithdraw(aid: string, decision: "approve" | "reject"): void {
    const ap = approvals(db).find((x) => x.id === aid);
    if (!ap) {
      toast("Request not found.", "error");
      return;
    }
    if (!isHead) {
      toast("Only the Head of Audit can decide this.", "error");
      return;
    }
    modal.open(<DecideWithdrawDialog aid={aid} decision={decision} />);
  }

  /** Legacy finalizeWithdraw. Returns whether the request was actually decided. */
  async function finalizeWithdraw(
    aid: string,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<boolean> {
    if (!isHead) {
      toast("Only the Head of Audit can decide this.", "error");
      return false;
    }
    const approve = decision === "approve";
    await loadDirectory();
    let decided = false;
    const logs: LogEntry[] = [];
    mutate((d) => {
      const ap = approvals(d).find((x) => x.id === aid);
      if (!ap || ap.status !== "pending") return;
      decided = true;
      ap.status = approve ? "approved" : "rejected";
      ap.decidedBy = user.id || "";
      ap.decidedByName = user.name || "";
      ap.decidedAt = new Date().toISOString();
      ap.headReason = reason;
      const { o } = findApprovalObs(d, ap);
      if (o) {
        o.withdrawal = {
          ...(o.withdrawal || {}),
          stage: approve ? "withdrawn" : "rejected",
          headBy: user.id || "",
          headByName: user.name || "",
          headAt: new Date().toISOString(),
          headReason: reason,
        };
        if (approve) {
          o.withdrawn = true;
          o.status = "Withdrawn";
          o.withdrawnAt = new Date().toISOString();
        }
        const ownerId = o.ownerUserId;
        if (ownerId) {
          if (approve)
            notifyBoth(
              d,
              ownerId,
              "withdrawn",
              "Observation withdrawn: " + o.title,
              "myobs",
              "AuditLens — observation withdrawn",
              `Following your review request, the Head of Audit has withdrawn the observation "${o.title}". It is no longer active.${reason ? "\n\nNote: " + reason : ""}`,
              o.id,
            );
          else
            notifyBoth(
              d,
              ownerId,
              "withdraw_rejected",
              "Withdrawal not approved: " + o.title,
              "myobs",
              "AuditLens — observation still stands",
              `The Head of Audit did not approve withdrawing the observation "${o.title}". It remains active.\n\nReason: ${reason}\n\nSign in to AuditLens to continue remediation.`,
              o.id,
            );
        }
        const forwardedBy = o.withdrawal.forwardedBy as string | undefined;
        if (forwardedBy && forwardedBy !== user.id)
          notify(
            d,
            forwardedBy,
            approve ? "withdrawn" : "withdraw_rejected",
            (approve ? "Withdrawal approved: " : "Withdrawal rejected: ") + o.title,
            "observation",
            o.id,
          );
      }
      logs.push({
        action: approve ? "obs.withdrawn" : "obs.withdraw_rejected",
        summary: (approve ? "Withdrew observation: " : "Rejected withdrawal: ") + (ap.obsTitle || ""),
        metadata: { observationId: ap.obsId },
      });
    });
    logs.forEach((l) => logAudit(l.action, l.summary, l.metadata));
    if (decided)
      toast(approve ? "Observation withdrawn." : "Withdrawal rejected and the owner notified.", "success");
    return decided;
  }

  /** Legacy approveAny — dispatch by kind (withdrawals open the reason dialog). */
  async function approveAny(aid: string): Promise<void> {
    const a = approvals(db).find((x) => x.id === aid);
    if (!a) return;
    if (a.kind === "observation_withdraw") {
      openDecideWithdraw(aid, "approve");
      return;
    }
    await decide(aid, true);
  }

  /** Legacy rejectAny. */
  async function rejectAny(aid: string): Promise<void> {
    const a = approvals(db).find((x) => x.id === aid);
    if (!a) return;
    if (a.kind === "observation_withdraw") {
      openDecideWithdraw(aid, "reject");
      return;
    }
    await decide(aid, false);
  }

  return { approveAny, rejectAny, finalizeWithdraw };
}

/* ---------------- withdraw decision dialog (legacy modalDecideWithdraw) ---------------- */

export function DecideWithdrawDialog({
  aid,
  decision,
}: {
  aid: string;
  decision: "approve" | "reject";
}) {
  const { db } = useWorkspace();
  const modal = useModal();
  const { finalizeWithdraw } = useApprovalDecisions();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const approve = decision === "approve";
  const ap = approvals(db).find((x) => x.id === aid);

  async function submit() {
    const trimmed = reason.trim();
    if (!approve && !trimmed) {
      setErr("Please give a reason for the owner.");
      return;
    }
    setErr("");
    const done = await finalizeWithdraw(aid, decision, trimmed);
    if (done) modal.close();
  }

  return (
    <ModalFrame
      title={approve ? "Approve withdrawal" : "Reject withdrawal"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className={approve ? "btn" : "btn danger"} onClick={submit}>
            {approve ? "Approve withdrawal" : "Reject request"}
          </BusyButton>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 8 }}>
        {approve ? (
          <>
            Approving marks this observation <b>Withdrawn</b> — it will not be Open or Closed. The
            action owner is notified.
          </>
        ) : (
          <>Rejecting keeps the observation active. The action owner is notified with your reason.</>
        )}
      </div>
      {ap?.reason ? (
        <div className="note" style={{ borderLeft: "3px solid var(--accent)" }}>
          <b>Action owner&#39;s reason</b>
          <div style={{ marginTop: 4 }}>{ap.reason}</div>
        </div>
      ) : null}
      <label style={{ marginTop: 8 }}>
        Reason for the action owner {approve ? "(optional)" : "*"}
      </label>
      <textarea
        style={{ minHeight: 90 }}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          approve
            ? "e.g. Agreed — the finding was based on a superseded SOP; withdrawn."
            : "e.g. The finding stands; the evidence does not address the exception noted."
        }
      />
      {err ? (
        <div className="ai-err" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}
