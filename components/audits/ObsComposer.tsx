"use client";

/* Owner comment composer — port of the .obs-composer block inside obsRemediationHTML(), plus
   addObsUpdate() and uploadEvidenceFile(). Only action owners post free-form here; auditors and
   the Head act through the stage buttons and the Add-comment dialog on the conversation page.

   Includes the legacy quality gate on owner submissions: obvious filler is refused locally,
   anything else goes through runCommentCheck (a progress report is held to a much higher bar
   than a plain comment). Private co-owner notes are not gated. If the AI reviewer is
   unavailable the post goes through — same as legacy.

   The evidence upload uses uploadWithProgress(), which was ported in the migration but left
   with no caller — the .upload-progress CSS has been dead since. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { logAudit } from "@/lib/client/audit-log";
import { dirUser, headUsers, ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { runCommentCheck } from "@/lib/client/obs-ai";
import { effectiveRole } from "@/lib/permissions";
import { findObsIn, notify } from "@/lib/workspace/observations";
import { uid } from "@/lib/workspace/selectors";
import type { EvidenceFile, Observation, ObsUpdate } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { FilePickMulti, MAX_UPLOAD_BYTES, tooLarge, uploadAllEvidence } from "./attach";

// Legacy: obvious filler — skip the AI round-trip and refuse locally.
const TRIVIAL = [
  "ok", "okay", "noted", "done", "yes", "no", "thanks", "thank you", "fine", "good", "great",
  "sure", "received", "seen", "acknowledged", "k", "nil", "na", "n/a",
];

type GateFeedback = { heading: string; feedback: string; questions: string[] };

export default function ObsComposer({
  auditId,
  reportId,
  o,
  primary,
  progressMode,
  nextHint,
  actions,
}: {
  auditId: string;
  reportId: string;
  o: Observation;
  primary: boolean;
  progressMode: boolean;
  nextHint: string;
  actions: React.ReactNode[];
}) {
  const { mutate } = useWorkspace();
  const user = useUser();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Posting…");
  const [gate, setGate] = useState<GateFeedback | null>(null);
  const [gateErr, setGateErr] = useState("");
  // Only offered when a co-owner exists — a private note needs someone to be private to.
  const coOwnerExists = !!(o.ownerUserId && o.secondaryOwnerUserId);
  const [audience, setAudience] = useState<"ia" | "owner">("ia");

  const composerTitle = progressMode ? "Progress report" : primary ? "Your comments" : "Co-owner comment";
  const placeholder = progressMode
    ? "Describe concretely what has been done so far, the current status, what remains and by when…"
    : primary
      ? "Add a comment or progress note…"
      : "Add a comment…";

  async function post() {
    if (busy) return;
    if (!text.trim() && !files.length) {
      toast("Add a comment or attach a file.", "error");
      return;
    }
    setGate(null);
    setGateErr("");
    const toCoOwner = coOwnerExists && audience === "owner";

    /* Quality gate — legacy addObsUpdate. Only text posts to Internal Audit are gated. */
    if (text.trim() && !toCoOwner) {
      const t = text.trim().toLowerCase().replace(/[.!\s]+$/, "");
      if (!files.length && (t.length < 6 || TRIVIAL.includes(t))) {
        setGateErr(
          progressMode
            ? "A progress report needs specifics — what has been done so far, the current status, and what remains."
            : "Add a little more detail so the comment carries some information.",
        );
        return;
      }
      setBusyLabel("Checking…");
      setBusy(true);
      let verdict = null;
      try {
        verdict = await runCommentCheck(o, text.trim(), progressMode ? "progress" : "comment");
      } catch {
        verdict = null; // reviewer unavailable — let the post through, same as legacy
      }
      if (verdict && !verdict.ok) {
        setBusy(false);
        setGate({
          heading: progressMode
            ? "This progress report needs to be more concrete"
            : "Add a bit more to this comment",
          feedback:
            verdict.feedback ||
            (progressMode
              ? "State what has been done so far, the current status, and what remains."
              : "Add some detail so the comment is meaningful."),
          questions: verdict.questions,
        });
        return;
      }
    }

    setBusyLabel("Posting…");
    setBusy(true);

    const big = tooLarge(files);
    if (big) {
      setBusy(false);
      toast(`"${big.name}" exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`, "error");
      return;
    }

    let evidence: EvidenceFile[] = [];
    if (files.length) {
      try {
        evidence = await uploadAllEvidence(o.id, files);
      } catch (e) {
        setBusy(false);
        toast(e instanceof Error ? e.message : "Upload failed.", "error");
        return;
      }
    }

    const entry: ObsUpdate = {
      id: uid(),
      by: user.id || "",
      byName: user.name || "",
      role: effectiveRole(user) || "",
      at: new Date().toISOString(),
      text: text.trim(),
      evidence,
      audience: toCoOwner ? "owner" : "",
      // Legacy: a private co-owner note posted while a progress report is outstanding is
      // still just a comment — only a post to Internal Audit counts as the progress report.
      kind: progressMode && !toCoOwner ? "progress" : "comment",
    };
    const snippet = entry.text
      ? ` "${entry.text.slice(0, 140)}${entry.text.length > 140 ? "…" : ""}"`
      : "";

    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, o.id);
      if (!cur) return;
      cur.updates = cur.updates || [];
      cur.updates.push(entry);
      // Note: an outstanding "update requested" flag is cleared server-side — owners cannot
      // write updateRequestedAt, so workspace-authz derives the clear from this new entry.
      if (entry.audience === "owner") {
        // Private note between the owners — notify only the co-owner.
        const other = cur.ownerUserId === user.id ? cur.secondaryOwnerUserId : cur.ownerUserId;
        notify(d, other, "update", "Private note on: " + cur.title, "myobs", cur.id);
        const e = ownerEmailFor(d, other);
        if (e)
          emailNotify(
            [e],
            "AuditLens — note from your co-owner",
            `Your co-owner posted a private note on "${cur.title}".${snippet ? " Note:" + snippet + "." : ""} Sign in to AuditLens to view.`,
          );
      } else {
        // Owner responded to Internal Audit → the lead auditor, the auditor who raised it and
        // the Head(s) are told, in app and by email (legacy addObsUpdate fan-out).
        const a = (d.audits || []).find((x) => x.id === auditId);
        const heads = headUsers();
        const ids = [a?.leadAuditorId, cur.raisedBy, ...heads.map((h) => h.id)].filter(
          (x): x is string => !!x,
        );
        for (const id of new Set(ids))
          notify(d, id, "update", "Response from the action owner on: " + cur.title, "observation", cur.id);
        const emails = [
          dirUser(a?.leadAuditorId || "")?.email,
          dirUser(cur.raisedBy || "")?.email,
          ...heads.map((h) => h.email),
        ].filter((x): x is string => !!x);
        emailNotify(
          [...new Set(emails)],
          "AuditLens — response from the action owner",
          `The action owner${user.name ? " (" + user.name + ")" : ""} responded on the observation "${cur.title}".${snippet ? " Comment:" + snippet + "." : ""} Sign in to AuditLens to review and respond.`,
        );
      }
    });

    logAudit("obs.update", "Update posted on: " + o.title, { observationId: o.id, attachments: evidence.length });
    setText("");
    setFiles([]);
    setBusy(false);
    toast(
      evidence.length
        ? progressMode
          ? "Progress report and attachment(s) posted."
          : "Comment and attachment(s) posted."
        : progressMode
          ? "Progress report posted."
          : "Comment posted.",
      "success",
    );
  }

  return (
    <div className="obs-composer" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <div className="obs-notes-label obs-updates-label" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
        {composerTitle}
      </div>
      {nextHint ? <div className="hint" style={{ margin: "2px 0 8px" }}>{nextHint}</div> : null}

      <div className="composer-input-wrap">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          aria-label={composerTitle}
        />
      </div>

      <FilePickMulti files={files} onChange={setFiles} label="📎 Attach files" />

      <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {coOwnerExists ? (
          <select
            className="field-select field-select-sm"
            value={audience}
            onChange={(e) => setAudience(e.target.value as "ia" | "owner")}
            aria-label="Who can see this comment"
          >
            <option value="ia">Send to Internal Audit</option>
            <option value="owner">Private note to co-owner</option>
          </select>
        ) : null}
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn sm"
          type="button"
          onClick={post}
          disabled={busy || (!text.trim() && !files.length)}
        >
          {busy ? busyLabel : progressMode ? "Post progress report" : "Post comment"}
        </button>
      </div>

      {gateErr ? <div className="ai-err" style={{ marginTop: 10 }}>{gateErr}</div> : null}
      {gate ? (
        <div className="note" style={{ marginTop: 10, borderLeft: "3px solid var(--crit)" }}>
          <div style={{ fontWeight: 700, color: "var(--crit)", marginBottom: 4 }}>⚠ {gate.heading}</div>
          <div className="hint">{gate.feedback}</div>
          {gate.questions.length ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {gate.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {actions.length ? (
        <div
          className="row"
          style={{ gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line)" }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
