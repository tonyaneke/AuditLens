"use client";

/* Internal Audit's "add comment" on an observation — the auditor-side counterpart of the action
   owner's ObsComposer.

   It used to live inside ObsComments.tsx and post `evidence: []` unconditionally: an auditor could
   write a comment but could not attach anything to it, so supporting documents for an observation
   (the working paper, the extract, the policy page) had no home unless an action owner uploaded
   them. Attachments are the reason this moved out into its own module — the observation detail
   page needs the same dialog, and the comments page is not always reachable from there.

   Nothing on the server needed changing to allow this: `updates` is neither a CONTROLLED_OBS_FIELD
   nor an AUDITOR_ONLY_OBS_FIELD, so audit staff have always been permitted to append to the
   thread — the UI simply never offered the file input. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { logAudit } from "@/lib/client/audit-log";
import { ownerEmailFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { effectiveRole } from "@/lib/permissions";
import { findObsIn, notify } from "@/lib/workspace/observations";
import { uid } from "@/lib/workspace/selectors";
import type { EvidenceFile } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { FilePickMulti, MAX_UPLOAD_BYTES, tooLarge, uploadAllEvidence } from "./attach";

export default function AuditorCommentDialog({
  auditId,
  reportId,
  obsId,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
}) {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");

  async function post() {
    const body = text.trim();
    /* A file on its own is a legitimate post — "here is the evidence I referred to" needs no
       covering note. Only the empty-and-empty case is refused. */
    if (!body && !files.length) {
      setErr("Write a comment or attach a file.");
      return;
    }
    const big = tooLarge(files);
    if (big) {
      setErr(`"${big.name}" exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`);
      return;
    }
    setErr("");

    let evidence: EvidenceFile[] = [];
    if (files.length) {
      try {
        evidence = await uploadAllEvidence(obsId, files);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Upload failed.");
        return;
      }
    }

    const snippet = body ? ` "${body.slice(0, 140)}${body.length > 140 ? "…" : ""}"` : "";
    const attachNote = evidence.length
      ? ` ${evidence.length} document${evidence.length === 1 ? "" : "s"} attached.`
      : "";

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
        evidence,
        audience: "",
      });
      // Legacy addObsUpdate: both owners are told in app AND by email.
      notify(d, cur.ownerUserId, "update", "New comment on: " + cur.title, "myobs", cur.id);
      notify(d, cur.secondaryOwnerUserId, "update", "New comment on: " + cur.title, "myobs", cur.id);
      const emails = [ownerEmailFor(d, cur.ownerUserId), ownerEmailFor(d, cur.secondaryOwnerUserId)].filter(Boolean);
      emailNotify(
        [...new Set(emails)],
        "AuditLens — new comment on your observation",
        `Internal Audit${user.name ? " (" + user.name + ")" : ""} posted a comment on the observation "${cur.title}" raised against your department.${snippet ? " Comment:" + snippet + "." : ""}${attachNote} Sign in to AuditLens to respond.`,
      );
    });
    logAudit("obs.update", "Comment posted", { observationId: obsId, attachments: evidence.length });
    modal.close();
    toast(evidence.length ? "Comment and attachment(s) posted." : "Comment sent.", "success");
  }

  return (
    <ModalFrame
      title="Add comment"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>Cancel</button>
          {/* QA-18 — a plain button here meant a second click before the modal unmounted posted
              the comment twice AND sent the action owner a second email. */}
          <BusyButton
            className="btn"
            busyLabel={files.length ? "Uploading…" : "Posting…"}
            disabled={!text.trim() && !files.length}
            onClick={post}
          >
            Post comment
          </BusyButton>
        </>
      }
    >
      <label htmlFor="ac-text">Comment for the action owner</label>
      <textarea id="ac-text" style={{ minHeight: 110 }} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment on this observation…" />
      <label style={{ marginTop: 10 }}>Supporting documents</label>
      <div className="hint">
        Attach the working papers, extracts or correspondence behind this observation. The action
        owner sees them in the conversation.
      </div>
      <FilePickMulti files={files} onChange={setFiles} />
      {err ? <div className="ai-err" style={{ marginTop: 10 }}>{err}</div> : null}
    </ModalFrame>
  );
}
