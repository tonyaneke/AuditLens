"use client";

/* The full conversation thread — port of the `obsCommentsOpen` branch of renderObservation()
   and obsCommentRowHTML(). Legacy replaced the observation detail with this view; here it is a
   route so it is linkable and the back button works.

   The two things the first migration lost and this restores: closure-stage entries appear in
   the thread (via obsThread), and entries are audience-filtered so private co-owner notes never
   reach Internal Audit and IA-only notes never reach an action owner. */

import { useMemo, useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { Avatar, BackButton } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { logAudit } from "@/lib/client/audit-log";
import { dirUser, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { effectiveRole } from "@/lib/permissions";
import {
  OBS_COMMENT_TAGS,
  findObsIn,
  isOwnerViewer,
  notify,
  obsCommentTag,
  obsThread,
  roleLabel,
  type ThreadEntry,
} from "@/lib/workspace/observations";
import { fmtDateTime, uid } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const TYPE_TAG: Record<string, string> = {
  Feedback: "feedback",
  "Progress reports": "progress",
  Closure: "closure",
  "Closure updates": "closure_update",
  "Private notes": "private",
};

function CommentRow({ u }: { u: ThreadEntry }) {
  const tag = OBS_COMMENT_TAGS[obsCommentTag(u)] || OBS_COMMENT_TAGS.feedback;
  // Closure-stage entries carry only a name, so fall back to name lookup for the avatar.
  const person = (u.by ? dirUser(u.by) : undefined) || { name: u.byName || "" };
  return (
    <div className={`obs-note${u.audience === "owner" ? " obs-note-private" : ""}`}>
      <div className="obs-note-text">
        <RichText text={u.text || ""} />
      </div>
      {(u.evidence || []).map((e) => (
        <div className="hint" key={e.itemId}>
          📎{" "}
          <a href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
            {e.name}
          </a>
        </div>
      ))}
      <div
        className="obs-note-meta"
        style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--accent)" }}
      >
        <Avatar user={person} size={22} />
        <span>
          {u.byName || ""}
          {u.role ? ` (${roleLabel(u.role)})` : ""}
          {u.at ? " · " + fmtDateTime(u.at) : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span className="pill" style={{ background: tag[1], color: tag[2] }}>{tag[0]}</span>
      </div>
    </div>
  );
}

/* Auditor / Head add a comment from here; owners post from the composer on the detail page. */
function AuditorCommentDialog({ auditId, reportId, obsId }: { auditId: string; reportId: string; obsId: string }) {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  function post() {
    if (!text.trim()) {
      setErr("Write a comment first.");
      return;
    }
    const body = text.trim();
    const snippet = ` "${body.slice(0, 140)}${body.length > 140 ? "…" : ""}"`;
    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, obsId);
      if (!cur) return;
      cur.updates = cur.updates || [];
      cur.updates.push({
        id: uid(),
        by: user.id || "",
        byName: user.name || "",
        role: effectiveRole(user) || "",
        at: new Date().toISOString(),
        text: body,
        evidence: [],
        audience: "",
      });
      // Legacy addObsUpdate: both owners are told in app AND by email.
      notify(d, cur.ownerUserId, "update", "New comment on: " + cur.title, "myobs", cur.id);
      notify(d, cur.secondaryOwnerUserId, "update", "New comment on: " + cur.title, "myobs", cur.id);
      const emails = [ownerEmailFor(d, cur.ownerUserId), ownerEmailFor(d, cur.secondaryOwnerUserId)].filter(Boolean);
      emailNotify(
        [...new Set(emails)],
        "AuditLens — new comment on your observation",
        `Internal Audit${user.name ? " (" + user.name + ")" : ""} posted a comment on the observation "${cur.title}" raised against your department.${snippet ? " Comment:" + snippet + "." : ""} Sign in to AuditLens to respond.`,
      );
    });
    logAudit("obs.update", "Comment posted", { observationId: obsId });
    modal.close();
    toast("Comment sent.", "success");
  }

  return (
    <ModalFrame
      title="Add comment"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={post}>Post comment</button>
        </>
      }
    >
      <label htmlFor="ac-text">Comment for the action owner *</label>
      <textarea id="ac-text" style={{ minHeight: 110 }} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment on this observation…" />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}

export default function ObsComments({
  auditId,
  reportId,
  obsId,
  backHref,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
  backHref: string;
}) {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const o = findObsIn(db, auditId, reportId, obsId);
  const ownerViewer = isOwnerViewer(user, o ?? undefined);

  const [type, setType] = useState("All");
  const [by, setBy] = useState("All");
  const [order, setOrder] = useState("Newest first");

  const visible = useMemo(() => (o ? obsThread(o, ownerViewer) : []), [o, ownerViewer]);

  usePageChrome({ title: "Comments", back: <BackButton href={backHref} /> });

  if (!o) {
    return <div className="card"><div className="empty">Observation not found.</div></div>;
  }

  const authors = [...new Set(visible.map((u) => u.byName).filter(Boolean))] as string[];
  const types = ["All", "Feedback", "Progress reports", "Closure", "Closure updates"].concat(
    ownerViewer ? ["Private notes"] : [],
  );

  let rows = visible.filter((u) => type === "All" || obsCommentTag(u) === TYPE_TAG[type]);
  if (by !== "All") rows = rows.filter((u) => u.byName === by);
  if (order === "Oldest first") rows = rows.slice().reverse();
  const filtersActive = type !== "All" || by !== "All";

  return (
    <div className="anim-fade-in">
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span className="hint">
          {rows.length} of {visible.length} comment{visible.length === 1 ? "" : "s"}
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        {filtersActive ? (
          <button className="btn ghost sm" type="button" onClick={() => { setType("All"); setBy("All"); }}>
            Clear
          </button>
        ) : null}
        <div className="filter-group">
          <span className="filter-label" id="cf-type">Type</span>
          <select className="field-select field-select-sm" aria-labelledby="cf-type"
            value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label" id="cf-by">Posted by</span>
          <select className="field-select field-select-sm" aria-labelledby="cf-by"
            value={by} onChange={(e) => setBy(e.target.value)}>
            {["All", ...authors].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label" id="cf-order">Order</span>
          <select className="field-select field-select-sm" aria-labelledby="cf-order"
            value={order} onChange={(e) => setOrder(e.target.value)}>
            {["Newest first", "Oldest first"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {rows.length ? (
        rows.map((u, i) => <CommentRow key={u.id || `${u.tag}-${i}`} u={u} />)
      ) : (
        <div className="hint">{visible.length ? "No comments match the current filters." : "No comments yet."}</div>
      )}

      {!ownerViewer ? (
        <button
          className="btn"
          type="button"
          style={{ position: "fixed", bottom: 28, right: 36, zIndex: 40, boxShadow: "0 6px 18px rgba(13,90,71,.35)", padding: "12px 22px", fontSize: 14 }}
          onClick={() => modal.open(<AuditorCommentDialog auditId={auditId} reportId={reportId} obsId={obsId} />)}
        >
          ＋ Add comment
        </button>
      ) : null}
    </div>
  );
}
