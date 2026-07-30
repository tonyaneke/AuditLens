"use client";

/* Remediation & verification block — React port of obsRemediationHTML() in audit-bot.js.

   This is the observation workflow: the verify stepper, the withdrawal banner, the Head's
   rejection notice, the closure package, the conversation entry point, the owner composer and
   the stage action buttons. It was dropped entirely in the first migration; the CSS for it
   (.obs-notes, .obs-composer, .verify-step*, .upload-progress*) survived in globals.css with
   nothing rendering it.

   It is shared by ObsDetailPage and ExtFindingDetailPage because legacy called the same
   function from renderObservation and renderExtFinding — porting it twice is how the two
   drifted apart in the first place. */

import Link from "next/link";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import {
  canVerifyItem,
  isHead,
  isOwnerViewer as isOwnerViewerOf,
  isPrimaryOwner,
  isSecondaryOwner,
  isWithdrawn,
  obsThread,
  obsWithdrawStage,
} from "@/lib/workspace/observations";
import { fmtDate, fmtDateTime, isoToDate } from "@/lib/workspace/selectors";
import type { Audit, EvidenceFile, Observation, Report } from "@/lib/workspace/types";
import {
  ClosureRejectDialog,
  DeclineReviewDialog,
  ForwardWithdrawalDialog,
  HeadCloseDialog,
  ReadyForClosureDialog,
  RequestReviewDialog,
  VerifyRemediationDialog,
  useOwnerRequests,
} from "./workflow-dialogs";
import ObsComposer from "./ObsComposer";

/* ---- evidence link ---- */
function Evidence({ files }: { files: EvidenceFile[] | undefined }) {
  if (!files || !files.length) return null;
  return (
    <>
      {files.map((e) => (
        <div className="hint" style={{ marginTop: 4 }} key={e.itemId}>
          📎{" "}
          <a href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
            {e.name}
          </a>
        </div>
      ))}
    </>
  );
}

/* ---- verify stepper (legacy verifyStepperHTML) ----
   A milestone unwound by a Head rejection shows as "returned" (↩) rather than reverting to
   incomplete, so a rejection never looks like a restart from "Raised". */
