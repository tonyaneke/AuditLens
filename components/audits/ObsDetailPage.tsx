"use client";

/* Observation detail page — faithful port of renderObservation() in audit-bot.js.

   The previous version of this file was a simplified rewrite rather than a port: it dropped the
   remediation block entirely, added an SOP button legacy never had, hoisted the closure actions
   into the topbar, and closed observations by writing `status` directly — a controlled field the
   server reverts for anyone but the Head (see lib/workspace-authz.ts). All of that is restored
   to the legacy shape here; the closure chain now runs through ObsRemediation. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApprovalDecisions } from "@/components/approvals/decisions";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton, CritPill, StatusPill } from "@/components/ui";
import { deptLabel, deptNameOf } from "@/lib/dept-scope";
import { loadDirectory } from "@/lib/client/directory";
import { canAccessView, effectiveRole } from "@/lib/permissions";
import { lastRaiseRejection, pendingRaise, resubmitObs } from "@/lib/workspace/approvals";
import {
  canVerifyItem,
  cancelPendingDelete,
  cancelPendingStatusChange,
  isActionOwner,
  isHead,
  isInternalAudit,
  isRecentlyCreated,
  notifyHeadsApproval,
  obsWithdrawStage,
  pendingDelete,
  pendingUpdate,
  sourceTestLabel,
  supersedePendingUpdate,
} from "@/lib/workspace/observations";
import {
  approvals,
  ck,
  effectiveClose,
  fmtDate,
  fmtDateTime,
  isOverdueObs,
  isoToDate,
  obsAge,
  uid,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { Attachments, Meta, Section } from "./detail-parts";
import { ModalObsDialog, ModalReassignObsDialog } from "./lazy";
import ObsRemediation from "./ObsRemediation";

/* legacy obsApprovalBadge */
function ApprovalBadge({ approval, final }: { approval: string | undefined; final?: boolean }) {
  if (approval === "pending") return <span className="pill sop-pending-pill">⏳ Pending Head approval</span>;
  if (approval === "rejected")
    return <span className="pill c-Critical">{final ? "Rejected" : "Rejected · sent back"}</span>;
  return null;
}

/* Section / Attachments / Meta now live in ./detail-parts so the external register's page renders
   a finding exactly the same way — see the note at the top of that file. */


