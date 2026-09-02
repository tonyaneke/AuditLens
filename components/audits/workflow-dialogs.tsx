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

import { Fragment, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { StatusPill } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { logAudit } from "@/lib/client/audit-log";
import { dirUser, headUsers, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { runAiText } from "@/lib/client/ai";
import { ConnectionLostDialog } from "@/components/modals/ConnectionLostDialog";
import { isAiUnreachable, type AiUnreachableError } from "@/lib/client/ai";
import { extractEvidenceText, runClosureCheck, type ClosureVerdict } from "@/lib/client/obs-ai";
import type { SessionUser } from "@/lib/permissions";
import {
  canActOnObs,
  canVerifyItem,
  cancelPendingStatusChange,
  findObsIn,
  internalAuditWatcherIds,
  isHead,
  notify,
  notifyBoth,
  notifyDeptOfObs,
  notifyHeadsApproval,
  pendingStatusChange,
  stampClosed,
} from "@/lib/workspace/observations";
import { STATUSES, approvals, fmtDate, fmtDateTime, isoToDate, isoNow, uid } from "@/lib/workspace/selectors";
import type { EvidenceFile, Observation, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { FilePickMulti, MAX_UPLOAD_BYTES, tooLarge, uploadAllEvidence } from "./attach";

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

/* DEPARTS FROM LEGACY: legacy re-ran the gate on every attempt, so a response the reviewer kept
   calling vague could never be submitted. The gate is now advisory after the first miss — the owner
   gets the feedback once, and the next Submit goes through as written. Module-level so closing and
   reopening the dialog doesn't reset it back to blocking.

   Settings → "Closure response check" turns that waiver off (db.strictClosureCheck): with it on,
   the check re-runs on every attempt and a response it judges vague cannot be submitted at all,
   template supplied or not. Off is the default and is the behaviour described below.

   Keyed by SUBMISSION ROUND, not by observation. Keying it on the id alone let the waiver outlive
   the response it was granted for: once an observation had been warned, every later round on it
   skipped the check too, so a response that came back from Internal Audit could be resubmitted
   with anything and go straight through on the first attempt. Both stamps below are rewritten
   when a round ends — ownerRectifiedAt when a submission lands, closureRejection.at when a
   reviewer sends it back — so a new round produces a new key and the check re-arms by itself. */
const rfcWarned = new Set<string>();

const rfcRoundKey = (o: Observation) =>
  `${o.id}|${o.ownerRectifiedAt || ""}|${o.closureRejection?.at || ""}`;

/* Splits a template into its final wording and its [fill-in gaps] so the gaps can be shown in bold.
   The stored text keeps the brackets — they are what marks a gap as still unfilled, and RichText
   renders them harmlessly downstream. */
function gapParts(text: string) {
  return text
    .split(/(\[[^\]]*\])/)
    .map((part, i) =>
      part.startsWith("[") && part.endsWith("]") ? (
        <b key={i}>{part}</b>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
}

/* The template arrives as plain text — obs-ai strips the markdown the model would otherwise emit,
   because the owner copies this straight into a plain textarea. The gaps are bolded at render time
   instead: every word around them is final wording, so the bold marks the only spots to touch. */
function TemplateText({ text }: { text: string }) {
  return <>{gapParts(text)}</>;
}

/* An unfilled gap left in the response — matched on submit, so a copied-in template cannot be sent
   to the auditor with its placeholders still in it. */
const GAP_RE = /\[[^\]]{3,}\]/g;

export function ReadyForClosureDialog({ auditId, reportId, obsId }: Ids) {
  const { db, o, editObs, notifyIn } = useObs({ auditId, reportId, obsId });
  const modal = useModal();
  const user = useUser();
  const [text, setText] = useState(o?.ownerResponse || "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Checking…");
  const [err, setErr] = useState("");
  const [verdict, setVerdict] = useState<(ClosureVerdict & { heading: string }) | null>(null);
  const [passed, setPassed] = useState(false);
  // Settings → Closure response check. Strict removes the once-per-round waiver entirely.
  const strict = !!db.strictClosureCheck;
  /* A pasted-in template runs to several spaced paragraphs, so a fixed box would hide most of it —
     and the gaps left in it — behind a scrollbar. Grow to fit whatever is in it, measured off
     scrollHeight after a reset to auto, or the box could only ever get taller. The cap is high
     enough for a full template to be on screen at once; past that the modal body scrolls. */
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 800) + "px";
  }, [text]);

  if (!o) return null;
  /* DEPARTS FROM LEGACY: legacy refused anyone but the primary owner here. Co-owners qualified
     from 2026-07-29, and the rest of the department from 2026-08-05 — the observation is raised
     against the department, so anyone in it can carry it to closure. */
  if (!canActOnObs(user, o, db) && !isHead(user)) {
    return (
      <ModalFrame title="Mark Ready for Closure">
        <div className="hint">
          Only someone in the department this observation was raised against can mark it Ready for
          Closure.
        </div>
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
    /* Not a quality judgement, so the once-per-round waiver does not cover it: an unfilled gap is a
       submission the owner has not finished. Without this, copying the template in and pressing
       Submit again would send "[date the matrix took effect, e.g. 12 June 2026]" to the auditor. */
    const gaps = text.match(GAP_RE);
    if (gaps) {
      setErr(
        `Still ${gaps.length === 1 ? "a gap" : gaps.length + " gaps"} to fill in — replace ${gaps.length === 1 ? "it" : "each of them"}, brackets and all, with your own details: ${gaps.slice(0, 3).join("  ")}${gaps.length > 3 ? " …" : ""}`,
      );
      return;
    }

    /* runClosureCheck gate — first attempt of this round only, unless the Head has turned the
       waiver off. Once the owner has been told what is missing, the rest of the round is their
       call: skip the check entirely (no AI round-trip, and an unavailable reviewer can't block
       them either). The next round re-arms it. Under `strict` the check runs every time and a
       vague response is refused however many times it is resubmitted. */
    setBusy(true);
    const round = rfcRoundKey(o!);
    if (strict || !rfcWarned.has(round)) {
      setBusyLabel("Checking…");
      let v: ClosureVerdict | null = null;
      /* The KIND of failure only picks the wording. Any failure to reach a verdict is shown as
         the modal: the owner has just watched a 20-second spinner on a Submit button, and a line
         of red text under the box is too easy to miss for something that stopped their
         submission dead. The old inline "reviewer is unavailable" message is gone — it named an
         internal component the owner cannot do anything about, when the action they need is the
         same either way: try again. */
      let failure: AiUnreachableError | null = null;
      try {
        const evText = await extractEvidenceText(files);
        v = await runClosureCheck(o!, text.trim(), evText);
      } catch (e) {
        v = null;
        if (isAiUnreachable(e)) failure = e;
      }
      if (!v) {
        setBusy(false);
        modal.open(
          <ConnectionLostDialog
            kind={failure?.kind || "connection"}
            detail="Your response has not been submitted — nothing was sent to Internal Audit."
            onRetry={() => void submit()}
          />,
        );
        return;
      }
      if (!v.concrete) {
        setBusy(false);
        // Strict: no waiver is granted, so the next attempt is checked again from scratch.
        if (!strict) rfcWarned.add(round);
        setVerdict({ ...v, heading: RFC_HEADINGS[rfcHeadingIdx % RFC_HEADINGS.length] });
        rfcHeadingIdx++;
        return;
      }
    }
    setPassed(true);
    setBusyLabel("Submitting…");

    const big = tooLarge(files);
    if (big) {
      setBusy(false);
      setPassed(false);
      setErr(`"${big.name}" exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`);
      return;
    }

    let evs: EvidenceFile[] = [];
    try {
      evs = await uploadAllEvidence(obsId, files);
    } catch (e) {
      setBusy(false);
      setPassed(false);
      setErr(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const at = new Date().toISOString();
    editObs((cur) => {
      cur.ownerResponse = text.trim();
      if (evs.length) cur.ownerResponseEvidence = evs;
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
      for (const id of internalAuditWatcherIds(cur.raisedBy, a?.leadAuditorId))
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
        ref={taRef}
        className="rfc-response"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Be specific: what was implemented or changed, when, and how it addresses the recommendation…"
      />
      <FilePickMulti files={files} onChange={setFiles} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
      {passed ? (
        <div className="hint" style={{ marginTop: 10, color: "var(--low)" }}>
          {!strict && rfcWarned.has(rfcRoundKey(o)) ? "Submitting…" : "✓ Looks concrete. Submitting…"}
        </div>
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
                <b>Ready-to-send wording — keep it as it is and just replace the highlighted gaps:</b>
              </div>
              <div className="note" style={{ marginTop: 4, background: "var(--card)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                <TemplateText text={verdict.suggestion} />
              </div>
              <div style={{ marginTop: 6 }}>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => {
                    setText(verdict.suggestion);
                    // Without this the box just changes somewhere above the fold and the click
                    // reads as having done nothing.
                    toast("Copied in word for word — now replace each [bracket] with your details.", "success");
                  }}
                >
                  Use this template
                </button>
              </div>
            </>
          ) : null}
          {verdict.tips.length ? (
            <>
              <div className="hint" style={{ marginTop: 10 }}>
                <b>Things to note while filling it in:</b>
              </div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
                {verdict.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          ) : null}
          {/* Say which rule is in force, so the owner isn't left guessing whether pressing Submit
              again will work. */}
          <div className="hint" style={{ marginTop: 10, fontSize: 12.5 }}>
            {strict
              ? "Internal Audit requires this check to pass before a response can be submitted — revise the response above and submit again."
              : "You have had this feedback once, so pressing Submit again will send the response as it stands. It will go to your auditor, who can still send it back."}
          </div>
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
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* Reviewing the owner's response has two honest outcomes, so both live here rather than as
     rival buttons on the page: verify it onward for closure, or reject it back to the owner. */
  const [mode, setMode] = useState<"verify" | "reject">("verify");
  const [rejNote, setRejNote] = useState("");
  const [noteErr, setNoteErr] = useState("");
  const head = isHead(user);

  /* Draft the verification note from what is already on the record — the finding, the owner's
     response and the evidence they attached. This note is the auditor's statement that the
     remediation was tested and found effective, and it is quoted in the closure pack, so the
     draft deliberately sticks to what the record supports and leaves a gap for the auditor to
     say what they actually checked, rather than inventing an assurance nobody gave. */
  async function generateNote() {
    if (!o) return;
    setNoteErr("");
    const ev = (o.ownerResponseEvidence || []).map((f) => f.name).filter(Boolean).join(", ");
    const prompt = `Act as an internal auditor at ${db.org} writing the verification and closure note for an audit observation whose remediation you have just reviewed. Write 2-4 sentences, first person plural ("we"), plain professional English.

State what was implemented by the department, and that Internal Audit reviewed the response and supporting evidence. Do NOT invent specific tests, sample sizes, dates or documents that are not listed below — where the evidence is thin, say what was reviewed rather than overstating it. Do not restate the original finding at length. Return ONLY the note as plain text.

Observation: ${o.title}
What was found: ${o.description || "-"}
Risk: ${o.risk || "-"}
Auditor recommendation: ${o.recommendation || "-"}
Management response: ${o.managementResponse || "-"}
Action owner's closure response: ${o.ownerResponse || "-"}
Evidence attached: ${ev || "none listed"}`;
    try {
      setNote((await runAiText(prompt)).trim());
    } catch (e) {
      setNoteErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  if (!o) return null;
  if (!canVerifyItem(user, o, a)) {
    return (
      <ModalFrame title="View remediation">
        <div className="hint">
          Only Internal Audit can review and verify remediation on this item.
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
    setErr("");
    const big = tooLarge(files);
    if (big) {
      setBusy(false);
      setErr(`"${big.name}" exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`);
      return;
    }
    let evs: EvidenceFile[] = [];
    try {
      evs = await uploadAllEvidence(obsId, files);
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : "Upload failed.");
      return;
    }
    const at = new Date().toISOString();
    editObs((cur) => {
      if (evs.length) {
        cur.closureFiles = evs;
        cur.closureFile = evs[0] ?? null;
      }
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
            {/* QA-18 — BusyButton blocks a second activation while the first is in flight. */}
            <BusyButton className="btn" busyLabel="Sending…" onClick={sendBack}>
              Reject &amp; send back to owner
            </BusyButton>
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
            Closure evidence files <span className="hint">(optional uploads)</span>
          </label>
          <FilePickMulti files={files} onChange={setFiles} label="📎 Choose files" />
          <label htmlFor="co-note" style={{ marginTop: 10 }}>
            Closure note{" "}
            <BusyButton
              className="btn sec sm ai-generate-btn"
              style={{ marginLeft: 6 }}
              busyLabel="Generating…"
              onClick={generateNote}
            >
              Generate
            </BusyButton>
          </label>
          <textarea id="co-note" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} />
          {noteErr ? <div className="ai-err" style={{ marginTop: 6 }}>{noteErr}</div> : null}
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
      // Closure is department news: whoever in the department did the work — named owner or not —
      // sees that Internal Audit has signed it off.
      notifyDeptOfObs(d, cur, "closed", cur.title + " has been closed");
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
          {/* QA-18 — closing an observation twice would double-post its closure entries. */}
          <BusyButton className="btn" busyLabel="Closing…" onClick={close}>Approve &amp; close</BusyButton>
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
          <BusyButton className="btn" busyLabel="Sending…" onClick={submit}>
            {toAuditor ? "Return to auditor" : "Send back to owner"}
          </BusyButton>
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
          <BusyButton className="btn" busyLabel="Sending…" onClick={submit}>Send request</BusyButton>
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
          <BusyButton className="btn" busyLabel="Forwarding…" onClick={submit}>Forward to Head</BusyButton>
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
          <BusyButton className="btn" busyLabel="Declining…" onClick={submit}>Decline request</BusyButton>
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
          <BusyButton className="btn" busyLabel="Saving…" onClick={submit}>
            {head ? "Apply" : "Request change"}
          </BusyButton>
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