export function VerifyStepper({ o }: { o: Observation }) {
  const rej = o.closureRejection || null;
  const ownerReturned = !o.ownerRectifiedAt && rej && rej.prevOwnerRectified;
  const auditorReturned = !o.reportVerifiedAt && rej && rej.prevReportVerified;

  const steps = [
    { label: "Raised", done: !!o.raisedAt, who: o.raisedByName, at: o.raisedAt },
    ownerReturned
      ? {
          label: "Ready for closure",
          returned: true,
          who: rej!.prevOwnerRectified!.byName,
          at: rej!.prevOwnerRectified!.at,
          note:
            "Returned by " +
            (rej!.byName || (rej!.byRole === "audit_staff" ? "Internal Audit" : "the Head")),
        }
      : { label: "Ready for closure", done: !!o.ownerRectifiedAt, who: o.ownerRectifiedByName, at: o.ownerRectifiedAt },
    auditorReturned
      ? {
          label: "Auditor verified",
          returned: true,
          who: rej!.prevReportVerified!.byName,
          at: rej!.prevReportVerified!.at,
          note:
            "Returned by " +
            (rej!.byName || (rej!.byRole === "audit_staff" ? "Internal Audit" : "the Head")),
        }
      : { label: "Auditor verified", done: !!o.reportVerifiedAt, who: o.reportVerifiedByName, at: o.reportVerifiedAt },
    { label: "Head verified & closed", done: !!o.headVerifiedAt, who: o.headVerifiedByName, at: o.closedDateISO },
  ] as { label: string; done?: boolean; returned?: boolean; who?: string; at?: string; note?: string }[];

  return (
    <div className="verify-steps">
      {steps.map((s) => (
        <div
          className={`verify-step${s.done ? " done" : ""}${s.returned ? " returned" : ""}`}
          key={s.label}
        >
          <span className="verify-dot" aria-hidden="true">
            {s.done ? "✓" : s.returned ? "↩" : ""}
          </span>
          <div>
            <div className="verify-step-label">{s.label}</div>
            {(s.done || s.returned) && (s.who || s.at) ? (
              <div className="hint">
                {s.who || ""}
                {s.who && s.at ? " · " : ""}
                {s.at ? fmtDate(isoToDate(s.at)) : ""}
                {s.note ? (
                  <>
                    <br />
                    <span style={{ color: "#9e4419" }}>↩ {s.note}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- withdrawal banner (legacy withdrawalBannerHTML) ---- */
export function WithdrawalBanner({ o }: { o: Observation }) {
  const w = o.withdrawal as Record<string, string> | undefined | null;
  if (!w || !w.stage) return null;
  const reason = w.ownerReason ? (
    <div style={{ marginTop: 4 }}>
      <b>Owner&apos;s reason:</b> {w.ownerReason}
    </div>
  ) : null;

  const shell = (border: string, bg: string | undefined, body: React.ReactNode) => (
    <div className="note" style={{ borderLeft: `3px solid ${border}`, background: bg }}>
      {body}
    </div>
  );

  if (w.stage === "withdrawn")
    return shell("#6b3fa0", "#f6f2fb", (
      <>
        <b>⊘ Observation withdrawn</b>
        {reason}
        {w.headReason ? <div style={{ marginTop: 4 }}><b>Head of Audit:</b> {w.headReason}</div> : null}
        <div className="hint" style={{ marginTop: 4 }}>
          Withdrawn by {w.headByName || "the Head of Audit"}
          {w.headAt ? " · " + fmtDateTime(w.headAt) : ""} — this observation is not Open or Closed.
        </div>
      </>
    ));
  if (w.stage === "owner_requested")
    return shell("#c98a00", undefined, (
      <>
        <b>⏳ Review requested — deemed invalid by the action owner</b>
        {reason}
        <div className="hint" style={{ marginTop: 4 }}>
          Internal Audit is reviewing this request. {w.ownerByName || ""}
          {w.ownerAt ? " · " + fmtDateTime(w.ownerAt) : ""}
        </div>
      </>
    ));
  if (w.stage === "forwarded")
    return shell("#c98a00", undefined, (
      <>
        <b>⏳ Withdrawal awaiting Head of Audit sign-off</b>
        {reason}
        {w.forwardNote ? <div style={{ marginTop: 4 }}><b>Internal Audit note:</b> {w.forwardNote}</div> : null}
        <div className="hint" style={{ marginTop: 4 }}>
          Forwarded by {w.forwardedByName || "Internal Audit"}
          {w.forwardedAt ? " · " + fmtDateTime(w.forwardedAt) : ""}
        </div>
      </>
    ));
  if (w.stage === "declined")
    return shell("var(--crit)", undefined, (
      <>
        <b>Review request declined by Internal Audit</b>
        {w.declineReason ? <div style={{ marginTop: 4 }}>{w.declineReason}</div> : null}
        <div className="hint" style={{ marginTop: 4 }}>
          The observation remains active. {w.declinedByName || ""}
          {w.declinedAt ? " · " + fmtDateTime(w.declinedAt) : ""}
        </div>
      </>
    ));
  if (w.stage === "rejected")
    return shell("var(--crit)", undefined, (
      <>
        <b>Withdrawal not approved by the Head of Audit</b>
        {w.headReason ? <div style={{ marginTop: 4 }}>{w.headReason}</div> : null}
        <div className="hint" style={{ marginTop: 4 }}>
          The observation remains active. {w.headByName || ""}
          {w.headAt ? " · " + fmtDateTime(w.headAt) : ""}
        </div>
      </>
    ));
  return null;
}

/* ---- the block itself ---- */
export default function ObsRemediation({
  o,
  a,
  r,
  commentsHref,
}: {
  o: Observation;
  a: Audit | { id: string };
  r: Report | { id: string };
  /** Route to the full conversation view. */
  commentsHref: string;
}) {
  const user = useUser();
  const modal = useModal();
  const { requested, requestOwnerUpdate, requestProgressReport } = useOwnerRequests(a.id, r.id, o);

  const primary = isPrimaryOwner(user, o);
  const secondary = isSecondaryOwner(user, o);
  const ownerViewer = isOwnerViewerOf(user, o);
  const head = isHead(user);
  const canVerify = canVerifyItem(user, o, a as Audit);
  const closed = o.status === "Closed";

  const withdrawn = isWithdrawn(o);
  const wStage = obsWithdrawStage(o);
  const rej = o.closureRejection || null;

  /* A Head of Audit who is ALSO the auditor on this observation — the audit's lead auditor, or
     the person who raised it — is both parties to a reject-to-auditor. The stage rules below
     hid the auditor's action from anyone with the head role, on the assumption that the auditor
     is somebody else. When they are the same person, that left nobody able to move the
     observation: the head had returned it to "the auditor", and the auditor had no button. It
     could not be closed, re-verified or escalated again. Treat the head as waiting on the
     auditor only when the auditor really is another person. */
  const isAlsoAuditor =
    !!((a as Audit)?.leadAuditorId && (a as Audit).leadAuditorId === user.id) ||
    !!(o.raisedBy && o.raisedBy === user.id);
  const headAwaitingAuditor = head && !!rej && rej.target === "auditor" && !isAlsoAuditor;

  const thread = obsThread(o, ownerViewer);
  const canPost = ownerViewer && !closed && !withdrawn;
  const progressMode = !!(o.progressReport && !o.ownerRectifiedAt);

  /* ---- stage actions (legacy `actions` string) ---- */
  const actions: React.ReactNode[] = [];
  if (!closed && !withdrawn) {
    if (ownerViewer && (!wStage || wStage === "declined" || wStage === "rejected"))
      actions.push(
        <button className="btn sm" type="button" key="review"
          onClick={() => modal.open(<RequestReviewDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          Request review
        </button>,
      );
    if ((canVerify || head) && wStage === "owner_requested") {
      actions.push(
        <button className="btn sm" type="button" key="fwd"
          onClick={() => modal.open(<ForwardWithdrawalDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          Forward for withdrawal
        </button>,
        <button className="btn sec sm" type="button" key="decline"
          onClick={() => modal.open(<DeclineReviewDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          Decline request
        </button>,
      );
    }
    // DEPARTS FROM LEGACY: legacy gated this on `primary` only. Secondary owners now respond too.
    if (ownerViewer && !o.ownerRectifiedAt)
      actions.push(
        <button className="btn sm" type="button" key="rfc"
          onClick={() => modal.open(<ReadyForClosureDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          ✓ Ready for Closure
        </button>,
      );
    /* After a Head reject-to-auditor, re-verification is the AUDITOR's job — the Head only waits.
       One entry point: the modal shows the owner's response and carries both outcomes —
       verify it onward for closure, or reject it back to the owner for more work. */
    if (canVerify && o.ownerRectifiedAt && !o.reportVerifiedAt && !headAwaitingAuditor)
      actions.push(
        <button className="btn sm" type="button" key="verify"
          onClick={() => modal.open(<VerifyRemediationDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          {rej && rej.target === "auditor" ? "Resend for closure verification" : "View remediation"}
        </button>,
      );
    if (head && o.reportVerifiedAt && !o.headVerifiedAt) {
      actions.push(
        <button className="btn sm" type="button" key="hc"
          onClick={() => modal.open(<HeadCloseDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          Verify &amp; close
        </button>,
        <button className="btn sec sm" type="button" key="rj-a"
          onClick={() => modal.open(<ClosureRejectDialog auditId={a.id} reportId={r.id} obsId={o.id} target="auditor" />)}>
          Reject to auditor
        </button>,
        <button className="btn sec sm" type="button" key="rj-o"
          onClick={() => modal.open(<ClosureRejectDialog auditId={a.id} reportId={r.id} obsId={o.id} target="owner" />)}>
          Escalate to owner
        </button>,
      );
    }
    if ((canVerify || head) && o.ownerUserId && !o.ownerRectifiedAt)
      actions.push(
        <button className="btn sec sm" type="button" key="req-upd" onClick={requestOwnerUpdate}>
          {requested.has("upd") ? "🔔 Update requested" : "Request feedback from owner"}
        </button>,
      );
    if ((canVerify || head) && !o.ownerRectifiedAt)
      actions.push(
        <button className="btn sec sm" type="button" key="req-prog" onClick={requestProgressReport}>
          {requested.has("prog") ? "🔔 Progress report requested" : "Request progress report"}
        </button>,
      );
  }

  /* ---- next-step guidance (legacy nextHint) ---- */
  const nextHint = closed
    ? ""
    : primary && !o.ownerRectifiedAt
      ? rej && rej.target === "owner"
        ? `This was sent back to your department for more work by ${rej.byRole === "audit_staff" ? "Internal Audit" : "the Head of Audit"} — address the feedback above, then mark it Ready for Closure again.`
        : "When your department has addressed this, mark it Ready for Closure for Internal Audit to verify."
      : secondary && !o.ownerRectifiedAt
        ? // DEPARTS FROM LEGACY: co-owners can now respond, so the copy no longer tells them to wait.
          "You are a co-owner of this observation — you can respond and mark it Ready for Closure just as the primary owner can."
        : secondary && !o.reportVerifiedAt
          ? "You have oversight of this observation — follow progress and add comments."
          : headAwaitingAuditor && o.ownerRectifiedAt && !o.reportVerifiedAt
            ? "You returned this to Internal Audit — the auditor will address your note and resend it for your closure sign-off."
            : canVerify && o.ownerRectifiedAt && !o.reportVerifiedAt
              ? rej && rej.target === "auditor"
                ? head
                  ? // Same person on both sides: say so, rather than telling them to wait for themselves.
                    "You returned this to Internal Audit, and you are also the auditor on this observation — so it is back with you. Address the note above, then resend it for closure sign-off."
                  : "The Head of Audit returned this to Internal Audit — address the note above, then resend for closure verification."
                : "The action owner has marked this Ready for Closure — open View remediation to review their response and evidence, then either verify it to prepare closure or reject it back to the owner."
              : head && o.reportVerifiedAt && !o.headVerifiedAt
                ? "Verified by the auditor and sent to you — review the closure and evidence, then close, reject to the auditor, or escalate to the owner."
                : ownerViewer
                  ? "Your department has marked this Ready for Closure. Internal Audit will verify."
                  : !o.ownerRectifiedAt
                    ? "Awaiting the action owner's response."
                    : !o.reportVerifiedAt
                      ? "Awaiting auditor verification."
                      : "Awaiting Head of Audit closure.";

  /* ---- closure package ----
     The action owner's closure response is deliberately NOT repeated here: obsThread() already
     puts it in the conversation as a "closure" entry, so the comments page is its one home.
     Reviewers still see it where they need it — inside the View-remediation and Head-close
     modals, which is the point at which they are judging it. */
  const pkg: React.ReactNode[] = [];
  if (o.reportVerifiedAt && closed)
    pkg.push(
      <div className="obs-field" key="aud">
        <div className="ttl">Auditor verification &amp; closure note</div>
        <div className="txt">
          {o.closureNote ? <RichText text={o.closureNote} /> : <span className="hint">No note.</span>}
          <Evidence files={o.closureFile ? [o.closureFile] : undefined} />
          <div className="hint" style={{ marginTop: 4 }}>
            Verified by {o.reportVerifiedByName || "—"}
            {o.reportVerifiedAt ? " · " + fmtDateTime(o.reportVerifiedAt) : ""}
          </div>
        </div>
      </div>,
    );
  if (o.headComment && closed)
    pkg.push(
      <div className="obs-field" key="head">
        <div className="ttl">Head of Audit comment</div>
        <div className="txt">
          <RichText text={o.headComment} />
          {o.headVerifiedByName ? (
            <div className="hint" style={{ marginTop: 4 }}>
              {o.headVerifiedByName}
              {o.headVerifiedAt ? " · " + fmtDateTime(o.headVerifiedAt) : ""}
            </div>
          ) : null}
        </div>
      </div>,
    );

  return (
    <div className="obs-notes">
      <div className="obs-notes-label">Remediation &amp; verification</div>
      <WithdrawalBanner o={o} />
      {withdrawn ? null : <VerifyStepper o={o} />}

      {rej && !closed && (rej.target === "owner" || !ownerViewer) ? (
        <div className="note">
          <b>
            {rej.target === "auditor"
              ? "Returned by the Head of Audit to Internal Audit"
              : rej.byRole === "audit_staff"
                ? "Returned by Internal Audit to the action owner for more work"
                : "Escalated by the Head of Audit to the action owner"}
          </b>
          {rej.note ? <div style={{ marginTop: 4 }}>{rej.note}</div> : null}
          <div className="hint" style={{ marginTop: 4 }}>
            {rej.byName || (rej.byRole === "audit_staff" ? "Internal Audit" : "Head of Audit")}
            {rej.at ? " · " + fmtDateTime(rej.at) : ""}
          </div>
        </div>
      ) : null}

      {o.progressReport && !o.ownerRectifiedAt && !closed ? (
        <div className="note" style={{ borderLeft: "3px solid #c98a00" }}>
          <b>📋 Progress report requested by Internal Audit</b>
          <div className="hint" style={{ marginTop: 4 }}>
            {ownerViewer
              ? "Post a progress update below — it stays requested until you mark this Ready for Closure."
              : "Awaiting a progress update from the action owner."}{" "}
            · {o.progressReport.byName || "Internal Audit"}
            {o.progressReport.at ? " · " + fmtDateTime(o.progressReport.at) : ""}
          </div>
        </div>
      ) : null}

      {pkg}

      <div className="obs-notes-label obs-updates-label">Conversation &amp; evidence</div>
      {thread.length ? (
        <div className="row" style={{ margin: "6px 0 2px" }}>
          <Link className="btn sec sm" href={commentsHref}>
            {ownerViewer ? "View your past comments" : "View comments"} ({thread.length})
          </Link>
        </div>
      ) : (
        <div className="hint">No comments yet.</div>
      )}

      {canPost ? (
        <ObsComposer
          auditId={a.id}
          reportId={r.id}
          o={o}
          primary={primary}
          progressMode={progressMode}
          nextHint={nextHint}
          actions={actions}
        />
      ) : actions.length || nextHint ? (
        <div className="obs-actions-block" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div className="obs-notes-label obs-updates-label" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
            {closed ? "Closed" : "Next step"}
          </div>
          {nextHint ? <div className="hint" style={{ margin: "2px 0 8px" }}>{nextHint}</div> : null}
          {actions.length ? <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{actions}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
