"use client";

/* Observation detail page — faithful port of renderObservation() in audit-bot.js.

   The previous version of this file was a simplified rewrite rather than a port: it dropped the
   remediation block entirely, added an SOP button legacy never had, hoisted the closure actions
   into the topbar, and closed observations by writing `status` directly — a controlled field the
   server reverts for anyone but the Head (see lib/workspace-authz.ts). All of that is restored
   to the legacy shape here; the closure chain now runs through ObsRemediation. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton, CritPill, StatusPill } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import {
  canVerifyItem,
  cancelPendingDelete,
  cancelPendingStatusChange,
  isHead,
  isRecentlyCreated,
  notifyHeadsApproval,
  obsWithdrawStage,
  pendingDelete,
  pendingUpdate,
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
function ApprovalBadge({ approval }: { approval: string | undefined }) {
  if (approval === "pending") return <span className="pill sop-pending-pill">⏳ Pending Head approval</span>;
  if (approval === "rejected") return <span className="pill c-Critical">Rejected</span>;
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
  const canEdit = head || canVerifyItem(user, o, a);
  const backHref = a && r ? `/audits/${a.id}/reports/${r.id}` : "/audits";
  const changePending = !head && !!o && (!!pendingUpdate(db, o.id) || !!pendingDelete(db, o.id));

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
          logAudit("obs.delete_requested", "Requested deletion of observation: " + title, {
            auditId,
            reportId,
            observationId: obsId,
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
        logAudit("obs.deleted", "Deleted observation: " + title, { auditId, reportId, observationId: obsId });
        router.push(backHref);
      },
    });
  }

  /* Topbar carries only what legacy put there: Reassign / Edit / Delete + the pending pill.
     The closure actions belong to the remediation block, not up here. */
  usePageChrome({
    title: o ? `${o.ref ? o.ref + " — " : ""}${o.title}` : "Observation",
    back: <BackButton href={backHref} />,
    actions: canEdit && a && r && o ? (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {head ? (
          <button className="btn sm" type="button"
            onClick={() => modal.open(<ModalReassignObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
            Reassign owner
          </button>
        ) : null}
        <button className="btn sec sm" type="button"
          onClick={() => modal.open(<ModalObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}>
          {head ? "Edit" : "Propose edit"}
        </button>
        <button className="btn ghost sm danger" type="button" onClick={requestDelete}>
          {head ? "Delete" : "Request deletion"}
        </button>
        {changePending ? <span className="pill sop-pending-pill">⏳ Change pending approval</span> : null}
      </div>
    ) : null,
  });

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
  const age = obsAge(o, r);
  const overdue = isOverdueObs(o, r);

  return (
    <div className={`obs-detail-page anim-fade-in${isRecentlyCreated(o) ? " obs-new-highlight" : ""}`}>
      <header className="obs-detail-hero">
        <div className="obs-detail-badges">
          <CritPill crit={o.criticality} />
          <StatusPill status={o.status} />
          <ApprovalBadge approval={o.obsApproval} />
          {o.isRepeat ? (
            <span className="pill repeat-pill" title={o.repeatOf || "Repeat finding"}>↻ REPEAT</span>
          ) : null}
          {o.category ? <span className="tag">{String(o.category)}</span> : null}
          {obsWithdrawStage(o) ? <span className={`pill ${ck(o.criticality)}`}>under review</span> : null}
        </div>
        <h2 className="obs-detail-title">
          {o.ref ? o.ref + " — " : ""}
          {o.title}
        </h2>
      </header>

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
