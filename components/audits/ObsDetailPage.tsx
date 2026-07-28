"use client";

// Observation detail page (/audits/[audit]/reports/[report]/observations/[obs]) —
// React port of renderObs, comments, closure workflow, and SOP update link from audit-bot.js.

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { logAudit } from "@/lib/client/audit-log";
import {
  canVerifyItem,
  isHead,
  isPrimaryOwner,
  obsUpdates,
} from "@/lib/workspace/observations";
import { effectiveRole } from "@/lib/permissions";
import { ck, fmtDate, fmtDateTime, isoToDate } from "@/lib/workspace/selectors";
import type { ObsUpdate } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { ModalReassignObsDialog } from "./lazy";

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

  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const o = r && (r.observations || []).find((x) => x.id === obsId);

  const [commentText, setCommentText] = useState("");
  const [commentAudience, setCommentAudience] = useState<"" | "owner" | "ia_only">("");
  const [closureNote, setClosureNote] = useState("");
  const [closureEvidence, setClosureEvidence] = useState("");

  const canVerify = canVerifyItem(user, o ?? undefined, a ?? undefined);
  const isOwner = isPrimaryOwner(user, o ?? undefined);

  usePageChrome({
    title: o?.title || "Observation Detail",
    actions: (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={a && r ? `/audits/${a.id}/reports/${r.id}` : "/audits"} className="btn sec sm">
          ← Back to Report
        </Link>
        {a && r && o ? (
          <Link href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}/sop`} className="btn sec sm">
            SOP Update
          </Link>
        ) : null}
        {a && r && o && (isHead(user) || canVerify) ? (
          // Legacy modalReassignObs — Head of Audit, lead auditor, or the auditor who raised it.
          <button
            className="btn sec sm"
            onClick={() => modal.open(<ModalReassignObsDialog auditId={a.id} reportId={r.id} obsId={o.id} />)}
          >
            Reassign owner
          </button>
        ) : null}
        {isOwner && o && o.status !== "Closed" ? (
          <button className="btn pri sm" onClick={handleReadyForClosure}>
            Mark Ready for Closure
          </button>
        ) : null}
        {canVerify && o && o.status !== "Closed" ? (
          <button className="btn pri sm" onClick={openCloseDialog}>
            Verify &amp; Close
          </button>
        ) : null}
      </div>
    ),
  });

  if (!a || !r || !o) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Observation not found</h3>
        <p className="hint">The requested observation could not be found.</p>
        <Link href={a && r ? `/audits/${a.id}/reports/${r.id}` : "/audits"} className="btn sec" style={{ marginTop: 16 }}>
          ← Back
        </Link>
      </div>
    );
  }

  const updates = obsUpdates(o);

  function addComment() {
    if (!commentText.trim()) return;
    const newUpd: ObsUpdate = {
      id: "upd_" + Date.now(),
      by: user.id || "",
      byName: user.name || "User",
      role: effectiveRole(user) || "",
      at: new Date().toISOString(),
      text: commentText.trim(),
      evidence: [],
      audience: commentAudience || undefined,
    };
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      const curO = curR && (curR.observations || []).find((x) => x.id === obsId);
      if (curO) {
        curO.updates = curO.updates || [];
        curO.updates.push(newUpd);
      }
    });
    logAudit("obs.comment_added", "Added comment on: " + o!.title);
    setCommentText("");
    toast("Comment added", "success");
  }

  function handleReadyForClosure() {
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      const curO = curR && (curR.observations || []).find((x) => x.id === obsId);
      if (curO) {
        curO.status = "In Progress";
        curO.ownerRectifiedAt = new Date().toISOString();
        curO.ownerRectifiedByName = user.name || "";
      }
    });
    logAudit("obs.ready_for_closure", "Marked ready for closure: " + o!.title);
    toast("Marked Ready for Closure and submitted for audit verification", "success");
  }

  function handleCloseObservation() {
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      const curO = curR && (curR.observations || []).find((x) => x.id === obsId);
      if (curO) {
        curO.status = "Closed";
        curO.closedDateISO = new Date().toISOString();
        curO.verifiedBy = user.name || "";
        curO.closureNote = closureNote || String(curO.closureNote || "");
        curO.closureEvidence = closureEvidence || String(curO.closureEvidence || "");
      }
    });
    logAudit("obs.closed", "Closed observation: " + o!.title);
    toast("Observation closed", "success");
    modal.close();
  }

  function openCloseDialog() {
    modal.open(
      <ModalFrame
        title="Verify &amp; Close Observation"
        footer={
          <>
            <button className="btn sec" onClick={modal.close}>
              Cancel
            </button>
            <button className="btn pri" onClick={handleCloseObservation}>
              Confirm Closure
            </button>
          </>
        }
      >
        <label>Closure Note / Sign-off Remarks</label>
        <textarea
          rows={3}
          placeholder="Detail verification steps and evidence relied upon..."
          value={closureNote}
          onChange={(e) => setClosureNote(e.target.value)}
        />
        <label style={{ marginTop: 10 }}>Closure Evidence Summary</label>
        <input
          type="text"
          placeholder="e.g. Document reference / ticket number"
          value={closureEvidence}
          onChange={(e) => setClosureEvidence(e.target.value)}
        />
      </ModalFrame>,
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <span className={`pill ${ck(o.criticality)}`}>{o.criticality} Rating</span>
          <span className={`pill ${o.status === "Closed" ? "c-Low" : o.status === "In Progress" ? "c-Medium" : "c-High"}`}>
            Status: {o.status || "Open"}
          </span>
          {o.category ? <span className="tag">Category: {String(o.category)}</span> : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
          <div>
            <div className="ttl">Action Owner</div>
            <div>{o.owner ? String(o.owner) : "Unassigned"}</div>
          </div>
          <div>
            <div className="ttl">Timeline</div>
            <div>{o.timeline ? String(o.timeline) : "Not specified"}</div>
          </div>
          <div>
            <div className="ttl">Due Date</div>
            <div>{o.dueDate ? String(o.dueDate) : "Not specified"}</div>
          </div>
          {o.closedDateISO ? (
            <div>
              <div className="ttl">Closed Date</div>
              <div>{fmtDate(isoToDate(String(o.closedDateISO)))}</div>
            </div>
          ) : null}
        </div>

        {o.description ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Detailed Description</div>
            <div className="txt"><RichText text={o.description} /></div>
          </div>
        ) : null}

        {o.criteria ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Criteria / Policy Expectation</div>
            <div className="txt"><RichText text={o.criteria} /></div>
          </div>
        ) : null}

        {o.risk ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Risk / Impact</div>
            <div className="txt"><RichText text={o.risk} /></div>
          </div>
        ) : null}

        {o.rootCause ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Root Cause</div>
            <div className="txt"><RichText text={o.rootCause} /></div>
          </div>
        ) : null}

        {o.recommendation ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Recommendation</div>
            <div className="txt"><RichText text={o.recommendation} /></div>
          </div>
        ) : null}

        {o.managementResponse ? (
          <div style={{ marginBottom: 16 }}>
            <div className="ttl">Management Response</div>
            <div className="txt"><RichText text={o.managementResponse} /></div>
          </div>
        ) : null}
      </div>

      {/* Comments & Updates Section */}
      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>Activity &amp; Comments ({updates.length})</h3>

        {updates.length === 0 ? (
          <div className="hint" style={{ marginBottom: 16 }}>
            No comments or progress updates posted yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
            {updates.map((u) => (
              <div key={u.id} className="note" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <b>{u.byName || "User"}</b>
                  <span className="meta">{u.at ? fmtDateTime(u.at) : ""}</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{u.text}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <label>Add a comment or progress update</label>
          <textarea
            rows={3}
            placeholder="Type comment or update..."
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <select
              value={commentAudience}
              onChange={(e) => setCommentAudience(e.target.value as "" | "owner" | "ia_only")}
              style={{ width: 180 }}
            >
              <option value="">Public Comment</option>
              <option value="owner">Owner Note (private)</option>
              <option value="ia_only">Internal Audit Only</option>
            </select>
            <button className="btn pri sm" onClick={addComment}>
              Post Comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
