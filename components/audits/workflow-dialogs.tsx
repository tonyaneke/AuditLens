"use client";

/* Observation remediation workflow dialogs — ports of modalReadyForClosure /
   modalCloseObservation / modalHeadClose / modalClosureReject / modalRequestReview /
   forwardWithdrawal / declineReview / requestOwnerUpdate / requestProgressReport.

   None of these survived the first migration, which is why the observation page could only
   flip status directly — a write the server silently reverts for anyone but the Head
   (see CONTROLLED_OBS_FIELDS in lib/workspace-authz.ts).

   The rule these dialogs follow: never write a controlled field from the client. Each stage
   writes only the field its actor is permitted to set, and workspace-authz derives the rest
   (status, closedDateISO, clearing closureRejection / progressReport) on the server. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { StatusPill } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { logAudit } from "@/lib/client/audit-log";
import { dirUser, headUsers, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { extractEvidenceText, runClosureCheck, type ClosureVerdict } from "@/lib/client/obs-ai";
import { uploadWithProgress } from "@/lib/client/uploads";
import type { SessionUser } from "@/lib/permissions";
import {
  canVerifyItem,
  cancelPendingStatusChange,
  findObsIn,
  isHead,
  isOwnerViewer,
  notify,
  notifyBoth,
  notifyHeadsApproval,
  pendingStatusChange,
  stampClosed,
} from "@/lib/workspace/observations";
import { STATUSES, approvals, fmtDate, fmtDateTime, isoToDate, isoNow, uid } from "@/lib/workspace/selectors";
import type { EvidenceFile, Observation, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type Ids = { auditId: string; reportId: string; obsId: string };

/* ---- shared helpers ---- */

function useObs({ auditId, reportId, obsId }: Ids) {
  const { db, mutate } = useWorkspace();
  const o = findObsIn(db, auditId, reportId, obsId);
  /** Mutate the observation wherever it lives (audit report or external register). */
  const editObs = (fn: (o: Observation) => void) =>
    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, obsId);
      if (cur) fn(cur);
    });
  const notifyIn = (fn: (d: Parameters<Parameters<typeof mutate>[0]>[0], o: Observation) => void) =>
    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, obsId);
      if (cur) fn(d, cur);
    });
  return { db, o, editObs, notifyIn };
}

async function uploadEvidence(obsId: string, file: File | undefined): Promise<EvidenceFile | null> {
  if (!file) return null;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("obsId", obsId);
  const data = await uploadWithProgress("/api/files", fd);
  return (data.file as EvidenceFile) || null;
}

function FilePick({ onPick, label = "📎 Attach file" }: { onPick: (f: File | undefined) => void; label?: string }) {
  const [name, setName] = useState("");
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <label className="btn sec sm" style={{ display: "inline-block", margin: 0 }}>
        {label}
        <input
          type="file"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            setName(f?.name || "");
            onPick(f);
          }}
        />
      </label>
      <span className="hint">{name || "No file chosen (optional)"}</span>
    </div>
  );
}

/* ---- the shared "send it back" write ----
   Used by the Head's reject/escalate dialog and by a reviewer returning a Ready-for-Closure
   response from inside the View-remediation modal. Kept in one place so the two cannot drift:
   the milestones being unwound are preserved on the rejection so the verify stepper can show
   "↩ returned" instead of silently reverting to "Raised". */
