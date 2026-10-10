"use client";

/* Audit communications dialogs — raise a request, and the request's own thread.

   One pair of dialogs serves both sides of an engagement. Internal Audit raises INFORMATION
   requests from the audit page ("send us the Q3 disbursement listing"); the audited department
   raises CLARIFICATION requests from the portal's Audits tab ("which branches does the sample
   cover?"). Either side replies on the thread, with attachments, until it is closed. The rules
   about who may do what are lib/workspace-authz.ts reconcileAuditRequests — these dialogs only
   offer what it allows. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { Avatar } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { FilePickMulti, MAX_UPLOAD_BYTES, tooLarge, uploadAllEvidence } from "@/components/audits/attach";
import { dirUser } from "@/lib/client/directory";
import { deptLabel } from "@/lib/dept-scope";
import {
  canCloseRequest,
  nextRequestRef,
  notifyRequestActivity,
  viewerSide,
} from "@/lib/workspace/audit-comms";
import { fmtDate, fmtDateTime, uid } from "@/lib/workspace/selectors";
import type { AuditRequest, AuditSide, EvidenceFile } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { AwaitingPill, KindTag } from "./pills";

const MB =Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/* ---------------- shared bits ---------------- */

function Files({ files }: { files: EvidenceFile[] | undefined }) {
  if (!files || !files.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {files.map((e) => (
        <div className="hint" key={e.itemId}>
          📎{" "}
          <a href={`/api/files/${e.itemId}`} target="_blank" rel="noopener noreferrer">
            {e.name}
          </a>
        </div>
      ))}
    </div>
  );
}

function sideName(side: AuditSide, department: string): string {
  return side === "ia" ? "Internal Audit" : deptLabel(department) || "Department";
}

function Entry({
  by,
  byName,
  side,
  at,
  department,
  text,
  evidence,
}: {
  by: string;
  byName: string;
  side: AuditSide;
  at: string;
  department: string;
  text: string;
  evidence?: EvidenceFile[];
}) {
  const person = dirUser(by) || { name: byName };
  return (
    <div className="obs-note">
      {text ? (
        <div className="obs-note-text">
          <RichText text={text} />
        </div>
      ) : null}
      <Files files={evidence} />
      <div className="obs-note-meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Avatar user={person} size={22} />
        <span style={{ fontWeight: 700, color: "var(--accent)" }}>{byName || "—"}</span>
        <span className="tag" style={{ margin: 0 }}>{sideName(side, department)}</span>
        <span>{at ? fmtDateTime(at) : ""}</span>
      </div>
    </div>
  );
}

async function uploadOrError(folder: string, files: File[]): Promise<EvidenceFile[] | string> {
  const big = tooLarge(files);
  if (big) return `"${big.name}" exceeds the ${MB} MB limit.`;
  if (!files.length) return [];
  try {
    return await uploadAllEvidence(folder, files);
  } catch (e) {
    return e instanceof Error ? e.message : "Upload failed.";
  }
}

/* ---------------- raise a request ---------------- */

/** Internal Audit: an information request to one of the departments the notice went to.
 *  Department: a clarification request to Internal Audit, for one of their own noticed departments. */
export function NewRequestDialog({
  auditId,
  departments,
}: {
  auditId: string;
  /** The departments this request may be addressed to / raised for. */
  departments: string[];
}) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const side = viewerSide(user);
  const kind: AuditRequest["kind"] = side === "ia" ? "information" : "clarification";
  const audit = (db.audits || []).find((a) => a.id === auditId);

  const [department, setDepartment] = useState(departments.length === 1 ? departments[0] : "");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");
  const [id] = useState(() => uid());

  async function submit() {
    if (!department) return setErr("Choose the department.");
    if (!subject.trim()) return setErr("Give the request a subject.");
    if (!text.trim()) return setErr(kind === "information" ? "Describe the information you need." : "Describe what needs clarifying.");
    setErr("");
    const evidence = await uploadOrError(id, files);
    if (typeof evidence === "string") return setErr(evidence);

    mutate((d) => {
      const req: AuditRequest = {
        id,
        auditId,
        ref: nextRequestRef(d, auditId, kind),
        kind,
        department,
        subject: subject.trim(),
        text: text.trim(),
        evidence,
        dueDate: kind === "information" && dueDate ? dueDate : undefined,
        raisedBy: user.id,
        raisedByName: user.name,
        side,
        raisedAt: new Date().toISOString(),
        messages: [],
      };
      d.auditRequests = d.auditRequests || [];
      d.auditRequests.push(req);
      const a = (d.audits || []).find((x) => x.id === auditId);
      notifyRequestActivity(d, a, req, { id: user.id, side }, "raised");
    });
    modal.close();
    toast(kind === "information" ? "Information request sent to the department." : "Clarification request sent to Internal Audit.", "success");
  }

  return (
    <ModalFrame
      title={kind === "information" ? "Request information" : "Ask Internal Audit for clarification"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn pri" busyLabel={files.length ? "Uploading…" : "Sending…"} onClick={submit}>
            Send request
          </BusyButton>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {audit?.name || "Audit engagement"} —{" "}
        {kind === "information"
          ? "the department is notified and replies here with the information or documents."
          : "Internal Audit is notified and replies here."}
      </p>
      {departments.length > 1 ? (
        <>
          <label htmlFor="nr-dept">{kind === "information" ? "Department" : "On behalf of"}</label>
          <select id="nr-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Select department…</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </>
      ) : (
        <div className="obs-field">
          <div className="ttl">{kind === "information" ? "Department" : "On behalf of"}</div>
          <div>{department || "—"}</div>
        </div>
      )}
      <label htmlFor="nr-subject" style={{ marginTop: 10 }}>
        Subject
      </label>
      <input
        id="nr-subject"
        type="text"
        value={subject}
        maxLength={160}
        placeholder={kind === "information" ? "e.g. Loan disbursement listing, Q3 2026" : "e.g. Period covered by the sample"}
        onChange={(e) => setSubject(e.target.value)}
      />
      <label htmlFor="nr-text" style={{ marginTop: 10 }}>
        {kind === "information" ? "What do you need?" : "What needs clarifying?"}
      </label>
      <textarea id="nr-text" style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} />
      {kind === "information" ? (
        <>
          <label htmlFor="nr-due" style={{ marginTop: 10 }}>
            Required by <span className="hint">(optional)</span>
          </label>
          <input id="nr-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </>
      ) : null}
      <label style={{ marginTop: 10 }}>Attachments</label>
      <FilePickMulti files={files} onChange={setFiles} />
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}

