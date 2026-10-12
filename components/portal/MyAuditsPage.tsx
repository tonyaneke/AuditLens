"use client";

/* Action-owner portal — Audits. The engagements Internal Audit has communicated to this person's
   department(s): at the start, the engagement notice — what is being audited, the objectives and
   scope, the terms-of-reference details the department needs (timing, what information and access
   will be required); at the end, the audit conclusion — the executive summary of the final report
   (objective & scope, areas out of scope, strengths, areas for strategic improvement, conclusion);
   and throughout, the information / clarification requests exchanged with the audit team.

   The department sees an engagement only once a notice or conclusion is issued to it
   (lib/audit-comms-scope.ts), never the test programme, and only the communications addressed to it
   — the server trims the rest (engagementOnlyAudit / withAddressedComms in lib/workspace-scope.ts). */

import type { ReactNode } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty } from "@/components/ui";
import RichText from "@/components/ui/RichText";
import { CloseoutView, OpenRequestFromQuery, RequestTable } from "@/components/comms/AuditComms";
import { NewRequestDialog } from "@/components/comms/lazy";
import { deptLabel } from "@/lib/dept-scope";
import {
  auditTypeLabel,
  engagementDepartments,
  engagementTitle,
  myEngagementDepartments,
  portalAudits,
  portalRequests,
  reachesMe,
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
  // Only what was addressed to them — the server has already trimmed the rest; this is belt and braces.
  const notice = a.notice?.issuedAt && reachesMe(db, a.notice, user) ? a.notice : undefined;
  const closeout = a.closeout?.issuedAt && reachesMe(db, a.closeout, user) ? a.closeout : undefined;
  const requests = portalRequests(db, user, a.id);
  const mine = myEngagementDepartments(db, a, user);
  const allDepts = engagementDepartments(a);
  const waiting = requests.filter((r) => requestAwaiting(r) === "dept").length;
  const tor = a.tor || {};
  const noticeBox = notice ? (
    <div className="obs-note">
      <div className="obs-note-text">
        <RichText text={notice.text} />
      </div>
    </div>
  ) : null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>{a.name}</h3>
        <span className="tag">{auditTypeLabel(a)}</span>
        {closeout ? (
          <span className="status-pill closed">Concluded</span>
        ) : a.status === "Completed" ? (
          <span className="status-pill closed">Completed</span>
        ) : null}
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
        {notice ? (
          <Meta label="Notice issued">
            {fmtDate(notice.issuedAt)}
            {notice.revisedAt ? ` (updated ${fmtDate(notice.revisedAt)})` : ""}
          </Meta>
        ) : null}
        {closeout ? (
          <Meta label="Concluded">
            {fmtDate(closeout.issuedAt)}
            {closeout.revisedAt ? ` (updated ${fmtDate(closeout.revisedAt)})` : ""}
          </Meta>
        ) : null}
        {allDepts.length > 1 ? <Meta label="Departments">{allDepts.map(deptLabel).join(", ")}</Meta> : null}
      </div>

      {closeout ? (
        <>
          {/* The end of the engagement leads; the notice that opened it is kept one click away. */}
          <div className="ttl" style={{ fontWeight: 700, marginBottom: 4 }}>
            Audit conclusion
          </div>
          <p style={{ margin: "0 0 8px" }}>
            The {engagementTitle(a)} has concluded. The highlights of the executive summary
            {closeout.reportTitle ? (
              <>
                {" "}of <i>{closeout.reportTitle}</i>
              </>
            ) : null}{" "}
            are presented below.
          </p>
          <CloseoutView closeout={closeout} />
          <p className="hint" style={{ marginTop: 0 }}>
            Thank you for your cooperation throughout the engagement. Agreed actions continue to be
            tracked on your Internal Observations tab.
          </p>
          {noticeBox ? (
            <details style={{ marginTop: 4 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>
                The engagement notice (issued {fmtDate(notice!.issuedAt)})
              </summary>
              <div style={{ marginTop: 6 }}>{noticeBox}</div>
            </details>
          ) : null}
        </>
      ) : (
        noticeBox
      )}

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
