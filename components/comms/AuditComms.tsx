"use client";

/* Audit communications on the Internal Audit side — the "Audit communications" card on an audit's
   page: whether the engagement notice has gone out (and to whom), and the information /
   clarification requests exchanged with the department. Also the pieces the portal's Audits tab
   shares: the request table and the ?request= deep link that notifications use. */

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty, RowOpen } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { ModalTORDialog } from "@/components/audits/lazy";
import { deptLabel } from "@/lib/dept-scope";
import { lastActivity, noticeIssued, requestAwaiting, requestsForAudit } from "@/lib/workspace/audit-comms";
import { fmtDate, fmtDateTime } from "@/lib/workspace/selectors";
import type { Audit, AuditRequest } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { NewRequestDialog, RequestThreadDialog } from "./lazy";
import { AwaitingPill, KindTag } from "./pills";

/* ---------------- request table (both sides) ---------------- */

export function RequestTable({
  requests,
  showDepartment,
}: {
  requests: AuditRequest[];
  showDepartment: boolean;
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
          <th scope="col">Status</th>
          <th scope="col">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {requests.map((r) => {
          const n = (r.messages || []).length;
          return (
            <tr key={r.id} className="row-link" onClick={() => open(r)}>
              <td style={{ whiteSpace: "nowrap" }}>{r.ref || "—"}</td>
              <td>
                <RowOpen onOpen={() => open(r)} label={`Open request: ${r.subject}`}>
                  <b>{r.subject}</b>
                </RowOpen>
                <div className="hint">
                  {r.raisedByName ? `Raised by ${r.raisedByName}` : ""}
                  {r.dueDate ? ` · required by ${fmtDate(r.dueDate)}` : ""}
                  {n ? ` · ${n} repl${n === 1 ? "y" : "ies"}` : ""}
                </div>
              </td>
              {showDepartment ? <td>{deptLabel(r.department)}</td> : null}
              <td>
                <KindTag r={r} />
              </td>
              <td>
                <AwaitingPill r={r} />
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(lastActivity(r))}</td>
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

/* ---------------- the card on the audit page ---------------- */

export function AuditCommsCard({ audit }: { audit: Audit }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const issued = noticeIssued(audit);
  const notice = audit.notice;
  const requests = requestsForAudit(db, audit.id);
  const waiting = requests.filter((r) => requestAwaiting(r) === "ia").length;

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <OpenRequestFromQuery />
      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Audit communications</h3>
        {waiting ? (
          <span className="status-pill progress">
            {waiting} awaiting Internal Audit
          </span>
        ) : null}
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn ghost sm" type="button" onClick={() => modal.open(<ModalTORDialog auditId={audit.id} />, { wide: true })}>
          {issued ? "Engagement notice" : "Compose engagement notice"}
        </button>
        <button
          className="btn pri sm"
          type="button"
          disabled={!issued}
          title={issued ? undefined : "Issue the engagement notice first — the department cannot see this engagement until then."}
          onClick={() =>
            modal.open(<NewRequestDialog auditId={audit.id} departments={notice?.departments || []} />)
          }
        >
          + Request information
        </button>
      </div>

      {issued && notice ? (
        <div className="obs-field">
          <div className="hint">
            Notice issued {fmtDate(notice.issuedAt)}
            {notice.issuedByName ? ` by ${notice.issuedByName}` : ""}
            {notice.revisedAt ? ` · re-issued ${fmtDate(notice.revisedAt)}` : ""} to{" "}
            <b>{notice.departments.map(deptLabel).join(", ") || "—"}</b>
          </div>
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
          No engagement notice yet. Compose it in the Terms of Reference — it is filled from this
          audit&apos;s objectives and scope. The department sees the engagement on its Audits tab,
          and can exchange requests with you, once the notice is issued.
        </p>
      )}

      {issued ? (
        requests.length ? (
          <RequestTable requests={requests} showDepartment={(notice?.departments || []).length > 1} />
        ) : (
          <Empty>
            No information or clarification requests yet.
          </Empty>
        )
      ) : null}
    </div>
  );
}
