"use client";

// Engagement detail for one auditable unit — React port of renderRaUnit/raPlanDetailHTML/
// raStatusSection plus the completion-approval actions (raRequestComplete/approveCompletion/
// rejectCompletion/raSetInProgress/raReopen).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { urlForView } from "@/lib/routes";
import {
  engIsComplete,
  engStatusLabel,
  ensureUniverse,
  parseQuarters,
  planYear,
  RA_FACTORS,
  RA_HEX,
  raBand,
  raComposite,
  raFreqLabel,
  pendingCompletion,
  universe,
} from "@/lib/workspace/ra";
import { fmtDateTime, hx2rgba, uid } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import AuditLinks from "./AuditLinks";
import EngagementStatusPill from "./EngagementStatusPill";
import { RaUnitDialog } from "./dialogs";

export default function RaUnitPage({ unitId }: { unitId: string }) {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const isHead = user.role === "head_of_audit";

  const e = universe(db).find((x) => x.id === unitId);
  const backHref = urlForView("auditra");

  // Legacy modalRA() refused to open for anyone but the Head of Audit (requireHead).
  function editUnit() {
    if (!isHead) {
      toast("Only the Head of Audit can perform this action.", "error");
      return;
    }
    if (e) modal.open(<RaUnitDialog unitId={e.id} />);
  }

  usePageChrome(
    {
      title: "Audit Risk Assessment",
      back: <BackButton href={backHref} />,
      actions: e ? (
        <button
          className="btn sec sm"
          type="button"
          onClick={editUnit}
        >
          Edit unit &amp; timing
        </button>
      ) : null,
    },
    [unitId, !!e],
  );

  // Legacy renderRaUnit() bounced back to the list when the unit id no longer resolved.
  useEffect(() => {
    if (!e) router.replace(backHref);
  }, [e, router, backHref]);

  if (!e) return null;

  const score = raComposite(e.factors);
  const band = e.ratingOverride || raBand(score);
  const pend = pendingCompletion(db, e.id);
  const complete = engIsComplete(e);

  function setInProgress() {
    mutate((d) => {
      const u = ensureUniverse(d).find((x) => x.id === unitId);
      if (u) u.engStatus = "In progress";
    });
  }
  function reopen() {
    mutate((d) => {
      const u = ensureUniverse(d).find((x) => x.id === unitId);
      if (u) {
        u.engStatus = "In progress";
        u.occDone = [];
      }
    });
  }
  function markComplete() {
    mutate((d) => {
      const u = ensureUniverse(d).find((x) => x.id === unitId);
      if (u) {
        u.engStatus = "Completed";
        u.occDone = parseQuarters(u.plannedPeriod).slice();
      }
    });
  }
  function requestComplete() {
    if (isHead) {
      markComplete();
      logAudit("plan.completed", "Marked engagement complete: " + e!.name, { unitId });
      return;
    }
    if (pendingCompletion(db, unitId)) {
      toast("A completion approval is already pending for this engagement.");
      return;
    }
    mutate((d) => {
      d.approvals = d.approvals || [];
      d.approvals.push({
        id: uid(),
        kind: "engagement_completion",
        unitId,
        unitName: e!.name,
        requestedBy: user.id,
        requestedByName: user.name,
        requestedAt: new Date().toISOString(),
        status: "pending",
      });
    });
    logAudit("plan.completion_requested", "Requested completion approval: " + e!.name, { unitId });
    toast("Sent to the Head of Audit for approval.", "success");
  }
  function decideCompletion(approvalId: string, approve: boolean) {
    if (!isHead) {
      toast(`Only the Head of Audit can ${approve ? "approve" : "reject"}.`, "error");
      return;
    }
    let unitName = "";
    mutate((d) => {
      const a = (d.approvals || []).find((x) => x.id === approvalId);
      if (!a || a.status !== "pending") return;
      unitName = String(a.unitName || "");
      a.status = approve ? "approved" : "rejected";
      a.decidedBy = user.id;
      a.decidedByName = user.name;
      a.decidedAt = new Date().toISOString();
      if (approve) {
        const u = ensureUniverse(d).find((x) => x.id === a.unitId);
        if (u) {
          u.engStatus = "Completed";
          u.occDone = parseQuarters(u.plannedPeriod).slice();
        }
      }
    });
    logAudit(
      approve ? "plan.completion_approved" : "plan.completion_rejected",
      (approve ? "Approved" : "Rejected") + " completion: " + unitName,
      { unitId },
    );
  }

  const statusBody = complete ? (
    <>
      <span className="ra-status-text done">✓ Completed</span>{" "}
      <button className="btn ghost sm" type="button" onClick={reopen}>
        Reopen
      </button>
    </>
  ) : pend ? (
    <>
      <span className="pill ra-pending-pill">⏳ Pending Head of Audit approval</span>{" "}
      <span className="hint">
        requested by {pend.requestedByName || "a staff member"}
        {pend.requestedAt ? " · " + fmtDateTime(pend.requestedAt) : ""}
      </span>
      {isHead ? (
        <>
          {" "}
          <button className="btn sm" type="button" onClick={() => decideCompletion(pend.id, true)}>
            Approve
          </button>{" "}
          <button
            className="btn ghost sm danger"
            type="button"
            onClick={() => decideCompletion(pend.id, false)}
          >
            Reject
          </button>
        </>
      ) : null}
    </>
  ) : (
    <>
      <span className="ra-status-text">{engStatusLabel(db, e)}</span>
      {e.engStatus === "In progress" ? null : (
        <>
          {" "}
          <button className="btn ghost sm" type="button" onClick={setInProgress}>
            Mark in progress
          </button>
        </>
      )}{" "}
      <button className="btn sm" type="button" onClick={requestComplete}>
        {isHead ? "Mark completed" : "Request completion"}
      </button>
    </>
  );

  return (
    <div className="obs-detail-page anim-fade-in">
      <header className="obs-detail-hero">
        <div className="obs-detail-badges">
          <span
            className="pill"
            style={{ background: hx2rgba(RA_HEX[band], 0.16), color: RA_HEX[band] }}
          >
            {band}
          </span>
          <EngagementStatusPill unit={e} />
          {e.plannedPeriod ? <span className="tag">{e.plannedPeriod}</span> : null}
          {e.carryOverFrom ? (
            <span className="pill ra-pending-pill">
              carried over from {String(e.carryOverFrom)}
            </span>
          ) : null}
        </div>
        <h2 className="obs-detail-title">{e.name}</h2>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          {e.category || "Auditable unit"} · Annual Audit Plan {planYear(db)}
        </p>
      </header>

      <div className="ra-unit-body">
        <div className="ra-plan-detail anim-fade-in">
          <div className="watch-detail-meta">
            {(
              [
                ["Category", e.category || "—"],
                ["Owner", e.owner || "—"],
                ["Risk score", score.toFixed(2) + " · " + band],
                ["Frequency", e.frequencyOverride || raFreqLabel(band)],
                [
                  "Planned timing",
                  (e.plannedPeriod || "—") +
                    (e.carryOverFrom ? ` (carried over from ${String(e.carryOverFrom)})` : ""),
                ],
                ["Last audited", e.lastAudited || "—"],
              ] as [string, string][]
            ).map(([lab, val]) => (
              <div className="watch-meta-item" key={lab}>
                <span className="watch-meta-label">{lab}</span>
                <span className="watch-meta-value">{val}</span>
              </div>
            ))}
          </div>

          <div className="ra-factor-grid">
            {RA_FACTORS.map(([k, lab, w]) => (
              <div className="ra-factor" key={k}>
                <span className="ra-factor-lbl">
                  {lab} <span className="hint">({Math.round(w * 100)}%)</span>
                </span>
                <span className="ra-factor-val">{Number(e.factors?.[k]) || 3}/5</span>
              </div>
            ))}
          </div>

          {e.rationale ? (
            <div className="obs-detail-sections">
              <section className="obs-detail-section">
                <h4 className="obs-detail-label">Rationale</h4>
                <div className="obs-detail-content">{e.rationale}</div>
              </section>
            </div>
          ) : null}

          <div className="ra-detail-linked">
            <span className="watch-meta-label">Linked audits</span> <AuditLinks unit={e} />
          </div>

          <div className="ra-status-section">
            <div className="watch-meta-label" style={{ marginBottom: 6 }}>
              Status
            </div>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {statusBody}
            </div>
            {!isHead && !complete && !pend ? (
              <div className="hint" style={{ marginTop: 6 }}>
                Marking an engagement complete needs Head of Audit approval.
              </div>
            ) : null}
          </div>

          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button
              className="btn ghost sm"
              type="button"
              onClick={editUnit}
            >
              Edit unit &amp; timing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
