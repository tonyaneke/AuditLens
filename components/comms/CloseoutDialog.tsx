"use client";

/* Issue the audit conclusion — the closing communication at the end of an engagement.

   Internal Audit picks the FINAL report it comes from and the departments it goes to. The parts of
   that report's executive summary a department is given (1.1, areas out of scope, 1.2, 1.3, 1.5 —
   never the 1.4 opinion) are shown exactly as they will be sent, and snapshotted when issued: the
   report is the one place they are edited (the executive summary's Edit / Generate), so this dialog
   only previews them. Re-issue after editing the report to send the revised summary.

   The confirmation is inline, as in NoticeComposer: modal.confirm() would unmount this dialog. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { DEPARTMENTS } from "@/components/settings/staff";
import { useDirectoryUsers } from "@/components/external/use-directory";
import { loadDirectory } from "@/lib/client/directory";
import { deptLabel } from "@/lib/dept-scope";
import {
  CLOSEOUT_SECTIONS,
  closeoutFromReport,
  commDepartmentOptions,
  engagementTitle,
  finalReports,
  notifyCloseoutIssued,
  suggestNoticeDepartments,
} from "@/lib/workspace/audit-comms";
import { fmtDate } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function CloseoutDialog({ auditId, reportId }: { auditId: string; reportId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const finals = a ? finalReports(a) : [];
  const prior = a?.closeout;
  const issued = !!prior?.issuedAt;
  const dir = useDirectoryUsers();
  const options = commDepartmentOptions(DEPARTMENTS, dir, [...(prior?.departments || []), ...(a?.notice?.departments || [])]);

  const [rid, setRid] = useState(
    () =>
      (reportId && finals.some((r) => r.id === reportId) ? reportId : "") ||
      (prior && finals.some((r) => r.id === prior.reportId) ? prior.reportId : "") ||
      (finals.length === 1 ? finals[0].id : ""),
  );
  const [depts, setDepts] = useState<string[]>(() =>
    prior?.departments?.length
      ? prior.departments
      : a?.notice?.departments?.length
        ? a.notice.departments
        : a
          ? suggestNoticeDepartments(a, options)
          : [],
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!a) {
    return (
      <ModalFrame title="Audit not found">
        <p className="hint">This audit is no longer available.</p>
      </ModalFrame>
    );
  }
  const audit = a;
  const report = finals.find((r) => r.id === rid);
  const content = report ? closeoutFromReport(report) : null;

  function toggle(d: string) {
    setConfirming(false);
    setDepts((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function askToIssue() {
    if (!content) return setErr("Choose the final report the conclusion comes from.");
    if (!content.conclusion) return setErr("This report has no 1.5 Conclusion yet — complete its executive summary first.");
    if (!depts.length) return setErr("Choose at least one department to send the conclusion to.");
    setErr("");
    setConfirming(true);
  }

  async function issue() {
    if (!content) return;
    setBusy(true);
    try {
      await loadDirectory(); // the department fan-out reads the directory
      const now = new Date().toISOString();
      mutate((d) => {
        const cur = (d.audits || []).find((x) => x.id === auditId);
        if (!cur) return;
        const again = !!cur.closeout?.issuedAt;
        cur.closeout = again && cur.closeout
          ? { ...cur.closeout, ...content, departments: depts, revisedAt: now, revisedBy: user.id, revisedByName: user.name }
          : { ...content, departments: depts, issuedAt: now, issuedBy: user.id, issuedByName: user.name };
        notifyCloseoutIssued(d, cur, depts, again);
      });
      toast(issued ? "Audit conclusion re-issued." : "Audit conclusion issued to the department.", "success");
      modal.close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalFrame
      title={issued ? "Audit conclusion" : "Issue audit conclusion"}
      footer={
        confirming ? (
          <>
            <span className="hint" style={{ flex: 1 }}>
              {issued ? "Re-issue" : "Issue"} to <b>{depts.map(deptLabel).join(", ")}</b>? Everyone in{" "}
              {depts.length === 1 ? "that department" : "those departments"} is notified in AuditLens and their
              heads by e-mail.
            </span>
            <button className="btn sec" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn pri" type="button" disabled={busy} onClick={() => void issue()}>
              {busy ? <span className="btn-spin" aria-hidden="true" /> : null}
              {issued ? "Re-issue conclusion" : "Issue conclusion"}
            </button>
          </>
        ) : (
          <>
            <button className="btn sec" type="button" onClick={modal.close}>
              Cancel
            </button>
            <button className="btn pri" type="button" disabled={!finals.length} onClick={askToIssue}>
              {issued ? "Re-issue conclusion…" : "Issue conclusion…"}
            </button>
          </>
        )
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {issued && prior
          ? `Issued ${fmtDate(prior.issuedAt)}${prior.issuedByName ? ` by ${prior.issuedByName}` : ""}${prior.revisedAt ? ` · re-issued ${fmtDate(prior.revisedAt)}` : ""} to ${prior.departments.map(deptLabel).join(", ")}. Re-issuing sends the summary below again and replaces what the department sees.`
          : `Tells the department the ${engagementTitle(audit)} has concluded and shows them the executive summary below on their Audits tab. The internal audit opinion (1.4) is not included.`}
      </p>

      {!finals.length ? (
        <div className="ai-err">
          No report in this audit is marked <b>Final</b> yet. Finalise the report (✎ Edit Report → Status: Final) once
          its executive summary is complete, then issue the conclusion.
        </div>
      ) : (
        <>
          {finals.length > 1 ? (
            <>
              <label htmlFor="co-report">From report</label>
              <select
                id="co-report"
                value={rid}
                onChange={(e) => {
                  setConfirming(false);
                  setRid(e.target.value);
                }}
              >
                <option value="">Select the final report…</option>
                {finals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                    {r.refNo ? ` (${r.refNo})` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className="obs-field">
              <div className="ttl">From report</div>
              <div>
                {finals[0].title}
                {finals[0].refNo ? ` (${finals[0].refNo})` : ""}
              </div>
            </div>
          )}

          <label style={{ marginTop: 10 }}>Send to</label>
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

          {content ? (
            <>
              <div className="ttl" style={{ fontWeight: 700, marginTop: 6 }}>
                What the department will see
              </div>
              <div className="obs-note" style={{ marginTop: 6 }}>
                {CLOSEOUT_SECTIONS.map(([k, title]) =>
                  content[k] ? (
                    <div className="obs-field" key={k}>
                      <div className="ttl">{title}</div>
                      <div className="txt">
                        <RichText text={content[k]} />
                      </div>
                    </div>
                  ) : k === "conclusion" ? (
                    <div className="obs-field" key={k}>
                      <div className="ttl">{title}</div>
                      <div className="hint">Not written yet — complete the report&apos;s executive summary first.</div>
                    </div>
                  ) : null,
                )}
              </div>
              <p className="hint">
                To change any of this, edit the report&apos;s executive summary, then come back and issue.
              </p>
            </>
          ) : null}
        </>
      )}
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}