function writeRejection(
  cur: Observation,
  target: "auditor" | "owner",
  note: string,
  user: SessionUser,
  head: boolean,
): void {
  cur.closureRejection = {
    target,
    note: note.trim(),
    byName: user.name || (head ? "Head of Audit" : "Internal Audit"),
    byRole: head ? "head_of_audit" : "audit_staff",
    at: new Date().toISOString(),
    prevOwnerRectified: cur.ownerRectifiedAt
      ? { byName: cur.ownerRectifiedByName || "", at: cur.ownerRectifiedAt }
      : undefined,
    prevReportVerified: cur.reportVerifiedAt
      ? { byName: cur.reportVerifiedByName || "", at: cur.reportVerifiedAt }
      : undefined,
  };
  if (target === "auditor") {
    cur.reportVerifiedAt = "";
    cur.reportVerifiedBy = "";
    cur.reportVerifiedByName = "";
  } else {
    cur.ownerRectifiedAt = "";
    cur.ownerRectifiedBy = "";
    cur.ownerRectifiedByName = "";
    cur.reportVerifiedAt = "";
    cur.reportVerifiedBy = "";
    cur.reportVerifiedByName = "";
  }
}

function notifyRejection(d: WorkspaceDb, cur: Observation, target: "auditor" | "owner"): void {
  if (target === "auditor") {
    notify(d, cur.raisedBy, "returned", "Returned for rework: " + cur.title, "observation", cur.id);
    return;
  }
  notify(d, cur.ownerUserId, "returned", "Sent back to your department: " + cur.title, "myobs", cur.id);
  notify(d, cur.secondaryOwnerUserId, "returned", "Sent back to your department: " + cur.title, "myobs", cur.id);
}

