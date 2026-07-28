"use client";

// Report Detail view (/audits/[audit]/reports/[report]) — React port of renderReport from
// audit-bot.js: findings summary + executive summary (head-only generate/regenerate), the
// observation grid with the full legacy pill UI, search + criticality/status filters, the
// "+ Add observation (AI)" entry point (legacy addObsDropdown), scan-for-repeats, the
// withdrawn-observations section and the proposed-SOP-updates roll-up.

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { Kpi, StatusPill } from "@/components/ui";
import { exportReportWord } from "@/lib/client/word";
import { exportSopUpdatesWord } from "@/lib/client/plan-word";
import {
  hasExecSummary,
  isHead,
  isRecentlyCreated,
  obsSortByAdded,
  worstCrit,
  zc,
} from "@/lib/workspace/observations";
import { CRITS, STATUSES, ck, fmtDateTime, isWithdrawn } from "@/lib/workspace/selectors";
import type { Audit, Observation, Report } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ModalExecPromptDialog,
  ModalFrontMatterDialog,
  ModalGenerateObsDialog,
  ModalReportDialog,
  ModalScanRepeatsDialog,
  ModalSopBulkDialog,
} from "./lazy";

/* ---- legacy obsApprovalBadge ---- */
function ObsApprovalBadge({ o }: { o: Observation }) {
  if (o.obsApproval === "pending") return <span className="pill sop-pending-pill">⏳ Pending Head approval</span>;
  if (o.obsApproval === "rejected") return <span className="pill c-Critical">Rejected</span>;
  return null;
}

/* ---- legacy obsGridCard: criticality pill · status pill · approval badge · category tag ·
        preview · Recently-created badge + created stamp · ↻ REPEAT pill · lc-{ck} accent ---- */
