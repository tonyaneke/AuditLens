"use client";

// Report Detail view (/audits/[audit]/reports/[report]) — React port of renderReport from audit-bot.js.

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import RaiseFlow from "@/components/obs/RaiseFlow";
import RichText from "@/components/ui/RichText";
import { exportReportWord } from "@/lib/client/word";
import { CRITS, ck } from "@/lib/workspace/selectors";
import type { Observation } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ModalFrontMatterDialog,
  ModalReportDialog,
} from "./dialogs";

const STATUSES = ["Open", "In Progress", "Closed"];

export default function ReportDetailPage({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
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

  const allObs = r.observations || [];
  const activeObs = allObs.filter((o) => !(o.withdrawal && (o.withdrawal as { stage?: string }).stage === "withdrawn"));
  const withdrawnObs = allObs.filter((o) => o.withdrawal && (o.withdrawal as { stage?: string }).stage === "withdrawn");

  const filteredObs = activeObs.filter((o) => {
    if (critFilter !== "All" && o.criticality !== critFilter) return false;
    if (statusFilter !== "All" && (o.status || "Open") !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${o.title} ${o.ref || ""} ${o.category || ""} ${o.description || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const emptyDraft: Observation = {
    id: "",
    title: "",
    description: "",
    criticality: "Moderate",
    status: "Open",
  };

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

      {/* Executive Summary */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Executive Summary</h3>
          <button className="btn sec sm" onClick={() => modal.open(<ModalFrontMatterDialog auditId={a.id} reportId={r.id} />)}>
            Edit Executive Summary
          </button>
        </div>

        {r.objective ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Audit Objective</div>
            <div className="txt"><RichText text={r.objective} /></div>
          </div>
        ) : null}

        {r.assuranceLevel ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Assurance Rating</div>
            <div className="txt"><b>{String(r.assuranceLevel)}</b></div>
          </div>
        ) : null}

        {r.auditOpinion ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Audit Opinion</div>
            <div className="txt"><RichText text={r.auditOpinion} /></div>
          </div>
        ) : null}

        {r.strengths ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Highlights of Strengths</div>
            <div className="txt"><RichText text={r.strengths} /></div>
          </div>
        ) : null}

        {r.areasForImprovement ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Areas for Strategic Improvement</div>
            <div className="txt"><RichText text={r.areasForImprovement} /></div>
          </div>
        ) : null}

        {r.conclusion ? (
          <div style={{ marginBottom: 12 }}>
            <div className="ttl">Conclusion</div>
            <div className="txt"><RichText text={r.conclusion} /></div>
          </div>
        ) : null}

        {!r.objective && !r.auditOpinion && !r.conclusion ? (
          <div className="hint">No executive summary documented yet.</div>
        ) : null}
      </div>

      {/* Observations Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            Observations ({activeObs.length})
          </h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="Search observations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180 }}
            />
            <select value={critFilter} onChange={(e) => setCritFilter(e.target.value)}>
              <option value="All">All Criticalities</option>
              {CRITS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              className="btn pri sm"
              onClick={() => modal.open(<RaiseFlow auditId={a.id} reportId={r.id} draft={emptyDraft} />)}
            >
              + Add Observation
            </button>
          </div>
        </div>

        {filteredObs.length === 0 ? (
          <div className="hint" style={{ padding: 20, textAlign: "center" }}>
            {activeObs.length === 0 ? "No observations yet. Click + Add Observation to begin." : "No observations match the current filter criteria."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {filteredObs.map((o) => (
              <div className="card" key={o.id} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <span className={`pill ${ck(o.criticality)}`}>{o.criticality}</span>
                  <span className={`pill ${o.status === "Closed" ? "c-Low" : o.status === "In Progress" ? "c-Medium" : "c-High"}`}>
                    {String(o.status || "Open")}
                  </span>
                </div>
                <Link
                  href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}`}
                  style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}
                >
                  {o.ref ? o.ref + " — " : ""}{o.title}
                </Link>
                {o.owner ? <div className="meta" style={{ marginBottom: 4 }}>Owner: {String(o.owner)}</div> : null}
                {o.dueDate ? <div className="meta" style={{ marginBottom: 8 }}>Due: {String(o.dueDate)}</div> : null}
                <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", justifyContent: "flex-end" }}>
                  <Link href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}`} className="btn sec sm">
                    View Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {withdrawnObs.length ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Withdrawn Observations ({withdrawnObs.length})</h3>
          <p className="hint">Deemed invalid after review and withdrawn by the Head of Audit.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {withdrawnObs.map((o) => (
              <div className="card" key={o.id}>
                <b>{o.title}</b>
                <div className="hint">Withdrawn</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
