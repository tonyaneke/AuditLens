"use client";

/* The engagement notice, composed inside the Terms of Reference.

   Prefilled with Internal Audit's standard wording and the audit programme's objectives and scope
   (noticeTemplate). Internal Audit picks the departments it goes to and issues it: everyone in
   those departments is told in AuditLens, their heads by e-mail, and the engagement appears on
   their portal's Audits tab. The text is stored as issued — a snapshot of what was communicated.

   The confirmation is inline rather than modal.confirm(): the modal stack renders only its top
   entry, so a confirm layered over the Terms of Reference would unmount it and throw away whatever
   was typed into the TOR fields. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { DEPARTMENTS } from "@/components/settings/staff";
import { loadDirectory } from "@/lib/client/directory";
import { deptLabel, normalizeDept } from "@/lib/dept-scope";
import {
  noticeTemplate,
  notifyNoticeIssued,
  programmeIsEmpty,
  suggestNoticeDepartments,
} from "@/lib/workspace/audit-comms";
import { fmtDate } from "@/lib/workspace/selectors";
import type { Audit } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function NoticeComposer({
  auditId,
  beforeIssue,
}: {
  auditId: string;
  /** Runs inside the issuing mutate — the TOR dialog writes its own fields here, so issuing the
   *  notice also keeps whatever was typed into the Terms of Reference. */
  beforeIssue?: (cur: Audit) => void;
}) {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const notice = a?.notice;
  const issued = !!notice?.issuedAt;

  // The roster, plus any department a stored notice names that the roster no longer carries.
  const options = [
    ...DEPARTMENTS,
    ...(notice?.departments || []).filter((d) => !DEPARTMENTS.some((x) => normalizeDept(x) === normalizeDept(d))),
  ];
  const [depts, setDepts] = useState<string[]>(() =>
    notice?.departments?.length ? notice.departments : a ? suggestNoticeDepartments(a, DEPARTMENTS) : [],
  );
  const [text, setText] = useState(() => notice?.text || (a ? noticeTemplate(a) : ""));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!a) return null;
  const audit = a;

  function toggle(d: string) {
    setConfirming(false);
    setDepts((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function askToIssue() {
    if (!depts.length) return setErr("Choose at least one department to send the notice to.");
    if (!text.trim()) return setErr("The notice is empty.");
    setErr("");
    setConfirming(true);
  }

  async function issue() {
    setBusy(true);
    try {
      // The department fan-out reads the directory; make sure it has loaded.
      await loadDirectory();
      const reissued = issued;
      const now = new Date().toISOString();
      mutate((d) => {
        const cur = (d.audits || []).find((x) => x.id === auditId);
        if (!cur) return;
        beforeIssue?.(cur);
        cur.notice = reissued && cur.notice
          ? { ...cur.notice, text: text.trim(), departments: depts, revisedAt: now, revisedBy: user.id, revisedByName: user.name }
          : { text: text.trim(), departments: depts, issuedAt: now, issuedBy: user.id, issuedByName: user.name };
        notifyNoticeIssued(d, cur, depts, reissued);
      });
      setConfirming(false);
      toast(reissued ? "Engagement notice re-issued." : "Engagement notice issued.", "success");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }} aria-labelledby="notice-h">
      <div className="row" style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h4 id="notice-h" style={{ margin: 0 }}>
          Engagement notice to the department
        </h4>
        {issued && notice ? (
          <span className="status-pill closed">
            Issued {fmtDate(notice.issuedAt)}
            {notice.revisedAt ? ` · re-issued ${fmtDate(notice.revisedAt)}` : ""}
          </span>
        ) : (
          <span className="status-pill draft">Not issued</span>
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        {issued
          ? `Sent to ${(notice?.departments || []).map(deptLabel).join(", ")}. Re-issuing sends the edited notice again and replaces what the department sees.`
          : "The department sees nothing of this engagement until the notice is issued. Issuing it notifies everyone in the chosen departments in AuditLens, and their heads by e-mail."}
      </p>

      <label>Send to</label>
      <div
        role="group"
        aria-label="Departments"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "4px 14px", marginBottom: 10 }}
      >
        {options.map((d) => (
          <label key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, margin: 0 }}>
            <input type="checkbox" checked={depts.includes(d)} onChange={() => toggle(d)} />
            {d}
          </label>
        ))}
      </div>

      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="notice-text" style={{ margin: 0 }}>
          Message
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn ghost sm"
          type="button"
          title="Replace the message with the standard wording and the current objectives and scope"
          onClick={() => {
            setConfirming(false);
            setText(noticeTemplate(audit));
          }}
        >
          ↺ Refill from audit programme
        </button>
      </div>
      {programmeIsEmpty(audit) ? (
        <div className="hint" style={{ margin: "4px 0" }}>
          This audit has no objectives or scope in its programme yet — generate or edit the audit plan
          first, or write them into the message below.
        </div>
      ) : null}
      <textarea
        id="notice-text"
        style={{ minHeight: 230 }}
        value={text}
        onChange={(e) => {
          setConfirming(false);
          setText(e.target.value);
        }}
      />
      {err ? <div className="ai-err">{err}</div> : null}

      {confirming ? (
        <div className="obs-note" role="alert" style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 8 }}>
            {issued ? "Re-issue" : "Issue"} the notice to <b>{depts.map(deptLabel).join(", ")}</b>? Everyone in{" "}
            {depts.length === 1 ? "that department" : "those departments"} is notified in AuditLens and their heads by
            e-mail.
          </div>
          <div className="row" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn sec sm" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn pri sm" type="button" disabled={busy} onClick={() => void issue()}>
              {busy ? <span className="btn-spin" aria-hidden="true" /> : null}
              {issued ? "Re-issue notice" : "Issue notice"}
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn pri sm" type="button" onClick={askToIssue}>
            {issued ? "Re-issue notice…" : "Issue notice…"}
          </button>
        </div>
      )}
    </section>
  );
}
