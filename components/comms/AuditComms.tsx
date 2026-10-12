"use client";

/* Audit communications on the Internal Audit side — the "Audit communications" card on an audit's
   page: whether the engagement notice (start) and the audit conclusion (end) have gone out, and to
   whom, and the information / clarification requests exchanged with the department. Also the
   pieces the portal's Audits tab shares: the request table, the conclusion as the department sees
   it, and the ?request= deep link that notifications use. */

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty, RowOpen } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { ModalTORDialog } from "@/components/audits/lazy";
import { deptLabel } from "@/lib/dept-scope";
import {
  CLOSEOUT_SECTIONS,
  closeoutIssued,
  engagementDepartments,
  finalReports,
  lastActivity,
  noticeIssued,
  outstandingUpdateRequest,
  requestAwaiting,
  requestsForAudit,
} from "@/lib/workspace/audit-comms";
import { fmtDate, fmtDateTime } from "@/lib/workspace/selectors";
import type { Audit, AuditCloseout, AuditRequest, AuditSide } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { CloseoutDialog, NewRequestDialog, RequestThreadDialog } from "./lazy";
import { KindTag } from "./pills";

/* ---------------- request table (both sides) ----------------
   No status column: what matters is that a response came in, and from whom — the bell and the
   e-mail say so, and "Last activity" shows who wrote last and when. A closed thread is marked in its
   subtitle. What IS flagged is the one thing the viewer must act on: a thread waiting on THEIR side
   (`side`) lights up and says "Awaiting your response" — the department's when Internal Audit has
   asked for something, Internal Audit's when the department has answered or commented. */

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
  const open = (r: AuditRequest) => modal.open(<RequestThreadDialog requestId={r.id} />, { wide: true });
  return (
    <table style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th scope="col">Ref</th>
          <th scope="col">Subject</th>
          {showDepartment ? <th scope="col">Department</th> : null}
          <th scope="col">Type</th>
          <th scope="col">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => {
          const msgs = r.messages || [];
          const n = msgs.length;
          const lastBy = n ? msgs[n - 1].byName : r.raisedByName;
          const yours = !!side && requestAwaiting(r) === side;
          const chased = outstandingUpdateRequest(r);
          return (
            <tr key={r.id} className={`row-link${yours ? " req-awaiting" : ""}`} onClick={() => open(r)}>
              <td style={{ whiteSpace: "nowrap" }}>{r.ref || "—"}</td>
              <td>
                <RowOpen onOpen={() => open(r)} label={`Open ${r.kind === "information" ? "request" : "comment"}: ${r.subject}`}>
                  <b>{r.subject}</b>
                </RowOpen>
                {yours ? (
                  <span className="pill pill-await" style={{ marginLeft: 8 }}>
                    {chased ? "🔔 Update requested" : "Awaiting your response"}
                  </span>
                ) : null}
                <div className="hint">
                  {r.raisedByName ? `Raised by ${r.raisedByName}` : ""}
                  {r.dueDate ? ` · required by ${fmtDate(r.dueDate)}` : ""}
                  {n ? ` · ${n} repl${n === 1 ? "y" : "ies"}` : ""}
                  {r.closedAt ? " · closed" : ""}
                  {chased && !yours ? ` · 🔔 update requested ${fmtDate(chased.at)}` : ""}
                </div>
              </td>
              {showDepartment ? <td>{deptLabel(r.department)}</td> : null}
              <td>
                <KindTag r={r} />
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
            <div className="ttl">{title}</div>
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
            {waiting} awaiting your response
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
          the engagement on its Audits tab, and can exchange requests with you, once it is issued.
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
          /* Lit up while the department is waiting on Internal Audit — a response or a comment to
             answer — so it reads as the part of the page that needs doing. */
          <div id="ia-requests" className={waiting ? "req-active" : undefined}>
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
