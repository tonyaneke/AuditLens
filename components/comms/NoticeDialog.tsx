"use client";

/* The Terms of Reference (TOR) — and the engagement notice issued from it.

   It stays the Terms of Reference to the people using it (the audit page's "📄 Terms of Reference"
   button, this dialog's title); what changed is that saving it is how the notice goes out. The TOR
   and the notice used to be two things in one dialog — a TOR form with its own Save, and a notice
   composer below it with its own Issue. They are one communication, so "Save & issue notice" saves
   the TOR and sends the notice together, and the TOR's "Addressed to" IS the list of departments
   the notice goes to.

   Most of it fills itself (see "terms of reference: what fills itself" in lib/workspace/audit-comms):
   the departments from the audit's Process / Department, the planned timing from the audit's
   quarter, the background from the annual plan's rationale, the reporting channel from the house
   default, and — with "Draft with AI" — the background, out-of-scope areas and information needed.
   The auditor reviews and saves.

     not issued   Save draft             keeps everything, sends nothing; the department sees nothing
                  Save & issue notice    saves the TOR and issues the notice to the departments addressed
     issued       Save changes           updates the TOR the department already sees, notifying no one
                  Save & re-issue notice sends the (edited) notice again, to the departments now addressed

   Confirmation is inline, not modal.confirm(): the modal stack renders only its top entry, so a
   confirm layered over this dialog would unmount it and lose what was typed. */

import { useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { useDirectoryUsers } from "@/components/external/use-directory";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal, useModalGuard } from "@/components/modals/ModalProvider";
import { DEPARTMENTS } from "@/components/settings/staff";
import { runAiJson } from "@/lib/client/ai";
import { loadDirectory } from "@/lib/client/directory";
import { exportTORWord } from "@/lib/client/word";
import { deptLabel, normalizeDept } from "@/lib/dept-scope";
import {
  DEFAULT_REPORTING_TO,
  addressedToLine,
  commDepartmentOptions,
  defaultBackground,
  formatTiming,
  noticeTemplate,
  notifyNoticeIssued,
  parseTorDraft,
  programmeIsEmpty,
  quarterRange,
  suggestNoticeDepartments,
  torDraftPrompt,
} from "@/lib/workspace/audit-comms";
import { fmtDate, isoNow } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const sameDepts = (x: string[], y: string[]) =>
  x.length === y.length && x.every((d) => y.some((e) => normalizeDept(e) === normalizeDept(d)));

