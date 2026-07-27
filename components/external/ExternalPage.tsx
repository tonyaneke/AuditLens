"use client";

// External Audit & Regulatory Findings Register view.

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import { ensureExtList, EXT_SEVERITIES, EXT_SOURCES } from "@/lib/workspace/external";
import { ck, fmtDate, isoToDate } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ExtCommentaryDialog,
  ExtEditDialog,
  ExtImportDialog,
  ExtRaiseDialog,
} from "./dialogs";
import { exportAllExtFindingsCsv } from "./exports";

export default function ExternalPage() {
  const { db } = useWorkspace();
  const modal = useModal();

  const [sourceFilter, setSourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const list = ensureExtList(db);

  usePageChrome({
    title: "External Findings Register",
    actions: (
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn pri sm" onClick={() => modal.open(<ExtRaiseDialog />)}>
          + Log Finding
        </button>
        <button className="btn sec sm" onClick={() => modal.open(<ExtImportDialog />)}>
          Import CSV
        </button>
        <button className="btn sec sm" onClick={() => modal.open(<ExtCommentaryDialog />)}>
          AI Summary
        </button>
        <button className="btn sec sm" onClick={() => exportAllExtFindingsCsv(db)}>
          Export CSV
        </button>
      </div>
    ),
  });

  const filtered = list.filter((f) => {
    if (sourceFilter !== "all" && f.source !== sourceFilter) return false;
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const text = `${f.ref} ${f.title} ${f.owner} ${f.theme} ${f.sourceRef}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const totalCount = list.length;
  const openCount = list.filter((f) => f.status !== "Closed").length;
  const closedCount = list.filter((f) => f.status === "Closed").length;
  const highCount = list.filter(
    (f) => (f.severity === "Critical" || f.severity === "High") && f.status !== "Closed",
  ).length;

  return (
    <div>
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-val">{totalCount}</div>
          <div className="kpi-lbl">Total Logged</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-val" style={{ color: "#d97706" }}>
            {openCount}
          </div>
          <div className="kpi-lbl">Open Actions</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-val" style={{ color: "#16a34a" }}>
            {closedCount}
          </div>
          <div className="kpi-lbl">Closed</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-val" style={{ color: "#dc2626" }}>
            {highCount}
          </div>
          <div className="kpi-lbl">High/Critical Open</div>
        </div>
      </div>

      <div className="filter-bar" style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search ref, title, owner..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All Sources</option>
          {EXT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
          <option value="all">All Severities</option>
          {EXT_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Closed">Closed</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <div className="hint">No external findings found matching filters.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="dt-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Title &amp; Source</th>
                <th>Theme</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Target Date</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id}>
                  <td>
                    <b>{f.ref || f.id}</b>
                  </td>
                  <td>
                    <Link href={`/external/${f.id}`} style={{ fontWeight: 600 }}>
                      {f.title}
                    </Link>
                    <div className="meta">
                      {f.source} {f.year ? `(${f.year})` : ""}
                    </div>
                  </td>
                  <td>{f.theme || "—"}</td>
                  <td>
                    <span className={`pill ${ck(f.severity)}`}>{f.severity}</span>
                  </td>
                  <td>
                    <span className={`pill ${f.status === "Closed" ? "c-Low" : f.status === "In Progress" ? "c-Medium" : "c-High"}`}>
                      {f.status || "Open"}
                    </span>
                  </td>
                  <td>{f.owner || "—"}</td>
                  <td className="meta">{f.targetDate ? fmtDate(isoToDate(f.targetDate)) : "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="btn sec sm"
                      style={{ marginRight: 6 }}
                      onClick={() => modal.open(<ExtEditDialog findingId={f.id} />)}
                    >
                      Edit
                    </button>
                    <Link href={`/external/${f.id}`} className="btn pri sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
