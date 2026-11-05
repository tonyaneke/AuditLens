"use client";

/* Audit communications on the Internal Audit side — the "Audit communications" card on an audit's
   page: whether the engagement notice (start) and the audit conclusion (end) have gone out, and to
   whom, and the information / clarification requests exchanged with the department. Also the
   pieces the portal's Audits tab shares: the request table, the conclusion as the department sees
   it, and the ?request= deep link that notifications use. */

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty, RowOpen } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { ModalTORDialog } from "@/components/audits/lazy";
import { deptLabel } from "@/lib/dept-scope";
import {
  CLOSEOUT_SECTIONS,
  closeoutIssued,
  closeoutSectionTag,
  engagementDepartments,
  finalReports,
  lastActivity,
  noticeIssued,
  outstandingUpdateRequest,
  requestAwaiting,
  requestOverdue,
  requestsForAudit,
  unreadRepliesByRequest,
} from "@/lib/workspace/audit-comms";
import { fmtDate, fmtDateTime } from "@/lib/workspace/selectors";
import type { Audit, AuditCloseout, AuditRequest, AuditSide } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { CloseoutDialog, NewRequestDialog, RequestThreadDialog } from "./lazy";
import { KindTag } from "./pills";

/* ---------------- request table (both sides) ----------------
   A Status column says where each thread stands, so what is closed and what is left reads at a
   glance: Closed is green (its row too), anything still open is yellow "Awaiting". A thread waiting
   on the viewer's side (`side`) says "Awaiting you" in dark orange — the department's when Internal
   Audit has asked for something, Internal Audit's when the department has answered or commented.
   Replies the viewer has not opened yet are counted in a green badge by the subject. That badge and
   the status are the whole signal: no tinted row or table for open threads (the user's call — they
   made the table read orange). The due date has its own column, with a red "Overdue" under it once
   an open request is past it. */

function RequestStatus({ r, side }: { r: AuditRequest; side?: AuditSide }) {
  const awaiting = requestAwaiting(r);
  if (awaiting === "closed") {
    return (
      <>
        <span className="status-pill closed">Closed</span>
        {r.closedAt ? <div className="hint">{fmtDate(r.closedAt)}</div> : null}
      </>
    );
  }
  if (side && awaiting === side) {
    return (
      <span className="status-pill awaiting-you">
        {outstandingUpdateRequest(r) ? "🔔 Update requested" : "Awaiting you"}
      </span>
    );
  }
  return <span className="status-pill awaiting">Awaiting</span>;
}