function ObsGridCard({ a, r, o }: { a: Audit; r: Report; o: Observation }) {
  const preview = String(o.description || o.recommendation || "").trim();
  const previewShort = preview.length > 90 ? preview.slice(0, 89) + "…" : preview;
  const recent = isRecentlyCreated(o);
  const created = o.createdAt ? fmtDateTime(String(o.createdAt)) : "";
  return (
    <Link
      href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}`}
      className={`obs-grid-card lc-${ck(o.criticality)}`}
      data-obs-id={o.id}
      role="button"
    >
      <div className="obs-grid-head">
        <span className={`pill c-${ck(o.criticality)}`}>{o.criticality}</span>
        <StatusPill status={String(o.status || "Open")} />
        <ObsApprovalBadge o={o} />
      </div>
      <h4 className="obs-grid-title">
        {o.ref ? o.ref + " — " : ""}
        {o.title}
      </h4>
      {o.category ? <span className="tag">{String(o.category)}</span> : null}
      {previewShort ? <p className="obs-grid-preview">{previewShort}</p> : null}
      {created || recent ? (
        <div className="obs-grid-created">
          {recent ? <span className="obs-recent-badge">Recently created</span> : null}
          {recent && created ? " · " : ""}
          {created}
        </div>
      ) : null}
      {o.isRepeat ? <span className="pill repeat-pill">↻ REPEAT</span> : null}
    </Link>
  );
}

/* ---- legacy sopStatusPill / sopListCard ---- */
function SopStatusPill({ o }: { o: Observation }) {
  return String(o.sopUpdate || "").trim() ? (
    <span className="pill c-Low">SOP drafted</span>
  ) : (
    <span className="pill sop-pending-pill">Pending</span>
  );
}

/* ---- legacy sumSection for the executive summary ---- */
function SumSection({ title, tag, text }: { title: string; tag?: string; text: string | undefined }) {
  if (!String(text || "").trim()) return null;
  return (
    <div className="obs-field">
      <div className="ttl">
        {title} {tag ? <span className="tag">{tag}</span> : null}
      </div>
      <div className="txt" style={{ whiteSpace: "pre-wrap" }}>
        <RichText text={text} />
      </div>
    </div>
  );
}

export default function ReportDetailPage({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const head = isHead(user);
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);

  const [critFilter, setCritFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");

  usePageChrome({
    title: r?.title || "Report Detail",
    actions: a && r ? (
      <div style={{ display: "flex", gap: 8 }}>
        <Link href={`/audits/${a.id}`} className="btn sec sm">
          ← Back to Audit
        </Link>
        <button className="btn sec sm" onClick={() => modal.open(<ModalReportDialog auditId={a.id} reportId={r.id} />)}>
          ✎ Edit Report
        </button>
        <button className="btn pri sm" onClick={() => exportReportWord(db, a, r)}>
          ⤓ Export Report
        </button>
      </div>
    ) : undefined,
  });

  if (!a || !r) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Report not found</h3>
        <p className="hint">The requested report could not be found.</p>
        <Link href={a ? `/audits/${a.id}` : "/audits"} className="btn sec" style={{ marginTop: 16 }}>
          ← Back to Audit
        </Link>
      </div>
    );
  }

  const allR = (r.observations || []).slice().sort(obsSortByAdded);
  const activeObs = allR.filter((o) => !isWithdrawn(o));
  const withdrawnObs = allR.filter(isWithdrawn);

  const filteredObs = activeObs.filter((o) => {
    if (critFilter !== "All" && o.criticality !== critFilter) return false;
    if (statusFilter !== "All" && (o.status || "Open") !== statusFilter) return false;
    const q = search.toLowerCase().trim();
    if (q) {
      const hay = `${o.title} ${o.ref || ""} ${o.category || ""} ${o.description || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Findings summary (legacy reportSummaryHTML).
  const c = zc();
  activeObs.forEach((o) => c[o.criticality]++);
  const open = activeObs.filter((o) => o.status !== "Closed").length;
  const overall = worstCrit(c, activeObs.length);

  // SOP roll-up (legacy renderReport tail section).
  const sopMissing = activeObs.filter((o) => !String(o.sopUpdate || "").trim()).length;
  const sopDrafted = activeObs.filter((o) => String(o.sopUpdate || "").trim());

  const hasNarrative = !!(
    r.objective || r.scope || r.outOfScope || r.strengths || r.areasForImprovement || r.auditOpinion || r.conclusion
  );

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="f3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div>
            <div className="ttl">Reference</div>
            <div>{r.refNo || "—"}</div>
          </div>
          <div>
            <div className="ttl">Period</div>
            <div>{r.period || "—"}</div>
          </div>
          <div>
            <div className="ttl">Status</div>
            <div>
              <span className={`pill ${r.status === "Final" ? "c-Low" : "c-Medium"}`}>{r.status || "Draft"}</span>
            </div>
          </div>
          <div>
            <div className="ttl">Type</div>
            <div>{String(r.kind || "Audit report")}</div>
          </div>
        </div>
        {r.scope ? (
          <div style={{ marginTop: 12 }}>
            <div className="ttl">Scope</div>
            <div className="txt"><RichText text={r.scope} /></div>
          </div>
        ) : null}
      </div>

      {/* Executive Summary — head-only Generate/Regenerate + Edit (legacy renderReport) */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Executive Summary</h3>
          <div className="spacer" />
          {head ? (
            <>
              <button
                className="btn ghost sm ai-generate-btn"
                onClick={() => modal.open(<ModalExecPromptDialog auditId={a.id} reportId={r.id} />)}
              >
                {hasExecSummary(r) ? "Regenerate exec summary" : "Generate exec summary"}
              </button>
              <button className="btn ghost sm" onClick={() => modal.open(<ModalFrontMatterDialog auditId={a.id} reportId={r.id} />)}>
                Edit
              </button>
            </>
          ) : null}
        </div>

        <div className="exec-summary-wrap">
          <div className="findings-summary">
            <h3 className="findings-summary-title">Summary of findings</h3>
            {activeObs.length ? (
              <div className="findings-summary-cards">
                <Kpi tone="base" label="Observations" value={activeObs.length} sub={`${open} open · ${activeObs.length - open} closed`} icon="obs" />
                <Kpi tone="warn" label="Key exposures" value={(c["Critical"] || 0) + (c["High"] || 0)} sub="Critical & High" icon="alert" />
                <Kpi tone="accent" label="Open actions" value={open} sub="in progress" icon="audit" />
                <Kpi tone={overall === "Critical" || overall === "High" ? "warn" : "good"} label="Risk assessment scope" value={overall} sub="report posture" icon="check" />
              </div>
            ) : (
              <p className="hint">No observations in this report yet.</p>
            )}
          </div>

          <SumSection title="1.1 Audit objective & scope" text={String(r.objective || r.scope || "")} />
          <SumSection title="Areas out of scope" text={String(r.outOfScope || "")} />
          <SumSection title="1.2 Highlights of strengths" text={String(r.strengths || "")} />
          <SumSection title="1.3 Areas for strategic improvement" text={String(r.areasForImprovement || "")} />
          <SumSection title="1.4 Internal audit opinion" tag={r.assuranceLevel ? String(r.assuranceLevel) : undefined} text={String(r.auditOpinion || "")} />
          <SumSection title="1.5 Conclusion" text={String(r.conclusion || "")} />
          {!hasNarrative ? <div className="hint">No executive-summary narrative yet.</div> : null}
        </div>
      </div>

      {/* Observations — legacy grid cards, filters and add entry points */}
      <div className="card report-obs-section" style={{ marginBottom: 20 }}>
        <div className="obs-section-top">
          <h3 className="section-title">Observations ({activeObs.length})</h3>
          <div className="spacer" />
          {activeObs.length ? (
            <input
              className="field-input obs-filter-search"
              type="text"
              placeholder="Search observations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
          <button
            className="btn sm dark ai-generate-btn"
            onClick={() => modal.open(<ModalGenerateObsDialog auditId={a.id} reportId={r.id} />)}
          >
            + Add observation (AI)
          </button>
          {activeObs.length ? (
            <button className="btn sec sm" onClick={() => modal.open(<ModalScanRepeatsDialog auditId={a.id} reportId={r.id} />)}>
              🔁 Scan for repeats
            </button>
          ) : null}
        </div>

        {activeObs.length ? (
          <div className="obs-filters-row obs-filters-left">
            <div className="filter-group">
              <span className="filter-label">Criticality</span>
              <select className="field-select field-select-sm" value={critFilter} onChange={(e) => setCritFilter(e.target.value)}>
                {["All", ...CRITS].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <span className="filter-label">Status</span>
              <select className="field-select field-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {["All", ...STATUSES].map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {!activeObs.length ? (
          <div className="empty">
            <div className="big">✎</div>
            No observations yet.
            <br />
            Use <b>Add observation</b> above to draft one — from a one-liner, manually, or by importing a CSV.
          </div>
        ) : !filteredObs.length ? (
          <div className="empty">
            <div className="big">🔍</div>
            No observations match the current filter.
            <br />
            Try clearing the search or criticality/status filters.
          </div>
        ) : (
          <div className="obs-grid">
            {filteredObs.map((o) => (
              <ObsGridCard key={o.id} a={a} r={r} o={o} />
            ))}
          </div>
        )}
      </div>

      {/* Withdrawn observations — kept for the record (legacy renderReport) */}
      {withdrawnObs.length ? (
        <div className="card report-obs-section" style={{ marginBottom: 20 }}>
          <div className="obs-section-top">
            <h3 className="section-title">Withdrawn observations ({withdrawnObs.length})</h3>
          </div>
          <p className="hint" style={{ margin: "2px 0 10px" }}>
            Deemed invalid after review and withdrawn by the Head of Audit. They do not count as open or closed.
          </p>
          <div className="obs-grid">
            {withdrawnObs.map((o) => (
              <ObsGridCard key={o.id} a={a} r={r} o={o} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Proposed SOP updates roll-up (legacy renderReport tail) */}
      <div className="card">
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Proposed SOP updates</h3>
          <div className="spacer" />
          {sopMissing ? (
            <button
              className="btn sec sm ai-generate-btn"
              onClick={() => modal.open(<ModalSopBulkDialog auditId={a.id} reportId={r.id} />)}
            >
              Generate missing ({sopMissing})
            </button>
          ) : null}
          {sopDrafted.length ? (
            <button className="btn sec sm" onClick={() => exportSopUpdatesWord(db, r)}>
              ⤓ Export change-list (Word)
            </button>
          ) : null}
        </div>
        {!activeObs.length ? (
          <div className="hint" style={{ marginTop: 8 }}>
            Add observations first — proposed SOP updates are drafted from each finding.
          </div>
        ) : sopDrafted.length ? (
          <>
            <p className="hint" style={{ margin: "2px 0 0" }}>
              Click a row to view the full proposed procedure revision.
            </p>
            {sopDrafted.map((o) => (
              <Link
                key={o.id}
                href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}/sop`}
                className="sop-list-card"
                data-obs-id={o.id}
                role="button"
                style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}
              >
                <b className="sop-list-title">
                  {o.ref ? o.ref + " — " : ""}
                  {o.title}
                </b>
                <SopStatusPill o={o} />
              </Link>
            ))}
          </>
        ) : (
          <div className="hint" style={{ marginTop: 8 }}>
            No proposed SOP updates drafted yet.
            {sopMissing ? (
              <>
                {" "}
                Use <b>Generate missing ({sopMissing})</b> above, or draft one from an observation&apos;s Edit form.
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