/* ---------------- the thread ---------------- */

export function RequestThreadDialog({ requestId }: { requestId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const side = viewerSide(user);
  const r = (db.auditRequests || []).find((x) => x.id === requestId);
  const audit = r ? (db.audits || []).find((a) => a.id === r.auditId) : undefined;

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [err, setErr] = useState("");

  if (!r) {
    return (
      <ModalFrame title="Request not found">
        <p className="hint">This request is no longer available — it may have been withdrawn by Internal Audit.</p>
      </ModalFrame>
    );
  }
  const req = r;
  const closed = !!req.closedAt;
  const mayClose = canCloseRequest(req, side);

  async function reply() {
    const body = text.trim();
    if (!body && !files.length) return setErr("Write a reply or attach a file.");
    setErr("");
    const evidence = await uploadOrError(req.id, files);
    if (typeof evidence === "string") return setErr(evidence);
    mutate((d) => {
      const cur = (d.auditRequests || []).find((x) => x.id === req.id);
      if (!cur) return;
      cur.messages = cur.messages || [];
      cur.messages.push({
        id: uid(),
        by: user.id,
        byName: user.name,
        side,
        at: new Date().toISOString(),
        text: body,
        evidence,
      });
      const a = (d.audits || []).find((x) => x.id === cur.auditId);
      notifyRequestActivity(d, a, cur, { id: user.id, side }, "reply");
    });
    setText("");
    setFiles([]);
    toast("Reply sent.", "success");
  }

  function setClosed(close: boolean) {
    mutate((d) => {
      const cur = (d.auditRequests || []).find((x) => x.id === req.id);
      if (!cur) return;
      if (close) {
        cur.closedAt = new Date().toISOString();
        cur.closedBy = user.id;
        cur.closedByName = user.name;
      } else {
        delete cur.closedAt;
        delete cur.closedBy;
        delete cur.closedByName;
      }
      const a = (d.audits || []).find((x) => x.id === cur.auditId);
      notifyRequestActivity(d, a, cur, { id: user.id, side }, close ? "closed" : "reopened");
    });
    toast(close ? "Request closed." : "Request reopened.", "success");
  }

  return (
    <ModalFrame
      title={
        <>
          {req.ref ? `${req.ref} · ` : ""}
          {req.subject}
        </>
      }
      footer={
        <>
          {mayClose ? (
            <button className="btn ghost" type="button" onClick={() => setClosed(!closed)}>
              {closed ? "Reopen request" : "Close request"}
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn sec" type="button" onClick={modal.close}>
            Done
          </button>
          {!closed ? (
            <BusyButton
              className="btn pri"
              busyLabel={files.length ? "Uploading…" : "Sending…"}
              disabled={!text.trim() && !files.length}
              onClick={reply}
            >
              Send reply
            </BusyButton>
          ) : null}
        </>
      }
    >
      <div className="row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <KindTag r={req} />
        <AwaitingPill r={req} />
        <span className="hint">
          {audit?.name || "Audit engagement"} · {req.department}
          {req.dueDate ? ` · required by ${fmtDate(req.dueDate)}` : ""}
        </span>
      </div>

      <Entry
        by={req.raisedBy}
        byName={req.raisedByName}
        side={req.side}
        at={req.raisedAt}
        department={req.department}
        text={req.text}
        evidence={req.evidence}
      />
      {(req.messages || []).map((m) => (
        <Entry
          key={m.id}
          by={m.by}
          byName={m.byName}
          side={m.side}
          at={m.at}
          department={req.department}
          text={m.text}
          evidence={m.evidence}
        />
      ))}

      {closed ? (
        <p className="hint">
          Closed{req.closedByName ? ` by ${req.closedByName}` : ""}
          {req.closedAt ? ` on ${fmtDateTime(req.closedAt)}` : ""}.
          {mayClose ? " Reopen it to continue the conversation." : ""}
        </p>
      ) : (
        <>
          <label htmlFor="rt-reply" style={{ marginTop: 6 }}>
            Your reply
          </label>
          <textarea
            id="rt-reply"
            style={{ minHeight: 90 }}
            value={text}
            placeholder={
              side === "dept" && req.kind === "information"
                ? "Provide the information requested, or attach the documents…"
                : "Write a reply…"
            }
            onChange={(e) => setText(e.target.value)}
          />
          <FilePickMulti files={files} onChange={setFiles} />
        </>
      )}
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}