/** Local YYYY-MM-DD, to compare with a request's due date (stored the same way). */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RequestTable({
  requests,
  showDepartment,
  side,
}: {
  requests: AuditRequest[];
  showDepartment: boolean;
  /** Which side is looking: its threads that are waiting on it are highlighted. */
  side?: AuditSide;
}) {
  const modal = useModal();
  const { db } = useWorkspace();
  const user = useUser();
  const fresh = unreadRepliesByRequest(db, user.id);
  const today = todayYmd();
  const open = (r: AuditRequest) => modal.open(<RequestThreadDialog requestId={r.id} />, { wide: true });
  return (
    <table style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th scope="col">Ref</th>
          <th scope="col">Subject</th>
          {showDepartment ? <th scope="col">Department</th> : null}
          <th scope="col">Type</th>
          <th scope="col">Due date</th>
          <th scope="col">Status</th>
          <th scope="col">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => {
          const msgs = r.messages || [];
          const n = msgs.length;
          const lastBy = n ? msgs[n - 1].byName : r.raisedByName;
          const awaiting = requestAwaiting(r);
          const yours = !!side && awaiting === side;
          const chased = outstandingUpdateRequest(r);
          const rowState = awaiting === "closed" ? " req-closed" : "";
          const newReplies = fresh.get(r.id) || 0;
          const overdue = requestOverdue(r, today);
          return (
            <tr key={r.id} className={`row-link${rowState}`} onClick={() => open(r)}>
              <td style={{ whiteSpace: "nowrap" }}>{r.ref || "—"}</td>
              <td>
                <RowOpen onOpen={() => open(r)} label={`Open ${r.kind === "information" ? "request" : "comment"}: ${r.subject}`}>
                  <b>{r.subject}</b>
                </RowOpen>
                {newReplies ? (
                  <span className="req-new" title={`${newReplies} new repl${newReplies === 1 ? "y" : "ies"}`}>
                    {newReplies}
                    <span className="visually-hidden"> new repl{newReplies === 1 ? "y" : "ies"}</span>
                  </span>
                ) : null}
                <div className="hint">
                  {r.raisedByName ? `Raised by ${r.raisedByName}` : ""}
                  {chased && !yours ? ` · 🔔 update requested ${fmtDate(chased.at)}` : ""}
                </div>
              </td>
              {showDepartment ? <td>{deptLabel(r.department)}</td> : null}
              <td>
                <KindTag r={r} />
              </td>
              <td style={{ whiteSpace: "nowrap" }} className={overdue ? "req-overdue" : undefined}>
                {r.dueDate ? fmtDate(r.dueDate) : "—"}
                {overdue ? <div className="hint">Overdue</div> : null}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <RequestStatus r={r} side={side} />
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {fmtDateTime(lastActivity(r))}
                {lastBy ? <div className="hint">by {lastBy}</div> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------- ?request=<id> deep link ----------------
   Notifications and e-mails link to the page with ?request=<id>; this opens that request's thread
   once the workspace has loaded, then drops the parameter so a refresh or Back does not reopen it.
   Wrapped in its own Suspense because useSearchParams needs one in production builds (Next 16). */

function OpenRequestFromQueryInner() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const modal = useModal();
  const { ready } = useWorkspace();
  const opened = useRef("");
  const rid = search.get("request") || "";

  useEffect(() => {
    if (!rid) {
      opened.current = ""; // the same request can be deep-linked again later
      return;
    }
    if (!ready || opened.current === rid) return;
    opened.current = rid;
    modal.open(<RequestThreadDialog requestId={rid} />, { wide: true });
    router.replace(pathname, { scroll: false });
  }, [rid, ready, modal, router, pathname]);

  return null;
}

export function OpenRequestFromQuery() {
  return (
    <Suspense fallback={null}>
      <OpenRequestFromQueryInner />
    </Suspense>
  );
}

/* ---------------- the conclusion as the department sees it ---------------- */

export function CloseoutView({ closeout }: { closeout: AuditCloseout }) {
  return (
    <div className="obs-note">
      {CLOSEOUT_SECTIONS.map(([k, title]) =>
        closeout[k] ? (
          <div className="obs-field" key={k}>
            <div className="ttl">
              {title} {closeoutSectionTag(closeout, k) ? <span className="tag">{closeoutSectionTag(closeout, k)}</span> : null}
            </div>
            <div className="txt">
              <RichText text={closeout[k]} />
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** "Issued 3 Oct 2026 by Sade · re-issued 9 Oct 2026 to Credit, Finance" */
function issuedLine(
  what: string,
  c: { issuedAt?: string; issuedByName?: string; revisedAt?: string; departments: string[] },
) {
  return (
    <>
      {what} issued {fmtDate(c.issuedAt)}
      {c.issuedByName ? ` by ${c.issuedByName}` : ""}
      {c.revisedAt ? ` · re-issued ${fmtDate(c.revisedAt)}` : ""} to{" "}
      <b>{c.departments.map(deptLabel).join(", ") || "—"}</b>
    </>
  );
}

/* ---------------- the card on the audit page ---------------- */

export function AuditCommsCard({ audit }: { audit: Audit }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const issued = noticeIssued(audit);
  const concluded = closeoutIssued(audit);
  const notice = audit.notice;
  const closeout = audit.closeout;
  // Requests can run once the department knows about the engagement, by either communication.
  const depts = engagementDepartments(audit);
  const communicated = depts.length > 0;
  const hasFinal = finalReports(audit).length > 0;
  const requests = requestsForAudit(db, audit.id);
  const waiting = requests.filter((r) => requestAwaiting(r) === "ia").length;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <OpenRequestFromQuery />
      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Audit communications</h3>
        {concluded ? <span className="status-pill closed">Concluded</span> : null}
        {waiting ? (
          <a className="pill pill-await" href="#ia-requests" title="Jump to the requests waiting on Internal Audit">
            {waiting} awaiting you
          </a>
        ) : null}
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm" type="button" onClick={() => modal.open(<ModalTORDialog auditId={audit.id} />, { wide: true })}>
          Terms of Reference
        </button>
        <button
          className="btn ghost sm"
          type="button"
          title={hasFinal ? undefined : "Available once a report in this audit is marked Final."}
          onClick={() => modal.open(<CloseoutDialog auditId={audit.id} />, { wide: true })}
        >
          {concluded ? "Audit conclusion" : "Issue audit conclusion"}
        </button>
        <button
          className="btn pri sm"
          type="button"
          disabled={!communicated}
          title={communicated ? undefined : "Issue the notice from the Terms of Reference first — the department cannot see this engagement until then."}
          onClick={() => modal.open(<NewRequestDialog auditId={audit.id} departments={depts} />)}
        >
          + Request information
        </button>
      </div>

      {issued && notice ? (
        <div className="obs-field">
          <div className="hint">{issuedLine("Notice", notice)}</div>
          <details style={{ marginTop: 6 }}>
            <summary className="hint" style={{ cursor: "pointer" }}>
              View the notice as sent
            </summary>
            <div className="obs-note" style={{ marginTop: 6 }}>
              <div className="obs-note-text">
                <RichText text={notice.text} />
              </div>
            </div>
          </details>
        </div>
      ) : (
        <p className="hint" style={{ marginBottom: 0 }}>
          No notice yet. Open the <b>Terms of Reference</b> — it is filled from this audit&apos;s plan —
          choose the department it is addressed to, and save it to issue the notice. The department sees
          the engagement on its Audit Reports tab, and can exchange requests with you, once it is issued.
        </p>
      )}

      {concluded && closeout ? (
        <div className="obs-field">
          <div className="hint">
            {issuedLine("Conclusion", closeout)} — from <i>{closeout.reportTitle}</i>
          </div>
          <details style={{ marginTop: 6 }}>
            <summary className="hint" style={{ cursor: "pointer" }}>
              View the conclusion as sent
            </summary>
            <div style={{ marginTop: 6 }}>
              <CloseoutView closeout={closeout} />
            </div>
          </details>
        </div>
      ) : issued && hasFinal ? (
        <p className="hint" style={{ marginBottom: 0 }}>
          A report is Final — issue the audit conclusion to give the department its executive summary
          (objective &amp; scope, areas out of scope, strengths, areas for strategic improvement and
          the conclusion).
        </p>
      ) : null}

      {communicated ? (
        requests.length ? (
          <div id="ia-requests">
            <RequestTable requests={requests} showDepartment={depts.length > 1} side="ia" />
          </div>
        ) : (
          <Empty>
            No information requests or comments yet.
          </Empty>
        )
      ) : null}
    </div>
  );
}
