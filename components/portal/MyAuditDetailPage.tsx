"use client";

/* Action-owner portal — one engagement (/portal/audits/[audit]). Laid out like an observation's
   page — hero, meta strip, prose sections, then the interactive block at the bottom (here the
   requests, where an observation has its remediation) — using the shared parts in
   components/audits/detail-parts.tsx, so an engagement reads like everything else in the portal.

   Order: the Terms of Reference first — what the department reads when the engagement starts — then,
   once issued, the Conclusion as its own section, set apart with space and a heading, then the
   requests and comments exchanged with the audit team. That last block lights up (and the hero's
   pill jumps to it) while anything in it is waiting on the department. */

import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton, Kpi } from "@/components/ui";
import { DetailHero, Meta, Section } from "@/components/audits/detail-parts";
import { OpenRequestFromQuery, RequestTable } from "@/components/comms/AuditComms";
import { NewRequestDialog } from "@/components/comms/lazy";
import { deptLabel } from "@/lib/dept-scope";
import {
  CLOSEOUT_SECTIONS,
  auditTypeLabel,
  closeoutSectionTag,
  engagementTitle,
  myEngagementDepartments,
  portalRequests,
  reachesMe,
  requestAwaiting,
} from "@/lib/workspace/audit-comms";
import { portalObsList } from "@/lib/workspace/portal";
import { fmtDate, type ObsWithContext } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const BACK = "/portal/audits";

