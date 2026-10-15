"use client";

/* Action-owner portal — Audits. The engagements Internal Audit has communicated to this person's
   department(s), as cards — the same register shape as Internal Observations: one card per
   engagement, split into ongoing and concluded, each opening its own page (MyAuditDetailPage) with
   the notice, the Terms of Reference, the conclusion and the requests.

   The department sees an engagement only once a notice or conclusion is issued to it
   (lib/audit-comms-scope.ts), never the test programme, and only the communications addressed to it
   — the server trims the rest (engagementOnlyAudit / withAddressedComms in lib/workspace-scope.ts). */

import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import { deptLabel } from "@/lib/dept-scope";
import {
  auditTypeLabel,
  myEngagementDepartments,
  portalAuditHref,
  portalAudits,
  portalRequests,
  reachesMe,
  requestAwaiting,
} from "@/lib/workspace/audit-comms";
import { fmtDate } from "@/lib/workspace/selectors";
import type { Audit } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

function AuditCard({ a }: { a: Audit }) {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();
  const concluded = !!a.closeout?.issuedAt && reachesMe(db, a.closeout, user);
  const notice = a.notice?.issuedAt && reachesMe(db, a.notice, user) ? a.notice : undefined;
  const waiting = portalRequests(db, user, a.id).filter((r) => requestAwaiting(r) === "dept").length;
  const depts = myEngagementDepartments(db, a, user);
  const timing = String(a.tor?.timing || "");

  return (
    <button type="button" className="myobs-card" onClick={() => router.push(portalAuditHref(a.id))} title="Open">
      <div className="myobs-card-top">
        {concluded ? (
          <span className="status-pill closed">Concluded</span>
        ) : (
          <span className="status-pill progress">In progress</span>
        )}
        <span className="tag">{auditTypeLabel(a)}</span>
        {depts.map((d) => (
          <span className="tag" key={d}>
            {deptLabel(d)}
          </span>
        ))}
        {waiting ? (
          <span className="pill pill-await">{waiting} awaiting your response</span>
        ) : null}
      </div>
      <div className="myobs-card-title">{a.name}</div>
      <div className="myobs-card-meta">
        {[a.period, a.leadAuditor ? `Lead auditor: ${a.leadAuditor}` : ""].filter(Boolean).join(" · ") || "—"}
      </div>
      <div className="myobs-card-foot">
        <span className="hint">{concluded ? "Concluded" : timing ? "Planned timing" : "Notified"}</span>
        <span>
          {concluded ? fmtDate(a.closeout?.revisedAt || a.closeout?.issuedAt) : timing || fmtDate(notice?.issuedAt)}
        </span>
      </div>
    </button>
  );
}

function Bucket({ title, audits, empty, first }: { title: string; audits: Audit[]; empty: string; first?: boolean }) {
  return (
    <>
      <div className="seclabel" style={{ margin: first ? "4px 0 12px" : "20px 0 12px" }}>
        {title} <span className="hint" style={{ fontWeight: 400 }}>({audits.length})</span>
      </div>
      {audits.length ? (
        <div className="myobs-grid">
          {audits.map((a) => (
            <AuditCard key={a.id} a={a} />
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty big="—">{empty}</Empty>
        </div>
      )}
    </>
  );
}

export default function MyAuditsPage() {
  usePageChrome({ title: "Audit Reports" });
  const { db } = useWorkspace();
  const user = useUser();
  const audits = portalAudits(db, user);

  if (!audits.length) {
    return (
      <div className="card">
        <Empty big="✦">
          No audit engagements for your department right now.
          <br />
          <br />
          When Internal Audit begins an audit of your department, it appears here with its terms of
          reference — answer the audit team&apos;s requests for information there, or send them a comment.
        </Empty>
      </div>
    );
  }

  const concluded = audits.filter((a) => !!a.closeout?.issuedAt && reachesMe(db, a.closeout, user));
  const ongoing = audits.filter((a) => !concluded.includes(a));
  return (
    <>
      <Bucket first title="Ongoing engagements" audits={ongoing} empty="No engagement is in progress." />
      <Bucket title="Concluded engagements" audits={concluded} empty="No engagement has been concluded yet." />
    </>
  );
}
