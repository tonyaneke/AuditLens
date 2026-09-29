"use client";

// Approval decision actions — React port of approveAny/rejectAny and the per-kind legacy
// decision functions in audit-bot.js (approveObservation/rejectObservation, approveStatusChange/
// rejectStatusChange, approveUpdate/rejectUpdate, approveDelete/rejectDelete, approveCompletion/
// rejectCompletion, modalDecideWithdraw/finalizeWithdraw) including their notification and email
// side effects. The audit trail of each decision is recorded by the save itself
// (lib/workspace-changes.ts). Decisions are Head-of-Audit-only — mirrored server-side by the
// reconciler (lib/workspace-authz.ts).

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { loadDirectory } from "@/lib/client/directory";
import { applyStatusChange, findApprovalObs } from "@/lib/workspace/approvals";
import {
  cancelPendingStatusChange,
  findObsIn,
  notify,
  notifyBoth,
  notifyDeptOfObs,
  notifyOwnerAssigned,
  stampClosed,
  supersedePendingUpdate,
} from "@/lib/workspace/observations";
import { parseQuarters } from "@/lib/workspace/ra";
import { approvals } from "@/lib/workspace/selectors";
import type { Observation, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { effectiveRole } from "@/lib/permissions";

/* Mutating (run inside mutate). Approval is the moment the finding becomes real to the
   department — before it, canSeeObs() withholds it from them, so this is the first point at
   which a notification would have anything to open. */
function publishObs(d: WorkspaceDb, o: Observation): void {
  o.obsApproval = "approved";
  notifyOwnerAssigned(d, o);
  notifyDeptOfObs(d, o, "assigned", "Raised against your department: " + o.title);
}

export function useApprovalDecisions() {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const isHead = effectiveRole(user) === "head_of_audit";

  /** Per-kind decision for every kind except observation_withdraw (which needs a reason dialog).
   *  `note` is the Head's word to the requester — a raise rejection carries what needs changing,
   *  or, when `final`, why it is rejected for good. */
  async function decide(aid: string, approve: boolean, note = "", final = false): Promise<boolean> {
    if (!isHead) {
      toast(`Only the Head of Audit can ${approve ? "approve" : "reject"}.`, "error");
      return false;
    }
    // Warm the directory cache (emails resolve through it) BEFORE touching the workspace —
    // never read db across an await.
    await loadDirectory();
    let decided = false;
    mutate((d) => {
      const ap = approvals(d).find((x) => x.id === aid);
      if (!ap || ap.status !== "pending") return;
      decided = true;
      ap.status = approve ? "approved" : "rejected";
      ap.decidedBy = user.id || "";
      ap.decidedByName = user.name || "";
      ap.decidedAt = new Date().toISOString();
      if (note) ap.headReason = note;
      switch (ap.kind) {
        case "observation_raise": {
          const { o } = findApprovalObs(d, ap);
          if (approve) {
            if (o) {
              publishObs(d, o);
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
          } else {
            if (o) {
              /* Two kinds of rejection. By default it is sent back for rework: Internal Audit can
                 edit it and send it back (resubmitObs in lib/workspace/approvals.ts). Rejected
                 for good (`final`), it is closed — the server refuses rework on it — and any
                 edit request still open on it is settled, since there is nothing left to edit.
                 Tell whoever raised it, and whoever sent this round if that was someone else. */
              o.obsApproval = "rejected";
              if (final) {
                o.rejectionFinal = true;
                ap.final = true;
                supersedePendingUpdate(d, o.id, user);
              } else delete o.rejectionFinal;
              const told = new Set([o.raisedBy, ap.requestedBy].filter(Boolean) as string[]);
              for (const to of told)
                if (final)
                  notifyBoth(
                    d,
                    to,
                    "obs_rejected",
                    "Rejected: " + o.title,
                    "audits",
                    "AuditLens — observation rejected",
                    `The Head of Audit rejected the observation "${o.title}". It is closed with no further action.` +
                      (note ? `\n\nReason: ${note}` : ""),
                    o.id,
                  );
                else
                  notifyBoth(
                    d,
                    to,
                    "obs_rejected",
                    "Rejected — edit and send back: " + o.title,
                    "audits",
                    "AuditLens — observation sent back for changes",
                    `The Head of Audit rejected the observation "${o.title}".` +
                      (note ? `\n\nWhat needs to change: ${note}` : "") +
                      `\n\nOpen it in AuditLens to edit it and send it back for approval.`,
                    o.id,
                  );
            }
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
          }
          break;
        }
        case "observation_update": {
          const { o } = findApprovalObs(d, ap);
          if (approve) {
            if (o && ap.changes) {
              /* The reference is system-assigned, never an edit. Proposals made before the edit
                 form stopped sending it carry the ref as it stood then, and applying one would
                 undo any renumbering since. */
              const nb = { ...ap.changes };
              delete nb.ref;
              stampClosed(o, (nb.status as string) || (o.status as string));
              Object.assign(o, nb);
              if (((nb.status as string) || o.status) === "Closed" && nb.closedDateISO)
                o.closedDateISO = nb.closedDateISO as string;
            }
            /* An edit to an observation whose raise was rejected is Internal Audit's rework of
               it: before the Head could edit a raise under review, rejecting was the only way to
               send one back. Approving the rework used to apply the text and leave the finding
               rejected — off the tracker, never sent to its owner — so the Head could not find
               the observation just approved. Approving the rework now approves the finding; the
               details dialog says so before the decision. Not one rejected for good — that is
               closed, and approving a stray edit to it only applies the text. */
            const reinstated = !!o && o.obsApproval === "rejected" && !o.rejectionFinal;
            if (o && reinstated) publishObs(d, o);
            notifyBoth(
              d,
              ap.requestedBy,
              reinstated ? "obs_approved" : "obs_update_approved",
              (reinstated ? "Approved: " : "Edit approved: ") + (ap.obsTitle || ""),
              "audits",
              reinstated ? "AuditLens — observation approved" : "AuditLens — edit approved",
              reinstated
                ? `Your revised observation "${ap.obsTitle || "an observation"}" was approved by the Head of Audit and the action owner has been notified.`
                : `Your proposed edit to "${ap.obsTitle || "an observation"}" was approved by the Head of Audit and applied.`,
              ap.obsId,
            );
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
          }
          // A rejection changes nothing on the unit; the approval's own status records it.
          break;
        }
      }
    });
    return decided;
  }

  /** The Head approving an observation whose raise was rejected — typically after editing it
   *  rather than waiting for Internal Audit to send it back. No request is open (a rejected
   *  raise has none until it is resubmitted), so this goes straight to the observation. */
  async function approveRejected(auditId: string, reportId: string, obsId: string): Promise<boolean> {
    if (!isHead) {
      toast("Only the Head of Audit can approve.", "error");
      return false;
    }
    await loadDirectory();
    let done = false;
    mutate((d) => {
      const o = findObsIn(d, auditId, reportId, obsId);
      if (!o || o.obsApproval !== "rejected") return;
      done = true;
      delete o.rejectionFinal;
      publishObs(d, o);
      if (o.raisedBy)
        notifyBoth(
          d,
          o.raisedBy,
          "obs_approved",
          "Approved: " + o.title,
          "audits",
          "AuditLens — observation approved",
          `Your observation "${o.title}" was approved by the Head of Audit after all, and the action owner has been notified.`,
          o.id,
        );
    });
    return done;
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
    });
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

  /** Legacy rejectAny. A new observation's rejection goes through a dialog: it asks what needs
   *  changing and says plainly that the observation goes back to be fixed, not away. */
  async function rejectAny(aid: string): Promise<void> {
    const a = approvals(db).find((x) => x.id === aid);
    if (!a) return;
    if (a.kind === "observation_withdraw") {
      openDecideWithdraw(aid, "reject");
      return;
    }
    if (a.kind === "observation_raise" && isHead) {
      modal.open(<RejectRaiseDialog aid={aid} />);
      return;
    }
    await decide(aid, false);
  }

  /** The raise-rejection dialog's submit. Returns whether the request was actually decided. */
  function rejectRaise(aid: string, note: string, final: boolean): Promise<boolean> {
    return decide(aid, false, note, final);
  }

  /** The Head reopening an observation rejected for good, so Internal Audit can edit it and send
   *  it back after all. It stays rejected (off the tracker) until it is approved. */
  async function reopenRejected(auditId: string, reportId: string, obsId: string): Promise<boolean> {
    if (!isHead) {
      toast("Only the Head of Audit can reopen a rejection.", "error");
      return false;
    }
    await loadDirectory();
    let done = false;
    mutate((d) => {
      const o = findObsIn(d, auditId, reportId, obsId);
      if (!o || o.obsApproval !== "rejected" || !o.rejectionFinal) return;
      done = true;
      delete o.rejectionFinal;
      if (o.raisedBy)
        notifyBoth(
          d,
          o.raisedBy,
          "obs_rejected",
          "Reopened for changes: " + o.title,
          "audits",
          "AuditLens — rejected observation reopened",
          `The Head of Audit reopened the rejected observation "${o.title}". You can now edit it and send it back for approval.`,
          o.id,
        );
    });
    return done;
  }

  return { approveAny, rejectAny, rejectRaise, approveRejected, reopenRejected, finalizeWithdraw };
}

/* ---------------- reject a new observation — send it back for changes ---------------- */

export function RejectRaiseDialog({ aid }: { aid: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const { rejectRaise } = useApprovalDecisions();
  const [note, setNote] = useState("");
  const [final, setFinal] = useState(false);
  const [err, setErr] = useState("");
  const ap = approvals(db).find((x) => x.id === aid);
  const { o } = ap ? findApprovalObs(db, ap) : { o: undefined };
  const raiser = String(o?.raisedByName || ap?.requestedByName || "the auditor who raised it");

  async function submit() {
    const trimmed = note.trim();
    // A final rejection is the record of why a finding was never raised, so it needs a reason.
    if (final && !trimmed) {
      setErr("Give the reason for rejecting it for good — it is kept on record.");
      return;
    }
    setErr("");
    const done = await rejectRaise(aid, trimmed, final);
    if (!done) return;
    modal.close();
    toast(
      final ? "Rejected for good. No further action is needed." : `Rejected and sent back to ${raiser} for changes.`,
      "success",
    );
  }

  const option = (value: boolean, title: string, body: string) => (
    <label
      style={{ display: "flex", gap: 10, alignItems: "flex-start", fontWeight: 400, marginTop: 6, cursor: "pointer" }}
    >
      <input
        type="radio"
        name="reject-kind"
        style={{ width: "auto", marginTop: 3 }}
        checked={final === value}
        onChange={() => {
          setFinal(value);
          setErr("");
        }}
      />
      <span>
        <b>{title}</b>
        <span className="hint" style={{ display: "block" }}>
          {body}
        </span>
      </span>
    </label>
  );

  return (
    <ModalFrame
      title="Reject observation"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn danger" onClick={submit}>
            {final ? "Reject for good" : <>Reject &amp; send back</>}
          </BusyButton>
        </>
      }
    >
      {o ? (
        <div className="note" style={{ marginBottom: 10 }}>
          <b>{o.title}</b>
        </div>
      ) : null}
      <div role="radiogroup" aria-label="Kind of rejection" style={{ marginBottom: 10 }}>
        {option(
          false,
          "Send back for changes",
          `It goes back to ${raiser}, who can edit it and send it back for your approval. You can also edit it yourself and approve it later.`,
        )}
        {option(
          true,
          "Reject for good",
          "No further action. It is closed and kept on record as rejected — it cannot be edited or sent back. You can reopen it later if you change your mind.",
        )}
      </div>
      <label>
        {final ? (
          <>
            Reason <span className="hint">(required — {raiser} sees this)</span>
          </>
        ) : (
          <>
            What needs to change? <span className="hint">(optional — {raiser} sees this)</span>
          </>
        )}
      </label>
      <textarea
        style={{ minHeight: 90 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={
          final
            ? "e.g. Not a finding — the control operated as designed; the exception was an approved waiver."
            : "e.g. Quantify the exposure and cite the policy clause breached."
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
