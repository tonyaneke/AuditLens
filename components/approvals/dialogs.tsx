"use client";

// Approval details dialog — React port of modalApprovalDetails/obsDetailRowsHTML in
// audit-bot.js. Renders the request header, the decision note for decided requests, a
// kind-specific body (edit diff, deletion warning, status change, withdrawal reasons or the
// full observation details) and the Approve/Reject footer for pending requests.

import type { ReactNode } from "react";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import {
  approvalItemTitle,
  approvalKindLabel,
  findApprovalObs,
  OBS_FIELD_LABELS,
} from "@/lib/workspace/approvals";
import { approvals, fmtDateTime } from "@/lib/workspace/selectors";
import type { Observation } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { useApprovalDecisions } from "./decisions";

/** Legacy obsDetailRowsHTML — every populated observation field as a .obs-field row. */
function ObsDetailRows({ o }: { o: Observation }) {
  const rows = OBS_FIELD_LABELS.filter(([k]) => {
    const v = o[k];
    return v != null && v !== "";
  });
  if (!rows.length) return <div className="hint">No details captured.</div>;
  return (
    <>
      {rows.map(([k, lab]) => (
        <div className="obs-field" key={k}>
          <div className="ttl">{lab}</div>
          <div className="txt">{String(o[k])}</div>
        </div>
      ))}
    </>
  );
}

export function ApprovalDetailsDialog({ aid }: { aid: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const { approveAny, rejectAny } = useApprovalDecisions();
  const ap = approvals(db).find((x) => x.id === aid);

  if (!ap) {
    return (
      <ModalFrame
        title="Approval"
        footer={
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
        }
      >
        <div className="hint">Request not found.</div>
      </ModalFrame>
    );
  }

  const { o } = findApprovalObs(db, ap);
  const reason = String(ap.headReason || (ap.decisionReason as string | undefined) || "");

  const head = (
    <>
      <div className="hint" style={{ marginBottom: 10 }}>
        <span className="tag">{approvalKindLabel(ap.kind)}</span> · requested by{" "}
        <b>{ap.requestedByName || "—"}</b>
        {ap.requestedAt ? " · " + fmtDateTime(ap.requestedAt) : ""}
      </div>
      {ap.status && ap.status !== "pending" ? (
        <div className="note" style={{ marginBottom: 10 }}>
          {ap.status === "approved" ? (
            <span className="pill c-Low">Approved</span>
          ) : ap.status === "rejected" ? (
            <span className="pill c-Critical">Rejected</span>
          ) : (
            <span className="pill">{ap.status}</span>
          )}{" "}
          by <b>{ap.decidedByName || "—"}</b>
          {ap.decidedAt ? " · " + fmtDateTime(ap.decidedAt) : ""}
          {reason ? (
            <div style={{ marginTop: 4 }}>
              <b>Reason:</b> {reason}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  let body: ReactNode;
  if (ap.kind === "observation_update" && ap.changes) {
    const nb = ap.changes;
    const cur = (o || {}) as Record<string, unknown>;
    const changed = OBS_FIELD_LABELS.filter(
      ([k]) => String(nb[k] == null ? "" : nb[k]) !== String(cur[k] == null ? "" : cur[k]),
    );
    body = (
      <>
        {head}
        <div className="seclabel">Proposed changes</div>
        {changed.length ? (
          changed.map(([k, lab]) => (
            <div className="obs-field" key={k}>
              <div className="ttl">{lab}</div>
              <div
                className="txt"
                style={{ color: "var(--crit)", textDecoration: "line-through", opacity: 0.75 }}
              >
                {String(cur[k] == null ? "" : cur[k]) || "—"}
              </div>
              <div className="txt" style={{ color: "#2e7d32" }}>
                {String(nb[k] == null ? "" : nb[k]) || "—"}
              </div>
            </div>
          ))
        ) : (
          <div className="hint">No effective changes versus the current observation.</div>
        )}
      </>
    );
  } else if (ap.kind === "observation_delete") {
    body = (
      <>
        {head}
        <div className="note" style={{ borderLeft: "3px solid var(--crit)" }}>
          Deletion request — approving will permanently remove this observation.
        </div>
        {o ? <ObsDetailRows o={o} /> : <div className="hint">The observation no longer exists.</div>}
      </>
    );
  } else if (ap.kind === "observation_status_change") {
    body = (
      <>
        {head}
        <div className="note">
          Status change: <b>{ap.fromStatus || "—"}</b> → <b>{ap.newStatus || "—"}</b>
        </div>
        {o ? <ObsDetailRows o={o} /> : <div className="hint">The observation no longer exists.</div>}
      </>
    );
  } else if (ap.kind === "observation_withdraw") {
    body = (
      <>
        {head}
        <div className="note" style={{ borderLeft: "3px solid var(--accent)" }}>
          <b>Action owner&#39;s reason for withdrawal</b>
          <div style={{ marginTop: 4 }}>{ap.reason || "—"}</div>
        </div>
        {ap.forwardNote ? (
          <div className="note" style={{ marginTop: 8 }}>
            <b>Internal Audit note</b>
            <div style={{ marginTop: 4 }}>{ap.forwardNote}</div>
          </div>
        ) : null}
        {o ? <ObsDetailRows o={o} /> : <div className="hint">The observation no longer exists.</div>}
      </>
    );
  } else if (o) {
    body = (
      <>
        {head}
        <ObsDetailRows o={o} />
      </>
    );
  } else {
    body = (
      <>
        {head}
        <div className="hint">{approvalItemTitle(db, ap)}</div>
      </>
    );
  }

  return (
    <ModalFrame
      title={"Approval — " + approvalItemTitle(db, ap)}
      footer={
        ap.status === "pending" ? (
          <>
            <button
              className="btn ghost danger"
              type="button"
              onClick={() => {
                modal.close();
                void rejectAny(ap.id);
              }}
            >
              Reject
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                modal.close();
                void approveAny(ap.id);
              }}
            >
              Approve
            </button>
          </>
        ) : (
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
        )
      }
    >
      {body}
    </ModalFrame>
  );
}
