"use client";

// Approvals inbox & history view for Head of Audit and staff.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { approvalItemTitle, approvalKindLabel } from "@/lib/workspace/approvals";
import { approvals, fmtDateTime } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { useApprovalDecisions } from "./decisions";
import { ApprovalDetailsDialog } from "./dialogs";

export default function ApprovalsPage() {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const { approveAny, rejectAny } = useApprovalDecisions();
  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const isHead = user.role === "head_of_audit";

  usePageChrome({ title: "Approvals Inbox" });

  const allList = approvals(db).slice().sort((a, b) => {
    const ta = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
    const tb = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
    return tb - ta;
  });

  const filtered = allList.filter((a) => {
    if (tab === "pending") return a.status === "pending";
    if (tab === "approved") return a.status === "approved";
    if (tab === "rejected") return a.status === "rejected";
    return true;
  });

  const pendingCount = allList.filter((a) => a.status === "pending").length;

  return (
    <div>
      <div className="tab-bar">
        <button className={`tab ${tab === "pending" ? "act" : ""}`} onClick={() => setTab("pending")}>
          Pending {pendingCount > 0 ? `(${pendingCount})` : ""}
        </button>
        <button className={`tab ${tab === "approved" ? "act" : ""}`} onClick={() => setTab("approved")}>
          Approved
        </button>
        <button className={`tab ${tab === "rejected" ? "act" : ""}`} onClick={() => setTab("rejected")}>
          Rejected
        </button>
        <button className={`tab ${tab === "all" ? "act" : ""}`} onClick={() => setTab("all")}>
          All History
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="hint">No approval requests found in this view.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="dt-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Item</th>
                <th>Requested By</th>
                <th>Requested At</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ap) => (
                <tr key={ap.id}>
                  <td>
                    <span className="tag">{approvalKindLabel(ap.kind)}</span>
                  </td>
                  <td>
                    <b>{approvalItemTitle(db, ap)}</b>
                  </td>
                  <td>{ap.requestedByName || "—"}</td>
                  <td className="meta">{ap.requestedAt ? fmtDateTime(ap.requestedAt) : "—"}</td>
                  <td>
                    {ap.status === "pending" ? (
                      <span className="pill c-High">Pending</span>
                    ) : ap.status === "approved" ? (
                      <span className="pill c-Low">Approved</span>
                    ) : ap.status === "rejected" ? (
                      <span className="pill c-Critical">Rejected</span>
                    ) : (
                      <span className="pill">{ap.status}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="btn sec sm"
                      style={{ marginRight: 6 }}
                      onClick={() => modal.open(<ApprovalDetailsDialog aid={ap.id} />)}
                    >
                      View Details
                    </button>
                    {isHead && ap.status === "pending" ? (
                      <>
                        <button className="btn pri sm" style={{ marginRight: 6 }} onClick={() => approveAny(ap.id)}>
                          Approve
                        </button>
                        <button className="btn sec sm" onClick={() => rejectAny(ap.id)}>
                          Reject
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
