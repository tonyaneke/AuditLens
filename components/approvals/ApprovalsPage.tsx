"use client";

// Approvals inbox & history for the Head of Audit — React port of legacy viewApprovals in
// audit-bot.js (KPI row, pending queue with inline Approve/Reject, recent-decisions history,
// click-a-row for details) plus the React shell's extras: pending/approved/rejected/all tabs
// and the details dialog. Decision logic lives in ./decisions and is unchanged.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { Kpi, RowOpen } from "@/components/ui";
import { approvalItemTitle, approvalKindLabel } from "@/lib/workspace/approvals";
import { approvals, fmtDateTime } from "@/lib/workspace/selectors";
import type { Approval } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { effectiveRole } from "@/lib/permissions";
import { useApprovalDecisions } from "./decisions";
import { ApprovalDetailsDialog } from "./dialogs";

/** Decision pill — legacy uses `pill c-Low` / `pill c-Critical`; Pending only shows on the All tab. */
function DecisionPill({ status }: { status: string }) {
  if (status === "approved") return <span className="pill c-Low">Approved</span>;
  if (status === "rejected") return <span className="pill c-Critical">Rejected</span>;
  if (status === "pending") return <span className="pill c-High">Pending</span>;
  return <span className="pill">{status}</span>;
}

type Tab = "pending" | "approved" | "rejected" | "all";

export default function ApprovalsPage() {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const { approveAny, rejectAny } = useApprovalDecisions();
  const [tab, setTab] = useState<Tab>("pending");
  const isHead = effectiveRole(user) === "head_of_audit";

  usePageChrome({ title: "Approvals" });

  // Legacy sort: newest request first (ISO-string compare).
  const all = approvals(db)
    .slice()
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
  const pend = all.filter((a) => a.status === "pending");
  const approved = all.filter((a) => a.status === "approved");
  const rejected = all.filter((a) => a.status === "rejected");
  const recentDecided = all.filter((a) => a.status !== "pending").slice(0, 25);

  if (!isHead) {
    // Legacy gate — the queue is the Head of Audit's sign-off inbox.
    return (
      <div className="card">
        <div className="empty">Approvals are only available to the Head of Audit.</div>
      </div>
    );
  }

  function openDetails(ap: Approval) {
    modal.open(<ApprovalDetailsDialog aid={ap.id} />);
  }

  /** Legacy pending-queue row: Type / Item / Requested by / Requested / Decision buttons. */
  function pendingRow(ap: Approval) {
    return (
      <tr className="tracker-row" key={ap.id} title="View details" onClick={() => openDetails(ap)}>
        <td>
          <span className="tag">{approvalKindLabel(ap.kind)}</span>
        </td>
        <td>
          <RowOpen onOpen={() => openDetails(ap)} label={`View approval details: ${approvalItemTitle(db, ap)}`}>
            <b>{approvalItemTitle(db, ap)}</b>
          </RowOpen>
          {ap.newStatus ? <div className="hint">→ {ap.newStatus}</div> : null}
        </td>
        <td>{ap.requestedByName || "—"}</td>
        <td>{ap.requestedAt ? fmtDateTime(ap.requestedAt) : "—"}</td>
        <td
          style={{ textAlign: "right", whiteSpace: "nowrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="btn sm" type="button" onClick={() => void approveAny(ap.id)}>
            Approve
          </button>{" "}
          <button className="btn ghost sm danger" type="button" onClick={() => void rejectAny(ap.id)}>
            Reject
          </button>
        </td>
      </tr>
    );
  }

  /** Legacy decided-history row: Type / Item / Requested by / Decision / Decided by / When. */
  function decidedRow(ap: Approval, withRequested?: boolean) {
    return (
      <tr className="tracker-row" key={ap.id} title="View details" onClick={() => openDetails(ap)}>
        <td>
          <span className="tag">{approvalKindLabel(ap.kind)}</span>
        </td>
        <td>
          <RowOpen onOpen={() => openDetails(ap)} label={`View approval details: ${approvalItemTitle(db, ap)}`}>
            <b>{approvalItemTitle(db, ap)}</b>
          </RowOpen>
        </td>
        <td>{ap.requestedByName || "—"}</td>
        {withRequested ? <td>{ap.requestedAt ? fmtDateTime(ap.requestedAt) : "—"}</td> : null}
        <td>
          <DecisionPill status={ap.status} />
        </td>
        <td>{ap.decidedByName || "—"}</td>
        <td>{ap.decidedAt ? fmtDateTime(ap.decidedAt) : "—"}</td>
      </tr>
    );
  }

  return (
    <div>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
        <Kpi tone="warn" label="Pending" value={pend.length} sub="awaiting your decision" />
        <Kpi tone="good" label="Approved" value={approved.length} sub="signed off" />
        <Kpi tone="base" label="Rejected" value={rejected.length} sub="sent back" />
      </div>

      <div className="iasa-tabs">
        <div className="iasa-tab-group">
          {(
            [
              ["pending", pend.length ? `Pending (${pend.length})` : "Pending"],
              ["approved", "Approved"],
              ["rejected", "Rejected"],
              ["all", "All history"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={`iasa-tab${tab === key ? " active" : ""}`}
              type="button"
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "pending" ? (
        <>
          <div className="card">
            <div className="seclabel">Pending approvals</div>
            {!pend.length ? (
              <div className="empty">
                Nothing awaiting approval. Observations raised by staff, plan completions and
                status changes appear here for your sign-off.
              </div>
            ) : (
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Item</th>
                    <th scope="col">Requested by</th>
                    <th scope="col">Requested</th>
                    <th scope="col" style={{ textAlign: "right" }}>Decision</th>
                  </tr>
                </thead>
                <tbody>{pend.map((ap) => pendingRow(ap))}</tbody>
              </table>
            )}
          </div>
          {recentDecided.length ? (
            <div className="card">
              <div className="seclabel">Recent decisions</div>
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Item</th>
                    <th scope="col">Requested by</th>
                    <th scope="col">Decision</th>
                    <th scope="col">Decided by</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>{recentDecided.map((ap) => decidedRow(ap))}</tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : tab === "all" ? (
        <div className="card">
          <div className="seclabel">All requests</div>
          {!all.length ? (
            <div className="empty">No approval requests yet.</div>
          ) : (
            <table style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Item</th>
                  <th scope="col">Requested by</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Decided by</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>{all.map((ap) => decidedRow(ap, true))}</tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="seclabel">{tab === "approved" ? "Approved requests" : "Rejected requests"}</div>
          {(tab === "approved" ? approved : rejected).length === 0 ? (
            <div className="empty">
              {tab === "approved" ? "No approved requests yet." : "No rejected requests yet."}
            </div>
          ) : (
            <table style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Item</th>
                  <th scope="col">Requested by</th>
                  <th scope="col">Decision</th>
                  <th scope="col">Decided by</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>{(tab === "approved" ? approved : rejected).map((ap) => decidedRow(ap))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