export default function ObsDetailPage({
  auditId,
  reportId,
  obsId,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
}) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const router = useRouter();

  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const o = r && (r.observations || []).find((x) => x.id === obsId);

  const head = isHead(user);
  const internalAudit = isInternalAudit(user);
  const isOwner = isActionOwner(user);
  const isExec = effectiveRole(user) === "executive";
  const canEdit = head || canVerifyItem(user, o, a);
  const backHref = isOwner
    ? "/portal/myobs"
    : isExec
      ? "/"
      : a && r
        ? `/audits/${a.id}/reports/${r.id}`
        : "/audits";
  const changePending = !head && !!o && (!!pendingUpdate(db, o.id) || !!pendingDelete(db, o.id));
  /* A raise awaiting the Head can be decided here as well as on the Approvals page, so reviewing
     it from the report — Edit, Reassign owner, then decide — never needs a trip back to the queue.
     Same decision code as the queue, so notifications and the request's own record match. */
  const { approveAny, rejectAny, approveRejected, reopenRejected } = useApprovalDecisions();
  const review = head && o ? pendingRaise(db, o.id) : undefined;
  /* Rejected = sent back for rework. Internal Audit edits it and sends it back; the Head can edit
     and approve it directly. Owners never see a rejected raise (canSeeObs). */
  const rejected = internalAudit && !!o && o.obsApproval === "rejected";
  const rejection = rejected && o ? lastRaiseRejection(db, o.id) : undefined;
  // Rejected for good: closed. Nothing for staff to do; the Head may reopen it.
  const finalRejected = rejected && !!o?.rejectionFinal;
  const rework = rejected && !head && !finalRejected;

  /* Port of delObs. Non-head deletion is a request, not an act — an `observation_delete`
     approval is parked for the Head (the server blocks the direct delete anyway, see
     obs_delete_blocked in lib/workspace-authz.ts). */
  function requestDelete() {
    if (!o) return;
    const title = o.title;
    if (!head) {
      void modal.confirm({
        title: "Request deletion",
        message: (
          <>
            Request deletion of <b>{title}</b>? The Head of Audit must approve before it is removed.
          </>
        ),
        confirmLabel: "Request deletion",
        onConfirm: () => {
          if (pendingDelete(db, obsId)) {
            toast("A deletion request is already awaiting approval.", "info");
            return;
          }
          mutate((d) => {
            approvals(d).push({
              id: uid(),
              kind: "observation_delete",
              obsId,
              auditId,
              reportId,
              obsTitle: title,
              requestedBy: user.id || "",
              requestedByName: user.name || "",
              requestedAt: new Date().toISOString(),
              status: "pending",
            });
            notifyHeadsApproval(d, title + " (deletion request)");
          });
          toast("Deletion request submitted to the Head of Audit.", "success");
        },
      });
      return;
    }
    void modal.confirm({
      title: "Delete observation",
      message: (
        <>
          Delete <b>{title}</b>? This cannot be undone.
        </>
      ),
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => {
        mutate((d) => {
          const curA = (d.audits || []).find((x) => x.id === auditId);
          const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
          if (curR) curR.observations = (curR.observations || []).filter((x) => x.id !== obsId);
          // Legacy delObs: tidy every pending request that pointed at the deleted observation.
          supersedePendingUpdate(d, obsId, user);
          cancelPendingStatusChange(d, obsId, user);
          cancelPendingDelete(d, obsId, user);
        });
        router.push(backHref);
      },
    });
  }

  /* Topbar carries only actions: Back button on the left, Reassign / Edit / Delete + pending pill on the right.
     The title is rendered in the hero section below to prevent topbar overlap. */
  usePageChrome({
    title: "",
    back: (
      <BackButton
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
          } else {
            router.push(backHref);
          }
        }}
      />
    ),
    actions: canEdit && a && r && o ? (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {internalAudit ? (
          <button className="btn sm" type="button"
            onClick={() => modal.open(<ModalReassignObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
            Reassign owner
          </button>
        ) : null}
        {head || !finalRejected ? (
          <button className="btn sec sm" type="button"
            onClick={() => modal.open(<ModalObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
            {head || rework ? "Edit" : "Propose edit"}
          </button>
        ) : null}
        <button className="btn ghost sm danger" type="button" onClick={requestDelete}>
          {head ? "Delete" : "Request deletion"}
        </button>
        {changePending ? <span className="pill sop-pending-pill">⏳ Change pending approval</span> : null}
      </div>
    ) : null,
  },
  // The title here is always blank, so without these the topbar kept the buttons it had on first
  // load — still offering Edit after a final rejection, or the old label after a send-back.
  [o?.id, o?.obsApproval, o?.rejectionFinal, changePending, canEdit]);

  if (!a || !r || !o) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Observation not found</h3>
        <p className="hint">The requested observation could not be found.</p>
        <Link href={backHref} className="btn sec" style={{ marginTop: 16 }}>← Back</Link>
      </div>
    );
  }

  const ec = effectiveClose(o, r);
  const testLabel = sourceTestLabel(a, o);
  const testExists = !!o.sourceTest && (a.plan?.tests || []).some((x) => x.id === o.sourceTest);
  const age = obsAge(o, r);
  const overdue = isOverdueObs(o, r);

  return (
    <div className={`obs-detail-page anim-fade-in${isRecentlyCreated(o) ? " obs-new-highlight" : ""}`}>
      <header className="obs-detail-hero">
        <div className="obs-detail-badges">
          <CritPill crit={o.criticality} />
          <StatusPill status={o.status} />
          <ApprovalBadge approval={o.obsApproval} final={!!o.rejectionFinal} />
          {o.isRepeat ? (
            <span className="pill repeat-pill" title={o.repeatOf || "Repeat finding"}>↻ REPEAT</span>
          ) : null}
          {deptLabel(deptNameOf(db, o)) ? (
            <span className="tag">{deptLabel(deptNameOf(db, o))}</span>
          ) : null}
          {o.category ? <span className="tag">{String(o.category)}</span> : null}
          {obsWithdrawStage(o) ? <span className={`pill ${ck(o.criticality)}`}>under review</span> : null}
        </div>
        <h2 className="obs-detail-title">
          {o.ref ? o.ref + " — " : ""}
          {o.title}
        </h2>
      </header>

      {review ? (
        <div
          className="note"
          role="region"
          aria-label="Awaiting your approval"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 16px" }}
        >
          <div style={{ flex: "1 1 260px" }}>
            <b>Awaiting your approval.</b> {review.resubmitted ? "Sent back after your rejection" : "Raised"} by{" "}
            {review.requestedByName || o.raisedByName || "Internal Audit"}
            {review.requestedAt ? " on " + fmtDateTime(review.requestedAt) : ""}. Edit it or reassign the
            owner first if needed. It goes on the tracker and to its action owner once you approve it.
          </div>
          {/* Opens the reject dialog, which asks what needs changing and confirms on its own. */}
          <button className="btn ghost sm danger" type="button" onClick={() => void rejectAny(review.id)}>
            Reject
          </button>
          <BusyButton
            className="btn sm"
            onClick={async () => {
              await approveAny(review.id);
              toast("Observation approved. It is on the tracker and the action owner has been notified.", "success");
            }}
          >
            Approve
          </BusyButton>
        </div>
      ) : null}

      {rejected ? (
        <div
          className="note"
          role="region"
          aria-label="Rejected — sent back for changes"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            margin: "0 0 16px",
            borderLeft: "3px solid var(--crit)",
          }}
        >
          <div style={{ flex: "1 1 260px" }}>
            <b>{finalRejected ? "Rejected for good" : "Rejected"}</b>
            {rejection?.decidedByName ? " by " + rejection.decidedByName : ""}
            {rejection?.decidedAt ? " on " + fmtDateTime(rejection.decidedAt) : ""}.{" "}
            {finalRejected
              ? head
                ? "No further action. Reopen it if Internal Audit should rework it after all."
                : "No further action is needed."
              : head
                ? "Internal Audit can edit it and send it back for your approval, or you can edit it and approve it now."
                : "Edit it, then send it back to the Head of Audit for approval."}
            {rejection?.headReason ? (
              <div style={{ marginTop: 4 }}>
                <b>{finalRejected ? "Reason:" : "What needs to change:"}</b> {String(rejection.headReason)}
              </div>
            ) : null}
          </div>
          {finalRejected ? (
            head ? (
              <BusyButton
                className="btn sec sm"
                onClick={async () => {
                  if (await reopenRejected(a.id, r.id, o.id))
                    toast("Reopened. Internal Audit can now edit it and send it back for approval.", "success");
                }}
              >
                Reopen for changes
              </BusyButton>
            ) : null
          ) : (
          <>
          <button
            className="btn sec sm"
            type="button"
            onClick={() => modal.open(<ModalObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}
          >
            Edit
          </button>
          {head ? (
            <BusyButton
              className="btn sm"
              onClick={async () => {
                if (await approveRejected(a.id, r.id, o.id))
                  toast("Observation approved. It is on the tracker and the action owner has been notified.", "success");
              }}
            >
              Approve
            </BusyButton>
          ) : (
            <BusyButton
              className="btn sm"
              onClick={async () => {
                await loadDirectory(); // the Head is told through the directory cache
                let sent = false;
                mutate((d) => {
                  const curA = (d.audits || []).find((x) => x.id === a.id);
                  const curR = curA && (curA.reports || []).find((x) => x.id === r.id);
                  const cur = curR && (curR.observations || []).find((x) => x.id === o.id);
                  if (!cur || cur.obsApproval !== "rejected") return;
                  resubmitObs(d, a.id, r.id, cur, user);
                  sent = true;
                });
                if (sent) toast("Sent back to the Head of Audit for approval.", "success");
              }}
            >
              Send back for approval
            </BusyButton>
          )}
          </>
          )}
        </div>
      ) : null}

      <div className="obs-detail-meta">
        {o.owner ? <Meta label="Owner">{String(o.owner)}</Meta> : null}
        {o.secondaryOwner ? <Meta label="Co-owner">{String(o.secondaryOwner)}</Meta> : null}
        {o.timeline ? <Meta label="Timeline">{String(o.timeline)}</Meta> : null}
        {ec ? (
          <Meta label="Expected close">
            {fmtDate(ec)}
            {overdue ? <> <span className="pill c-Critical">OVERDUE</span></> : null}
          </Meta>
        ) : null}
        {age != null ? (
          <Meta label="Age">
            {age} day{age !== 1 ? "s" : ""}
            {o.status === "Closed" ? " to close" : ""}
          </Meta>
        ) : null}
        {o.createdAt ? <Meta label="Created">{fmtDateTime(o.createdAt)}</Meta> : null}
        {testLabel ? (
          <Meta label="Test programme">
            {/* Linked only for people who can open the audit plan; everyone else sees the title. */}
            {testExists && canAccessView(user, "audit") ? (
              <Link href={`/audits/${a.id}/tests/${String(o.sourceTest)}`}>{testLabel}</Link>
            ) : (
              testLabel
            )}
          </Meta>
        ) : null}
      </div>

      <div className="obs-detail-sections">
        <Section title="Detailed description" text={o.description} />
        <Section title="Criteria / expectation" text={o.criteria} />
        <Section title="Impact / risk" text={o.risk} />
        <Section title="Possible root cause" text={o.rootCause} />
        <Section title="Recommendation" text={o.recommendation} />
        {/* Legacy shows the proposed SOP update as a section here. The SOP page is reached from
            the report's "Proposed SOP updates" roll-up — never from a button on this page. */}
        <Section title="Proposed SOP update" text={o.sopUpdate} />
        <Section title="Management response" text={o.managementResponse} />
        <Attachments files={o.attachments} />
      </div>

      <ObsRemediation
        o={o}
        a={a}
        r={r}
        commentsHref={`/audits/${a.id}/reports/${r.id}/observations/${o.id}/comments`}
      />

      {o.status === "Closed" ? (
        <div className="obs-detail-closure hint">
          ✓ Closed{o.closedDateISO ? " " + fmtDate(isoToDate(o.closedDateISO)) : ""} · Verified by{" "}
          {o.headVerifiedByName || o.verifiedBy || "—"}
          {o.raisedByName ? (<><br />Raised by {o.raisedByName}</>) : null}
          {o.reportVerifiedByName ? " · Verified by auditor " + o.reportVerifiedByName : ""}
        </div>
      ) : null}
    </div>
  );
}