export default function NoticeDialog({ auditId }: { auditId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const dir = useDirectoryUsers();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const tor = (a?.tor || {}) as Record<string, string | undefined>;
  const notice = a?.notice;
  const issued = !!notice?.issuedAt;
  const quarter = quarterRange(a?.period);
  // A TOR written before the dates existed has its timing as free text; it is shown, not guessed at.
  const legacyTiming = !tor.timingFrom && !tor.timingTo ? tor.timing || "" : "";

  const options = commDepartmentOptions(DEPARTMENTS, dir, notice?.departments || []);
  const [depts, setDepts] = useState<string[]>(() =>
    notice?.departments?.length ? notice.departments : a ? suggestNoticeDepartments(a, options) : [],
  );
  const [date, setDate] = useState(tor.date || isoNow());
  const [from, setFrom] = useState(tor.timingFrom || (legacyTiming ? "" : quarter?.from || ""));
  const [to, setTo] = useState(tor.timingTo || (legacyTiming ? "" : quarter?.to || ""));
  const [background, setBackground] = useState(() => tor.background || (a ? defaultBackground(db, a) : ""));
  const [outOfScope, setOutOfScope] = useState(tor.outOfScope || "");
  const [infoRequired, setInfoRequired] = useState(tor.infoRequired || "");
  const [reportingTo, setReportingTo] = useState(tor.reportingTo || DEFAULT_REPORTING_TO);
  const [text, setText] = useState(() => notice?.text || (a ? noticeTemplate(a) : ""));
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Any edit invalidates a pending confirmation — what is confirmed must be what is sent.
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setTouched(true);
    setConfirming(false);
  };

  function torFields(addressed: string[]) {
    return {
      addressee: addressedToLine(addressed) || tor.addressee || "",
      date,
      timingFrom: from,
      timingTo: to,
      timing: formatTiming(from, to) || legacyTiming,
      background: background.trim(),
      outOfScope: outOfScope.trim(),
      infoRequired: infoRequired.trim(),
      reportingTo: reportingTo.trim(),
    };
  }

  function check(forIssue: boolean): boolean {
    if (from && to && from > to) return fail("The planned timing ends before it starts.");
    if (forIssue && !depts.length) return fail("Choose the department(s) the notice is addressed to.");
    if (forIssue && !text.trim()) return fail("The message to the department is empty.");
    setErr("");
    return true;
  }
  function fail(m: string): false {
    setErr(m);
    return false;
  }

  /** Save without sending: the whole draft before issue; only the TOR after it. `close` is false
   *  when the unsaved-changes prompt calls it — that prompt closes the dialog itself. */
  function save(close = true) {
    if (!check(false)) return;
    mutate((d) => {
      const cur = (d.audits || []).find((x) => x.id === auditId);
      if (!cur) return;
      if (cur.notice?.issuedAt) {
        // Addressed to stays what was issued until a re-issue sends it somewhere new.
        cur.tor = torFields(cur.notice.departments);
      } else {
        cur.tor = torFields(depts);
        cur.notice = { text: text.trim(), departments: depts };
      }
    });
    setTouched(false);
    toast(issued ? "Terms of Reference updated." : "Terms of Reference saved as a draft — the notice has not been sent.", "success");
    if (close) modal.close();
  }

  async function issue() {
    setBusy(true);
    try {
      await loadDirectory(); // the department fan-out reads the directory
      const now = new Date().toISOString();
      mutate((d) => {
        const cur = (d.audits || []).find((x) => x.id === auditId);
        if (!cur) return;
        const again = !!cur.notice?.issuedAt;
        cur.tor = torFields(depts);
        cur.notice =
          again && cur.notice
            ? { ...cur.notice, text: text.trim(), departments: depts, revisedAt: now, revisedBy: user.id, revisedByName: user.name }
            : { text: text.trim(), departments: depts, issuedAt: now, issuedBy: user.id, issuedByName: user.name };
        notifyNoticeIssued(d, cur, depts, again);
      });
      setTouched(false);
      toast(`Notice ${issued ? "re-issued" : "issued"} to ${depts.map(deptLabel).join(", ")}.`, "success");
      modal.close();
    } finally {
      setBusy(false);
    }
  }

  async function draftWithAi() {
    if (!a) return;
    setErr("");
    try {
      const d = parseTorDraft(await runAiJson<unknown>(torDraftPrompt(db, a)));
      if (!d) return void setErr("The AI returned nothing usable — try again, or write these yourself.");
      if (d.background) setBackground(d.background);
      if (d.outOfScope) setOutOfScope(d.outOfScope);
      if (d.infoRequired) setInfoRequired(d.infoRequired);
      setTouched(true);
      setConfirming(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  useModalGuard({
    dirty: touched,
    message: "You have unsaved changes to the Terms of Reference.",
    saveDraft: () => save(false),
  });

  if (!a) {
    return (
      <ModalFrame title="Audit not found">
        <p className="hint">This audit is no longer available.</p>
      </ModalFrame>
    );
  }
  const audit = a;
  const unsentChange = issued && !!notice && (text.trim() !== notice.text || !sameDepts(depts, notice.departments));

  return (
    <ModalFrame
      title="Terms of Reference (TOR)"
      footer={
        confirming ? (
          <>
            <span className="hint" style={{ flex: 1 }}>
              Save the Terms of Reference and {issued ? "re-issue" : "issue"} the notice to{" "}
              <b>{depts.map(deptLabel).join(", ")}</b>? Everyone in{" "}
              {depts.length === 1 ? "that department" : "those departments"} is notified in AuditLens and their heads by
              e-mail.
            </span>
            <button className="btn sec" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className="btn pri" type="button" disabled={busy} onClick={() => void issue()}>
              {busy ? <span className="btn-spin" aria-hidden="true" /> : null}
              {issued ? "Save & re-issue notice" : "Save & issue notice"}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn sec"
              type="button"
              title="The Terms of Reference as filled in here, as a Word document"
              onClick={() => exportTORWord(db, { ...audit, tor: torFields(depts) })}
            >
              ⤓ Export TOR (Word)
            </button>
            <div className="spacer" style={{ flex: 1 }} />
            {unsentChange ? (
              <span className="hint" style={{ maxWidth: 260 }}>
                The new departments or message are only sent when you re-issue.
              </span>
            ) : null}
            <button className="btn sec" type="button" onClick={() => save()}>
              {issued ? "Save changes" : "Save draft"}
            </button>
            <button className="btn pri" type="button" onClick={() => check(true) && setConfirming(true)}>
              {issued ? "Save & re-issue notice…" : "Save & issue notice…"}
            </button>
          </>
        )
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {issued && notice ? (
          <>
            <span className="status-pill closed" style={{ marginRight: 6 }}>
              Issued {fmtDate(notice.issuedAt)}
              {notice.revisedAt ? ` · re-issued ${fmtDate(notice.revisedAt)}` : ""}
            </span>
            Sent to {notice.departments.map(deptLabel).join(", ")}. They see these Terms of Reference on their Audits
            tab; saving changes updates what they see without notifying them again.
          </>
        ) : (
          <>
            <span className="status-pill draft" style={{ marginRight: 6 }}>
              Not issued
            </span>
            The department sees nothing of this engagement until the notice is issued.
          </>
        )}
      </p>

      <label>Addressed to</label>
      <div className="hint" style={{ marginBottom: 6 }}>
        The department(s) being audited. Everyone in them is notified in AuditLens; their heads by e-mail.
      </div>
      <div
        role="group"
        aria-label="Addressed to"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "4px 14px", marginBottom: 12 }}
      >
        {options.map((d) => (
          <label key={d} style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, margin: 0 }}>
            <input
              type="checkbox"
              checked={depts.some((x) => normalizeDept(x) === normalizeDept(d))}
              onChange={() =>
                edit(setDepts)(
                  depts.some((x) => normalizeDept(x) === normalizeDept(d))
                    ? depts.filter((x) => normalizeDept(x) !== normalizeDept(d))
                    : [...depts, d],
                )
              }
            />
            {d}
          </label>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div>
          <label htmlFor="tor-date">Date</label>
          <input id="tor-date" type="date" value={date} onChange={(e) => edit(setDate)(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tor-from">Planned timing — from</label>
          <input id="tor-from" type="date" value={from} onChange={(e) => edit(setFrom)(e.target.value)} />
        </div>
        <div>
          <label htmlFor="tor-to">to</label>
          <input id="tor-to" type="date" value={to} min={from || undefined} onChange={(e) => edit(setTo)(e.target.value)} />
        </div>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        {audit.period ? `Audit period: ${audit.period}${quarter ? ` (${formatTiming(quarter.from, quarter.to)})` : ""}. ` : ""}
        {legacyTiming ? `Previously entered as “${legacyTiming}” — set the dates to replace it.` : "Narrow it to the fieldwork dates."}
      </div>

      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <label htmlFor="tor-bg" style={{ margin: 0 }}>
          Background &amp; purpose
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <BusyButton
          className="btn ghost sm ai-generate-btn"
          busyLabel="Drafting…"
          title="Draft the background, out-of-scope areas and information required from this audit's plan"
          onClick={draftWithAi}
        >
          ✦ Draft with AI
        </BusyButton>
      </div>
      <textarea id="tor-bg" rows={4} value={background} onChange={(e) => edit(setBackground)(e.target.value)} />

      <label htmlFor="tor-oos" style={{ marginTop: 10 }}>
        Out of scope areas <span className="hint">(one per line)</span>
      </label>
      <textarea id="tor-oos" rows={3} value={outOfScope} onChange={(e) => edit(setOutOfScope)(e.target.value)} />

      <label htmlFor="tor-info" style={{ marginTop: 10 }}>
        Information &amp; access required <span className="hint">(one per line)</span>
      </label>
      <textarea id="tor-info" rows={3} value={infoRequired} onChange={(e) => edit(setInfoRequired)(e.target.value)} />

      <label htmlFor="tor-rep" style={{ marginTop: 10 }}>
        Final report distributed to <span className="hint">(reporting channel)</span>
      </label>
      <input id="tor-rep" type="text" value={reportingTo} onChange={(e) => edit(setReportingTo)(e.target.value)} />
      <div className="hint" style={{ marginTop: 4 }}>
        Who receives the final audit report. The TOR&apos;s Reporting section reads: “Observations will be discussed
        with the process owners… and the final report distributed to {reportingTo.trim() || "…"}.”
      </div>

      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <label htmlFor="notice-text" style={{ margin: 0 }}>
          E-mail to the department
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn ghost sm"
          type="button"
          title="Replace the message with Internal Audit's standard wording"
          onClick={() => edit(setText)(noticeTemplate(audit))}
        >
          ↺ Standard wording
        </button>
      </div>
      <div className="hint" style={{ margin: "4px 0" }}>
        Kept short on purpose — the department reads the objectives, scope and the rest of these Terms of Reference
        on their AuditLens dashboard, which the e-mail&apos;s button opens.
        {programmeIsEmpty(audit) ? " This audit has no objectives or scope yet — generate the audit plan first." : ""}
      </div>
      <textarea id="notice-text" style={{ minHeight: 130 }} value={text} onChange={(e) => edit(setText)(e.target.value)} />

      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}