/** A titled list — the plan's objectives and key risks are stored as lists, not prose. */
function ListSection({ title, items }: { title: string; items: string[] | undefined }) {
  const list = (items || []).map((x) => String(x).trim()).filter(Boolean);
  if (!list.length) return null;
  return (
    <section className="obs-detail-section">
      <h4 className="obs-detail-label">{title}</h4>
      <div className="obs-detail-content">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {list.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The report's "Summary of findings" as the department sees it: the observations raised against
 *  their department in this engagement (the only ones the server serves them), with Closed as the
 *  fourth card where Internal Audit's report shows its overall risk rating. Live, unlike the
 *  conclusion's sections — it is the department's own remediation, which carries on after the
 *  conclusion. Inside the Conclusion once there is one; before that, its own section. Shown at
 *  zero too (user's call): four zeros say "nothing raised against you" as plainly as a sentence. */
function FindingsSummary({ obs, title = true }: { obs: ObsWithContext[]; title?: boolean }) {
  const open = obs.filter((o) => o.status !== "Closed").length;
  const closed = obs.length - open;
  const keyExposures = obs.filter((o) => o.criticality === "Critical" || o.criticality === "High").length;
  return (
    <div className="findings-summary">
      {title ? <h4 className="findings-summary-title">Summary of findings</h4> : null}
      <div className="findings-summary-cards">
        <Kpi tone="base" label="Observations" value={obs.length} sub={`${open} open · ${closed} closed`} icon="obs" />
        <Kpi tone="warn" label="Key exposures" value={keyExposures} sub="Critical & High" icon="alert" />
        <Kpi tone="accent" label="Open actions" value={open} sub="in progress" icon="audit" />
        <Kpi tone="good" label="Closed" value={closed} sub="resolved" icon="check" />
      </div>
    </div>
  );
}

export default function MyAuditDetailPage({ auditId }: { auditId: string }) {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  usePageChrome({ title: "", back: <BackButton href={BACK} /> });

  const a = (db.audits || []).find((x) => x.id === auditId);
  // Only what was addressed to their department — the server has already trimmed the rest.
  const notice = a?.notice?.issuedAt && reachesMe(db, a.notice, user) ? a.notice : undefined;
  const closeout = a?.closeout?.issuedAt && reachesMe(db, a.closeout, user) ? a.closeout : undefined;

  if (!a || (!notice && !closeout)) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Engagement not found</h3>
        <p className="hint">This engagement is not available to your department.</p>
        <BackButton href={BACK} />
      </div>
    );
  }

  const tor = (a.tor || {}) as Record<string, string | undefined>;
  const plan = a.plan || {};
  const requests = portalRequests(db, user, a.id);
  const waiting = requests.filter((r) => requestAwaiting(r) === "dept").length;
  const mine = myEngagementDepartments(db, a, user);
  const findings = portalObsList(db, user).filter((o) => o._a.id === a.id);

  return (
    <div className="obs-detail-page anim-fade-in">
      <OpenRequestFromQuery />
      <DetailHero
        title={a.name}
        badges={
          <>
            {closeout ? (
              <span className="status-pill closed">Concluded</span>
            ) : (
              <span className="status-pill progress">In progress</span>
            )}
            <span className="tag">{auditTypeLabel(a)}</span>
            {mine.map((d) => (
              <span className="tag" key={d}>
                {deptLabel(d)}
              </span>
            ))}
            {waiting ? (
              <a className="pill pill-await" href="#requests" title="Jump to what is waiting on your department">
                {waiting} awaiting your response
              </a>
            ) : null}
          </>
        }
      />

      <div className="obs-detail-meta">
        <Meta label="Process / Department">{a.area}</Meta>
        <Meta label="Period under review">{a.period}</Meta>
        <Meta label="Lead auditor">{a.leadAuditor}</Meta>
        <Meta label="Planned timing">{tor.timing}</Meta>
        <Meta label="Notified">
          {notice ? fmtDate(notice.issuedAt) + (notice.revisedAt ? ` (updated ${fmtDate(notice.revisedAt)})` : "") : ""}
        </Meta>
        <Meta label="Concluded">
          {closeout ? fmtDate(closeout.issuedAt) + (closeout.revisedAt ? ` (updated ${fmtDate(closeout.revisedAt)})` : "") : ""}
        </Meta>
      </div>

      {/* The Terms of Reference, section by section. The notice MESSAGE is not repeated here: the
          department already received it (bell and e-mail), and its objectives and scope are the
          sections below. */}
      <div className="obs-detail-sections">
        <ListSection title="Audit objectives" items={plan.objectives} />
        <Section title="Scope" text={plan.scope} />
        <ListSection title="Key risks to be assessed" items={plan.keyRisks} />
        <Section title="Areas out of scope" text={tor.outOfScope} />
        <Section title="Information & access required" text={tor.infoRequired} />
      </div>

      {!closeout ? (
        <section className="comms-major" aria-labelledby="findings-h">
          <h3 id="findings-h" className="section-title">
            Summary of findings
          </h3>
          <p className="hint" style={{ margin: 0 }}>
            {findings.length
              ? "Observations raised against your department in this engagement so far. Each one is on your Internal Observations tab."
              : "No observations have been raised against your department in this engagement yet. Any that are will be counted here."}
          </p>
          <FindingsSummary obs={findings} title={false} />
        </section>
      ) : null}

      {closeout ? (
        <section className="comms-major" aria-labelledby="conclusion-h">
          <h3 id="conclusion-h" className="section-title">
            Conclusion
          </h3>
          <p className="hint" style={{ margin: 0 }}>
            The {engagementTitle(a)} concluded on {fmtDate(closeout.issuedAt)}. These are the highlights of the
            executive summary{closeout.reportTitle ? <> of <i>{closeout.reportTitle}</i></> : null}. Thank you for
            your cooperation — agreed actions continue to be tracked on your Internal Observations tab.
          </p>
          <FindingsSummary obs={findings} />
          <div className="obs-detail-sections">
            {CLOSEOUT_SECTIONS.map(([k, title]) => (
              <Section key={k} title={title} text={closeout[k]} tag={closeoutSectionTag(closeout, k)} />
            ))}
          </div>
        </section>
      ) : null}

      <section id="requests" className="comms-major" aria-labelledby="requests-h">
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 id="requests-h" className="section-title">
            Requests &amp; comments ({requests.length})
          </h3>
          {waiting ? <span className="pill pill-await">{waiting} awaiting your response</span> : null}
          <div className="spacer" style={{ flex: 1 }} />
          <button
            className="btn sm"
            type="button"
            disabled={!mine.length}
            onClick={() => modal.open(<NewRequestDialog auditId={a.id} departments={mine} />)}
          >
            Send comment to Internal Audit
          </button>
        </div>
        {requests.length ? (
          // Lit up while Internal Audit is waiting on the department — information asked for, or a reply.
          <div className={waiting ? "req-active" : undefined}>
            <RequestTable requests={requests} showDepartment={mine.length > 1} side="dept" />
          </div>
        ) : (
          <p className="hint" style={{ marginBottom: 0 }}>
            Nothing yet. Internal Audit&apos;s requests for information appear here for anyone in your department to
            answer, and you can send the audit team a comment about anything in the engagement.
          </p>
        )}
      </section>
    </div>
  );
}