function ClosurePackage({ o }: { o: Observation }) {
  return (
    <>
      {o.ownerResponse ? (
        <div className="obs-field">
          <div className="ttl">Action owner&apos;s closure response</div>
          <div className="txt">
            <RichText text={o.ownerResponse} />
            {(o.ownerResponseEvidence || []).map((e) => (
              <div className="hint" style={{ marginTop: 4 }} key={e.itemId}>
                📎{" "}
                <a href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
                  {e.name}
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ================= owner: Ready for Closure ================= */

// Legacy RFC_HEADINGS — rotated so a repeatedly-rejected response doesn't read like a stuck page.
const RFC_HEADINGS = [
  "This needs more detail before it can go through",
  "Not quite there yet — add specifics",
  "Almost — make this more concrete",
  "Let's tighten this up before submitting",
  "This is a bit too vague to submit yet",
  "Add a little more substance here",
];
let rfcHeadingIdx = 0;

export function ReadyForClosureDialog({ auditId, reportId, obsId }: Ids) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [text, setText] = useState(o?.ownerResponse || "");
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Checking…");
  const [err, setErr] = useState("");
  const [verdict, setVerdict] = useState<(ClosureVerdict & { heading: string }) | null>(null);
  const [passed, setPassed] = useState(false);

  if (!o) return null;
  // DEPARTS FROM LEGACY: legacy refused anyone but the primary owner here. Co-owners now qualify.
  if (!isOwnerViewer(user, o) && !isHead(user)) {
    return (
      <ModalFrame title="Mark Ready for Closure">
        <div className="hint">Only an action owner for this observation can mark it Ready for Closure.</div>
      </ModalFrame>
    );
  }

  async function submit() {
    setErr("");
    setVerdict(null);
    setPassed(false);
    if (!text.trim()) {
      setErr("Please describe what your department did before submitting.");
      return;
    }

    /* Legacy runClosureCheck gate. Unlike the comment gate, an unavailable reviewer BLOCKS
       submission — a closure response is the one document the whole verify chain reads. */
    setBusyLabel("Checking…");
    setBusy(true);
    let v: ClosureVerdict | null = null;
    try {
      const evText = await extractEvidenceText(file);
      v = await runClosureCheck(o!, text.trim(), evText);
    } catch {
      v = null;
    }
    if (!v) {
      setBusy(false);
      setErr("The reviewer is unavailable right now. Please try again in a moment.");
      return;
    }
    if (!v.concrete) {
      setBusy(false);
      setVerdict({ ...v, heading: RFC_HEADINGS[rfcHeadingIdx % RFC_HEADINGS.length] });
      rfcHeadingIdx++;
      return;
    }
    setPassed(true);
    setBusyLabel("Submitting…");

    let ev: EvidenceFile | null = null;
    try {
      ev = await uploadEvidence(obsId, file);
    } catch (e) {
      setBusy(false);
      setPassed(false);
      setErr(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const at = new Date().toISOString();
    editObs((cur) => {
      cur.ownerResponse = text.trim();
      if (ev) cur.ownerResponseEvidence = [ev];
      cur.ownerRectifiedBy = user.id || "";
      cur.ownerRectifiedByName = user.name || "";
      // The single field that drives the whole transition — workspace-authz derives the
      // status change, clears the progress-report request and drops an owner-targeted
      // rejection from this. Writing those here would be silently reverted.
      cur.ownerRectifiedAt = at;
    });
    notifyIn((d, cur) => {
      // Route back to the auditor who raised it, plus the lead auditor and the Head(s) —
      // in app and by email (legacy finalizeReadyForClosure fan-out).
      const a = (d.audits || []).find((x) => x.id === auditId);
      const heads = headUsers();
      const ids = [cur.raisedBy, a?.leadAuditorId, ...heads.map((h) => h.id)].filter(
        (x): x is string => !!x,
      );
      for (const id of new Set(ids))
        notify(d, id, "rectified", cur.title + " is Ready for Closure — please verify", "observation", cur.id);
      const emails = [
        dirUser(cur.raisedBy || "")?.email,
        dirUser(a?.leadAuditorId || "")?.email,
        ...heads.map((h) => h.email),
      ].filter((x): x is string => !!x);
      emailNotify(
        [...new Set(emails)],
        "AuditLens — observation Ready for Closure",
        `The action owner marked "${cur.title}" as Ready for Closure. Sign in to AuditLens to review the response and verify.`,
      );
    });
    logAudit("obs.ready_for_closure", "Owner marked Ready for Closure: " + o!.title, { observationId: obsId });
    setBusy(false);
    modal.close();
    modal.success("Marked Ready for Closure and sent back to the auditor who raised it for verification.");
  }

  return (
    <ModalFrame
      title="Mark Ready for Closure"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn ai-generate-btn" type="button" onClick={submit} disabled={busy}>
            {busy ? busyLabel : "Submit"}
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <label htmlFor="rfc-text">
        Your closure response — what your department actually did to address this *
      </label>
      <textarea
        id="rfc-text"
        className="rfc-response"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Be specific: what was implemented or changed, when, and how it addresses the recommendation…"
      />
      <FilePick onPick={setFile} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
      {passed ? (
        <div className="hint" style={{ marginTop: 10, color: "var(--low)" }}>✓ Looks concrete. Submitting…</div>
      ) : null}
      {verdict ? (
        <div className="note" style={{ marginTop: 12, borderLeft: "3px solid var(--crit)" }}>
          <div style={{ fontWeight: 700, color: "var(--crit)", marginBottom: 4 }}>⚠ {verdict.heading}</div>
          <div className="hint">
            {verdict.feedback || "Add specifics: exactly what was changed, when, and how it addresses the recommendation."}
          </div>
          {verdict.questions.length ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {verdict.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
          {verdict.suggestion ? (
            <>
              <div className="hint" style={{ marginTop: 10 }}>
                <b>Suggested wording — edit it to reflect what you actually did:</b>
              </div>
              <div className="note" style={{ marginTop: 4, background: "var(--card)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                {verdict.suggestion}
              </div>
              <div style={{ marginTop: 6 }}>
                <button
                  className="btn sec sm"
                  type="button"
                  onClick={() => {
                    setText(verdict.suggestion);
                    // Without this the box just changes somewhere above the fold and the click
                    // reads as having done nothing.
                    toast("Copied into your closure response — edit it to match what you did.", "success");
                  }}
                >
                  Copy
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ================= auditor: verify remediation ================= */

export function VerifyRemediationDialog({ auditId, reportId, obsId }: Ids) {
  const { db, o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const [note, setNote] = useState(o?.closureNote || "");
  const [date, setDate] = useState(String(o?.closedDateISO || isoNow()).slice(0, 10));
  const [by, setBy] = useState(user.name || "");
  const [file, setFile] = useState<File | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* Reviewing the owner's response has two honest outcomes, so both live here rather than as
     rival buttons on the page: verify it onward for closure, or reject it back to the owner. */
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const [rejNote, setRejNote] = useState("");
  const head = isHead(user);

  if (!o) return null;
  if (!canVerifyItem(user, o, a)) {
    return (
      <ModalFrame title="View remediation">
        <div className="hint">
          Only the auditor who raised it, the lead auditor, or the Head of Audit can review this.
        </div>
      </ModalFrame>
    );
  }

  function sendBack() {
    if (!rejNote.trim()) {
      setErr("Say what needs to change before sending it back.");
      return;
    }
    editObs((cur) => writeRejection(cur, "owner", rejNote, user, head));
    notifyIn((d, cur) => notifyRejection(d, cur, "owner"));
    logAudit(
      "obs.closure_rejected",
      `${head ? "Head" : "Auditor"} rejected remediation to owner: ` + o!.title,
      { observationId: obsId },
    );
    modal.close();
    toast("Rejected and sent back to the action owner for more work.", "success");
  }

  async function submit() {
    setBusy(true);
    let ev: EvidenceFile | null = null;
    try {
      ev = await uploadEvidence(obsId, file);
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const at = new Date().toISOString();
    editObs((cur) => {
      if (ev) cur.closureFile = ev;
      cur.reportVerifiedBy = user.id || "";
      cur.reportVerifiedByName = by || user.name || "";
      cur.closureNote = note;
      // closedDateISO is a controlled field; authz accepts it only alongside this transition.
      cur.closedDateISO = date || cur.closedDateISO || isoNow();
      cur.reportVerifiedAt = at;
    });
    notifyIn((d, cur) => {
      for (const h of headUsers())
        notify(d, h.id, "verify", cur.title + " verified — ready for Head closure", "observation", cur.id);
    });
    logAudit("obs.report_verified", "Auditor verified & sent to Head: " + o!.title, { observationId: obsId });
    setBusy(false);
    modal.close();
    toast("Verified and sent to the Head of Internal Audit for closure sign-off.", "success");
  }

  const rejecting = mode === "reject";
  return (
    <ModalFrame
      title="View remediation"
      footer={
        rejecting ? (
          <>
            <button
              className="btn sec"
              type="button"
              onClick={() => {
                setMode("verify");
                setErr("");
              }}
            >
              ← Back
            </button>
            <button className="btn" type="button" onClick={sendBack}>
              Reject &amp; send back to owner
            </button>
          </>
        ) : (
          <>
            <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
            <button
              className="btn ghost danger"
              type="button"
              onClick={() => {
                setMode("reject");
                setErr("");
              }}
            >
              Reject remediation
            </button>
            <button className="btn" type="button" onClick={submit} disabled={busy}>
              {busy ? "Verifying…" : "Verify & send for closure"}
            </button>
          </>
        )
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      {o.ownerRectifiedAt ? (
        <div className="hint" style={{ marginBottom: 8 }}>
          Marked Ready for Closure by {o.ownerRectifiedByName || "the action owner"} on{" "}
          {fmtDateTime(o.ownerRectifiedAt)}.
        </div>
      ) : null}
      <ClosurePackage o={o} />

      {rejecting ? (
        <>
          <div className="hint" style={{ margin: "10px 0 8px" }}>
            This reopens the observation for the action owner. Their response above stays in the
            conversation, and they mark it Ready for Closure again once they have addressed your
            feedback.
          </div>
          <label htmlFor="co-rej">What needs to change? *</label>
          <textarea
            id="co-rej"
            style={{ minHeight: 110 }}
            value={rejNote}
            onChange={(e) => setRejNote(e.target.value)}
            placeholder="Tell the action owner what is still missing — be specific about what would make this closable…"
          />
        </>
      ) : (
        <>
          <div className="f2">
            <div>
              <label htmlFor="co-date">Closure date</label>
              <input id="co-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="co-by">Verified by</label>
              <input id="co-by" value={by} onChange={(e) => setBy(e.target.value)} />
            </div>
          </div>
          <label style={{ marginTop: 10 }}>
            Closure evidence file <span className="hint">(optional upload)</span>
          </label>
          <FilePick onPick={setFile} label="📎 Choose file" />
          <label htmlFor="co-note" style={{ marginTop: 10 }}>Closure note</label>
          <textarea id="co-note" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}

/* ================= head: approve & close ================= */

export function HeadCloseDialog({ auditId, reportId, obsId }: Ids) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [comment, setComment] = useState("");

  if (!o) return null;
  if (!isHead(user)) {
    return (
      <ModalFrame title="Close observation">
        <div className="hint">Only the Head of Audit can close an observation.</div>
      </ModalFrame>
    );
  }

  function close() {
    const at = new Date().toISOString();
    editObs((cur) => {
      cur.headVerifiedBy = user.id || "";
      cur.headVerifiedByName = user.name || "";
      cur.headVerifiedAt = at;
      if (comment.trim()) cur.headComment = comment.trim();
      cur.verifiedBy = cur.verifiedBy || cur.reportVerifiedByName || user.name || "";
      cur.closedDateISO = cur.closedDateISO || isoNow();
      // The Head is fully trusted by workspace-authz, so this is the one place status is set.
      cur.status = "Closed";
      cur.closureRejection = null;
    });
    notifyIn((d, cur) => {
      notify(d, cur.ownerUserId, "closed", cur.title + " has been closed", "myobs", cur.id);
      notify(d, cur.secondaryOwnerUserId, "closed", cur.title + " has been closed", "myobs", cur.id);
      notify(d, cur.raisedBy, "closed", cur.title + " has been closed", "observation", cur.id);
    });
    logAudit("obs.closed", "Head verified & closed: " + o!.title, { observationId: obsId });
    modal.close();
    toast("Observation verified and closed.", "success");
  }

  return (
    <ModalFrame
      title="Close observation — Head sign-off"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={close}>Approve &amp; close</button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <ClosurePackage o={o} />
      {o.reportVerifiedAt ? (
        <div className="obs-field">
          <div className="ttl">Auditor&apos;s verification &amp; closure note</div>
          <div className="txt">
            {o.closureNote ? <RichText text={o.closureNote} /> : <span className="hint">No note.</span>}
          </div>
        </div>
      ) : null}
      <div className="f2" style={{ marginTop: 4 }}>
        <div className="kv">
          <b>Closure date</b>{" "}
          {o.closedDateISO ? fmtDate(isoToDate(o.closedDateISO)) : o.reportVerifiedAt ? fmtDate(isoToDate(o.reportVerifiedAt)) : "—"}
        </div>
        <div className="kv"><b>Verified by</b> {o.reportVerifiedByName || "—"}</div>
      </div>
      <label htmlFor="hc-comment" style={{ marginTop: 10 }}>
        Additional comment <span className="hint">(optional)</span>
      </label>
      <textarea id="hc-comment" value={comment} onChange={(e) => setComment(e.target.value)}
        placeholder="Optional note to accompany the closure…" />
      <div className="hint" style={{ marginTop: 8 }}>
        You&apos;re approving the closure verified by {o.reportVerifiedByName || "Internal Audit"}.
      </div>
    </ModalFrame>
  );
}

/* ================= head: reject to auditor / escalate to owner ================= */

export function ClosureRejectDialog({ auditId, reportId, obsId, target }: Ids & { target: "auditor" | "owner" }) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const toAuditor = target === "auditor";
  const head = isHead(user);

  if (!o) return null;
  // The Head's own sign-off stage. A reviewing auditor rejects from inside the View-remediation
  // modal instead, which is the only place they see the response they are judging.
  if (!head) {
    return (
      <ModalFrame title="Return observation">
        <div className="hint">Only the Head of Audit can do this.</div>
      </ModalFrame>
    );
  }

  function submit() {
    if (!note.trim()) {
      setErr("Say what needs to change before returning it.");
      return;
    }
    editObs((cur) => writeRejection(cur, target, note, user, head));
    notifyIn((d, cur) => notifyRejection(d, cur, target));
    logAudit("obs.closure_rejected", `Head returned to ${target}: ` + o!.title, {
      observationId: obsId,
    });
    modal.close();
    toast(
      toAuditor ? "Returned to Internal Audit." : "Escalated to the action owner.",
      "success",
    );
  }

  return (
    <ModalFrame
      title={toAuditor ? "Reject to auditor" : "Escalate to action owner"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>
            {toAuditor ? "Return to auditor" : "Send back to owner"}
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <label htmlFor="cr-note">What needs to change? *</label>
      <textarea id="cr-note" value={note} onChange={(e) => setNote(e.target.value)}
        placeholder={toAuditor
          ? "Tell the auditor what to revisit before resending for closure sign-off…"
          : "Tell the action owner what still needs to be addressed…"} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}

/* ================= withdrawal / review-request flow ================= */

export function RequestReviewDialog({ auditId, reportId, obsId }: Ids) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  if (!o) return null;

  function submit() {
    if (!reason.trim()) {
      setErr("Explain why this observation should be reviewed.");
      return;
    }
    editObs((cur) => {
      cur.withdrawal = {
        stage: "owner_requested",
        ownerReason: reason.trim(),
        ownerBy: user.id || "",
        ownerByName: user.name || "",
        ownerAt: new Date().toISOString(),
      };
    });
    notifyIn((d, cur) => {
      notify(d, cur.raisedBy, "review", "Review requested on: " + cur.title, "observation", cur.id);
    });
    logAudit("obs.review_requested", "Owner requested review: " + o!.title, { observationId: obsId });
    modal.close();
    toast("Review requested — Internal Audit will consider it.", "success");
  }

  return (
    <ModalFrame
      title="Request review"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>Send request</button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <div className="hint" style={{ marginBottom: 8 }}>
        Use this when your department believes the observation is not valid. Internal Audit reviews
        the request and, if it agrees, forwards it to the Head of Audit to withdraw.
      </div>
      <label htmlFor="rr-reason">Why should this be reviewed? *</label>
      <textarea id="rr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}

export function ForwardWithdrawalDialog({ auditId, reportId, obsId }: Ids) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [note, setNote] = useState("");
  if (!o) return null;

  function submit() {
    editObs((cur) => {
      cur.withdrawal = {
        ...(cur.withdrawal || {}),
        stage: "forwarded",
        forwardNote: note.trim(),
        forwardedBy: user.id || "",
        forwardedByName: user.name || "",
        forwardedAt: new Date().toISOString(),
      };
    });
    notifyIn((d, cur) => {
      for (const h of headUsers())
        notify(d, h.id, "review", "Withdrawal awaiting your sign-off: " + cur.title, "observation", cur.id);
    });
    logAudit("obs.withdraw_forwarded", "Forwarded for withdrawal: " + o!.title, { observationId: obsId });
    modal.close();
    toast("Forwarded to the Head of Audit for withdrawal sign-off.", "success");
  }

  return (
    <ModalFrame
      title="Forward for withdrawal"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>Forward to Head</button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <div className="hint" style={{ marginBottom: 8 }}>
        Only the Head of Audit can finalise a withdrawal — the server enforces this regardless of
        what the client sends.
      </div>
      <label htmlFor="fw-note">Internal Audit note <span className="hint">(optional)</span></label>
      <textarea id="fw-note" value={note} onChange={(e) => setNote(e.target.value)} />
    </ModalFrame>
  );
}

export function DeclineReviewDialog({ auditId, reportId, obsId }: Ids) {
  const { o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  if (!o) return null;

  function submit() {
    if (!reason.trim()) {
      setErr("Give the action owner a reason.");
      return;
    }
    editObs((cur) => {
      cur.withdrawal = {
        ...(cur.withdrawal || {}),
        stage: "declined",
        declineReason: reason.trim(),
        declinedBy: user.id || "",
        declinedByName: user.name || "",
        declinedAt: new Date().toISOString(),
      };
    });
    notifyIn((d, cur) => {
      notify(d, cur.ownerUserId, "review", "Review request declined: " + cur.title, "myobs", cur.id);
      notify(d, cur.secondaryOwnerUserId, "review", "Review request declined: " + cur.title, "myobs", cur.id);
    });
    logAudit("obs.review_declined", "Declined review request: " + o!.title, { observationId: obsId });
    modal.close();
    toast("Request declined — the observation remains active.", "success");
  }

  return (
    <ModalFrame
      title="Decline review request"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>Decline request</button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}><b>{o.title}</b></div>
      <label htmlFor="dr-reason">Why is the observation still valid? *</label>
      <textarea id="dr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}

/* ================= auditor requests to the owner =================
   Legacy tracked "requested" in a session-only Set so the label reverts after a refresh and the
   request can be re-sent. Same behaviour here — component state, deliberately not persisted. */

/** Legacy requestOwnerUpdate — shared by the remediation block and the tracker's inline 🔔.
    Returns false when the observation has no assigned owner (after toasting). */
export function requestOwnerUpdateAction(
  mutate: (fn: (d: WorkspaceDb) => void) => void,
  auditId: string,
  reportId: string,
  o: Observation,
  user: SessionUser,
): boolean {
  if (!o.ownerUserId) {
    toast("This observation has no assigned action owner — assign one first.", "error");
    return false;
  }
  mutate((d) => {
    const cur = findObsIn(d, auditId, reportId, o.id);
    if (!cur) return;
    cur.updateRequestedAt = new Date().toISOString();
    cur.updateRequestedBy = user.id || "";
    notify(d, cur.ownerUserId, "update_req", "Update requested on: " + cur.title, "myobs", cur.id);
    notify(d, cur.secondaryOwnerUserId, "update_req", "Update requested on: " + cur.title, "myobs", cur.id);
    const e = ownerEmailFor(d, cur.ownerUserId);
    if (e)
      emailNotify(
        [e],
        "AuditLens — update requested",
        `The audit team requested an update on "${cur.title}". Sign in to AuditLens to respond.`,
      );
  });
  logAudit("obs.update_requested", "Requested owner update: " + o.title, { observationId: o.id });
  toast("Update requested from the action owner.", "success");
  return true;
}

export function useOwnerRequests(auditId: string, reportId: string, o: Observation) {
  const { mutate } = useWorkspace();
  const user = useUser();
  const [requested, setRequested] = useState<Set<string>>(new Set());

  function mark(key: string) {
    setRequested((cur) => new Set(cur).add(key));
  }

  function requestOwnerUpdate() {
    if (requestOwnerUpdateAction(mutate, auditId, reportId, o, user)) mark("upd");
  }

  function requestProgressReport() {
    // Same guard as requestOwnerUpdateAction: with no owner every notify() no-ops, so the
    // request would be recorded and reported as sent having reached nobody.
    if (!o.ownerUserId) {
      toast("This observation has no assigned action owner — assign one first.", "error");
      return;
    }
    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, o.id);
      if (!cur) return;
      cur.progressReport = { by: user.id || "", byName: user.name || "", at: new Date().toISOString() };
      // The primary owner is emailed as well (legacy notifyBoth); the co-owner gets the bell.
      notifyBoth(
        d,
        cur.ownerUserId,
        "update_req",
        "Progress report requested: " + cur.title,
        "myobs",
        "AuditLens — progress report requested",
        `Internal Audit requested a progress report on "${cur.title}". Sign in to AuditLens and post your progress. This stays requested until you mark it Ready for Closure.`,
        cur.id,
      );
      notify(d, cur.secondaryOwnerUserId, "update_req", "Progress report requested: " + cur.title, "myobs", cur.id);
    });
    logAudit("obs.progress_requested", "Requested progress report: " + o.title, { observationId: o.id });
    mark("prog");
    toast("Progress report requested.", "success");
  }

  return { requested, requestOwnerUpdate, requestProgressReport };
}

/* ================= status edit (tracker inline ✎) =================
   Port of modalStatusEdit/requestStatusChange: the Head applies immediately; anyone else files
   an `observation_status_change` approval — the same split the server enforces on `status`. */

export function StatusEditDialog({ auditId, reportId, obsId }: Ids) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const o = findObsIn(db, auditId, reportId, obsId);
  const [v, setV] = useState(String(o?.status || "Open"));
  if (!o) return null;
  const head = isHead(user);
  const pend = pendingStatusChange(db, obsId);

  function submit() {
    if (!o) return;
    modal.close();
    if (!(STATUSES as readonly string[]).includes(v)) return;
    if ((o.status || "Open") === v) return;
    if (head) {
      mutate((d) => {
        const cur = findObsIn(d, auditId, reportId, obsId);
        if (!cur) return;
        stampClosed(cur, v);
        cur.status = v;
        // Head applied directly — supersede any pending request for this observation.
        cancelPendingStatusChange(d, obsId, user);
        if (cur.ownerUserId)
          notifyBoth(
            d,
            cur.ownerUserId,
            "status",
            cur.title + " status is now " + v,
            "myobs",
            "AuditLens — status updated",
            `The status of "${cur.title}" is now ${v}.`,
            cur.id,
          );
      });
      logAudit("obs.status_changed", "Status → " + v + ": " + o.title, { observationId: obsId });
      toast("Status updated.", "success");
      return;
    }
    if (pendingStatusChange(db, obsId)) {
      toast("A status change for this observation is already awaiting approval.", "info");
      return;
    }
    mutate((d) => {
      approvals(d).push({
        id: uid(),
        kind: "observation_status_change",
        obsId,
        auditId,
        reportId,
        obsTitle: o.title,
        fromStatus: o.status || "Open",
        newStatus: v,
        requestedBy: user.id || "",
        requestedByName: user.name || "",
        requestedAt: new Date().toISOString(),
        status: "pending",
      });
      notifyHeadsApproval(d, o.title + " (status → " + v + ")");
    });
    logAudit("obs.status_change_requested", "Requested status → " + v + ": " + o.title, { observationId: obsId });
    toast("Status change submitted to the Head of Audit for approval.", "success");
  }

  return (
    <ModalFrame
      title="Update status"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          <button className="btn" type="button" onClick={submit}>
            {head ? "Apply" : "Request change"}
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>{o.title}</b> · current: <StatusPill status={o.status} />
      </div>
      {pend ? (
        <div className="hint" style={{ color: "#a15c00", marginBottom: 8 }}>
          ⏳ A change to <b>{String(pend.newStatus || "")}</b> is already awaiting Head approval.
        </div>
      ) : null}
      <label htmlFor="st-new">New status</label>
      <select id="st-new" value={v} onChange={(e) => setV(e.target.value)}>
        {STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <div className="hint" style={{ marginTop: 8 }}>
        {head
          ? "As Head of Audit, the change is applied immediately."
          : "Every status change requires Head of Audit approval."}
      </div>
    </ModalFrame>
  );
}
