"use client";

/* The observation card used wherever observations are listed as a grid — a report's register and
   a test's "observations raised from this test". Extracted from ReportDetailPage so both render a
   finding identically. */

import Link from "next/link";
import { StatusPill } from "@/components/ui";
import { isRecentlyCreated } from "@/lib/workspace/observations";
import { ck, fmtDateTime } from "@/lib/workspace/selectors";
import type { Audit, Observation, Report } from "@/lib/workspace/types";

/* ---- legacy obsApprovalBadge ---- */
export function ObsApprovalBadge({ o }: { o: Observation }) {
  if (o.obsApproval === "pending") return <span className="pill sop-pending-pill">⏳ Pending Head approval</span>;
  // A sent-back rejection is still Internal Audit's to fix, so it reads differently from a final one.
  if (o.obsApproval === "rejected")
    return <span className="pill c-Critical">{o.rejectionFinal ? "Rejected" : "Rejected · sent back"}</span>;
  return null;
}

/* ---- legacy obsGridCard: criticality pill · approval badge · status pill · repeat icon ·
        preview · Recently-created badge + created stamp · lc-{ck} accent.
        The category tag is not shown on the card (it is on the detail page), and a repeat finding
        is a ↻ icon beside the status rather than a full-width pill under the card. ---- */
export default function ObsGridCard({ a, r, o }: { a: Audit; r: Report; o: Observation }) {
  const preview = String(o.description || o.recommendation || "").trim();
  const previewShort = preview.length > 90 ? preview.slice(0, 89) + "…" : preview;
  const recent = isRecentlyCreated(o);
  const created = o.createdAt ? fmtDateTime(String(o.createdAt)) : "";
  const repeatLabel = "Repeat finding" + (o.repeatOf ? " of " + o.repeatOf : "");
  return (
    <Link
      href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}`}
      className={`obs-grid-card lc-${ck(o.criticality)}`}
      data-obs-id={o.id}
      role="button"
    >
      <div className="obs-grid-head">
        <span className="obs-grid-head-group">
          <span className={`pill c-${ck(o.criticality)}`}>{o.criticality}</span>
          <ObsApprovalBadge o={o} />
        </span>
        <span className="obs-grid-head-group">
          <StatusPill status={String(o.status || "Open")} />
          {o.isRepeat ? (
            <span className="repeat-icon" title={repeatLabel} aria-label={repeatLabel} role="img">
              ↻
            </span>
          ) : null}
        </span>
      </div>
      <h4 className="obs-grid-title">
        {o.ref ? o.ref + " — " : ""}
        {o.title}
      </h4>
      {previewShort ? <p className="obs-grid-preview">{previewShort}</p> : null}
      {created || recent ? (
        <div className="obs-grid-created">
          {recent ? <span className="obs-recent-badge">Recently created</span> : null}
          {recent && created ? " · " : ""}
          {created}
        </div>
      ) : null}
    </Link>
  );
}
