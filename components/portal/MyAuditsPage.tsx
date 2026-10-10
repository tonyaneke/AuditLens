"use client";

/* Action-owner portal — Audits. The engagements Internal Audit has issued a notice for to this
   person's department(s): what is being audited, the objectives and scope as the notice states
   them, the terms-of-reference details the department needs (timing, what information and access
   will be required), and the information / clarification requests exchanged with the audit team.

   The department sees an engagement only once its notice is issued (lib/audit-comms-scope.ts), and
   never the test programme — the server sends the notice-level view only (noticeOnlyAudit). */

import type { ReactNode } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { OpenRequestFromQuery, RequestTable } from "@/components/comms/AuditComms";
import { NewRequestDialog } from "@/components/comms/lazy";
import { deptLabel } from "@/lib/dept-scope";
import {
  auditTypeLabel,
  myNoticedDepartments,
  portalAudits,
  portalRequests,
  requestAwaiting,
} from "@/lib/workspace/audit-comms";
import { fmtDate } from "@/lib/workspace/selectors";
import type { Audit } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="ttl">{label}</div>
      <div>{children || "—"}</div>
    </div>
  );
}

function EngagementCard({ a }: { a: Audit }) {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const notice = a.notice!;
  const requests = portalRequests(db, user, a.id);
  const mine = myNoticedDepartments(db, a, user);
  const waiting = requests.filter((r) => requestAwaiting(r) === "dept").length;
  const tor = a.tor || {};

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{a.name}</h3>
        <span className="tag">{auditTypeLabel(a)}</span>
        {a.status === "Completed" ? <span className="status-pill closed">Completed</span> : null}
        {waiting ? (
          <span className="status-pill open">
            {waiting} request{waiting === 1 ? "" : "s"} awaiting your department
          </span>
        ) : null}
      </div>

      <div
        className="f3"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, margin: "12px 0" }}
      >
        <Meta label="Process / Department">{a.area}</Meta>
        <Meta label="Period under review">{a.period}</Meta>
        <Meta label="Lead auditor">{a.leadAuditor}</Meta>
        <Meta label="Planned timing">{tor.timing}</Meta>
        <Meta label="Notice issued">
          {fmtDate(notice.issuedAt)}
          {notice.revisedAt ? ` (updated ${fmtDate(notice.revisedAt)})` : ""}
        </Meta>
        {mine.length > 1 || notice.departments.length > 1 ? (
          <Meta label="Departments">{notice.departments.map(deptLabel).join(", ")}</Meta>
        ) : null}
      </div>

      <div className="obs-note">
        <div className="obs-note-text">
          <RichText text={notice.text} />
        </div>
      </div>

      {tor.infoRequired || tor.outOfScope ? (
        <details style={{ marginTop: 4 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            More from the terms of reference
          </summary>
          {tor.infoRequired ? (
            <div className="obs-field">
              <div className="ttl">Information &amp; access required</div>
              <div className="txt">
                <RichText text={tor.infoRequired} />
              </div>
            </div>
          ) : null}
          {tor.outOfScope ? (
            <div className="obs-field">
              <div className="ttl">Out of scope</div>
              <div className="txt">
                <RichText text={tor.outOfScope} />
              </div>
            </div>
          ) : null}
        </details>
      ) : null}

      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <div className="ttl" style={{ fontWeight: 700 }}>
          Requests ({requests.length})
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="btn sm"
          type="button"
          disabled={!mine.length}
          onClick={() => modal.open(<NewRequestDialog auditId={a.id} departments={mine} />)}
        >
          Ask Internal Audit for clarification
        </button>
      </div>
      {requests.length ? (
        <RequestTable requests={requests} showDepartment={mine.length > 1} />
      ) : (
        <p className="hint" style={{ marginBottom: 0 }}>
          No requests yet. Internal Audit&apos;s requests for information appear here for anyone in
          your department to answer, and you can ask the audit team to clarify anything about the
          engagement.
        </p>
      )}
    </div>
  );
}

export default function MyAuditsPage() {
  usePageChrome({ title: "Audits" });
  const { db } = useWorkspace();
  const user = useUser();
  const audits = portalAudits(db, user);

  return (
    <>
      <OpenRequestFromQuery />
      {audits.length ? (
        <>
          <p className="portal-note">
            Audit engagements Internal Audit has notified your department of. Respond to their
            requests for information here, or ask them to clarify anything about an engagement.
          </p>
          {audits.map((a) => (
            <EngagementCard key={a.id} a={a} />
          ))}
        </>
      ) : (
        <div className="card">
          <Empty big="✦">
            No audit engagements for your department right now.
            <br />
            <br />
            When Internal Audit begins an audit of your department, its engagement notice appears
            here — with the objectives and scope — and you can exchange information and
            clarification requests with the audit team.
          </Empty>
        </div>
      )}
    </>
  );
}
