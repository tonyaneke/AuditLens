"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { CritPill, Empty, Kpi, StatusPill } from "@/components/ui";
import { getDepartmentStats, slugToDepartment } from "@/lib/dept-slugs";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import {
  daysToClose,
  effectiveClose,
  extOverdue,
  fmtDate,
  isOverdueObs,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type DeptObsPageProps = {
  deptSlug: string;
  type?: "internal" | "external";
};

type FormattedItem = {
  id: string;
  ref: string;
  title: string;
  findingDetail?: string;
  source: string;
  raisedDate?: string;
  criticality: string;
  status: string;
  remediationDate?: string;
  isOverdue: boolean;
  daysRemaining: number | null;
  ownerName: string;
  ownerResponse?: string;
  rawInternal?: ObsWithContext;
  rawExternal?: ExtFinding;
};

export default function DepartmentObservationsPage({
  deptSlug,
  type = "internal",
}: DeptObsPageProps) {
  const { db } = useWorkspace();
  const router = useRouter();

  const deptName = useMemo(() => slugToDepartment(deptSlug, db), [deptSlug, db]);
  const stats = useMemo(() => getDepartmentStats(db, deptName), [db, deptName]);

  const cleanDeptName = deptName.replace(/\s+Department$/i, "");
  const fullDeptName = deptName.endsWith("Department") ? deptName : `${deptName} Department`;
  const pageTitle = `${fullDeptName} — ${type === "external" ? "External" : "Internal"} Observations`;

  usePageChrome({ title: pageTitle });

  const [activeFilter, setActiveFilter] = useState<"pending" | "done" | "all">("pending");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [search, setSearch] = useState<string>("");

  // Items for the selected type (internal or external)
  const formattedItems: FormattedItem[] = useMemo(() => {
    if (type === "external") {
      return stats.external.all.map((f) => {
        const isOver = extOverdue(f);
        return {
          id: f.id,
          ref: f.ref || f.sourceRef || `EXT-${f.id.slice(-4)}`,
          title: f.title || "Untitled Finding",
          findingDetail: f.detail || f.recommendation,
          source: f.source ? `External · ${f.source}` : "External Finding",
          raisedDate: f.raisedAt ? (fmtDate(f.raisedAt) || f.raisedAt) : f.year,
          criticality: f.severity || "Medium",
          status: f.status || "Open",
          remediationDate: f.targetDate ? (fmtDate(f.targetDate) || f.targetDate) : undefined,
          isOverdue: isOver,
          daysRemaining: null,
          ownerName: f.owner || "Unassigned",
          ownerResponse: f.ownerResponse || f.managementResponse,
          rawExternal: f,
        };
      });
    }

    // Internal observations
    return stats.internal.all.map((o) => {
      const dt = effectiveClose(o, o._r);
      const days = daysToClose(o, o._r);
      const isOver = isOverdueObs(o, o._r);

      return {
        id: o.id,
        ref: String(o.ref || `OBS-${o.id.slice(-4)}`),
        title: o.title || "Untitled Observation",
        findingDetail: String(o.description || o.recommendation || ""),
        source: String(o._r?.title ? `${o._a?.name || "Audit"} · ${o._r.title}` : o._a?.name || "Internal Audit"),
        raisedDate: o.raisedAt ? (fmtDate(o.raisedAt) || o.raisedAt) : undefined,
        criticality: o.criticality || "Moderate",
        status: o.status || "Open",
        remediationDate: dt ? fmtDate(dt) : undefined,
        isOverdue: isOver,
        daysRemaining: days,
        ownerName: o.owner || "Unassigned",
        ownerResponse: o.ownerResponse || (o.updates && o.updates.length ? o.updates[o.updates.length - 1].text : undefined),
        rawInternal: o,
      };
    });
  }, [type, stats]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return formattedItems
      .filter((item) => {
        // Tab filter
        if (activeFilter === "pending" && item.status === "Closed") return false;
        if (activeFilter === "done" && item.status !== "Closed") return false;

        // Criticality filter
        if (critFilter !== "All" && item.criticality !== critFilter) return false;

        // Search filter
        if (search.trim()) {
          const q = search.toLowerCase();
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchRef = item.ref.toLowerCase().includes(q);
          const matchDetail = (item.findingDetail || "").toLowerCase().includes(q);
          const matchOwner = item.ownerName.toLowerCase().includes(q);
          if (!matchTitle && !matchRef && !matchDetail && !matchOwner) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        return a.title.localeCompare(b.title);
      });
  }, [formattedItems, activeFilter, critFilter, search]);

  const currentStats = type === "external" ? stats.external : stats.internal;
  const totalCount = currentStats.all.length;
  const doneCount = currentStats.done.length;
  const pendingCount = currentStats.pending.length;
  const overdueCount = currentStats.overdue.length;
  const remRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 100;

  function openItem(item: FormattedItem) {
    if (type === "internal" && item.rawInternal) {
      const o = item.rawInternal;
      const href = hrefForView("observation", {
        audit: o._a.id,
        report: o._r.id,
        obs: o.id,
      });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    } else if (type === "external" && item.rawExternal) {
      const href = hrefForView("extfinding", { ext: item.rawExternal.id });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Mini Dashboard Snapshot */}
      <div className="kpis-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Kpi
          tone="base"
          label="Total Observations"
          value={totalCount}
          sub={`${type === "internal" ? "Internal audit" : "Regulatory & external"} findings`}
          icon="audit"
        />
        <Kpi
          tone="good"
          label="What Has Been Done"
          value={doneCount}
          sub={`${remRate}% resolved & closed`}
          icon="check"
        />
        <Kpi
          tone="accent"
          label="What's Left (Pending)"
          value={pendingCount}
          sub="Under active remediation"
          icon="obs"
        />
        <Kpi
          tone={overdueCount > 0 ? "warn" : "base"}
          label="Overdue Actions"
          value={overdueCount}
          sub="Remediation date passed"
          icon="alert"
        />
      </div>

      {/* Toolbar: Workflow Tabs & Filters */}
      <div
        className="row"
        style={{
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 4,
          marginBottom: 4,
        }}
      >
        {/* Workflow Tabs: What's Left vs What Has Been Done */}
        <div
          style={{
            display: "inline-flex",
            background: "var(--surface-subtle, #eef2f0)",
            padding: 3,
            borderRadius: 8,
            gap: 3,
            border: "1px solid var(--line, #e2e8f0)",
          }}
          role="tablist"
        >
          <button
            type="button"
            onClick={() => setActiveFilter("pending")}
            style={{
              border: "none",
              background: activeFilter === "pending" ? "#fff" : "transparent",
              color: activeFilter === "pending" ? "var(--brand-700, #0a4a3b)" : "var(--muted, #64748b)",
              fontWeight: activeFilter === "pending" ? 700 : 500,
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 6,
              cursor: "pointer",
              boxShadow: activeFilter === "pending" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            What&rsquo;s Left ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("done")}
            style={{
              border: "none",
              background: activeFilter === "done" ? "#fff" : "transparent",
              color: activeFilter === "done" ? "var(--brand-700, #0a4a3b)" : "var(--muted, #64748b)",
              fontWeight: activeFilter === "done" ? 700 : 500,
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 6,
              cursor: "pointer",
              boxShadow: activeFilter === "done" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            What Has Been Done ({doneCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("all")}
            style={{
              border: "none",
              background: activeFilter === "all" ? "#fff" : "transparent",
              color: activeFilter === "all" ? "var(--brand-700, #0a4a3b)" : "var(--muted, #64748b)",
              fontWeight: activeFilter === "all" ? 700 : 500,
              fontSize: 12,
              padding: "5px 12px",
              borderRadius: 6,
              cursor: "pointer",
              boxShadow: activeFilter === "all" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            All ({totalCount})
          </button>
        </div>

        {/* Filters */}
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label">Criticality</span>
            <select
              className="field-select field-select-sm"
              value={critFilter}
              onChange={(e) => setCritFilter(e.target.value)}
            >
              <option value="All">All Criticalities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium / Moderate</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div style={{ minWidth: 220 }}>
            <input
              type="text"
              placeholder={`Search ${cleanDeptName} observations, descriptions, owners…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 12px", fontSize: 12.5 }}
            />
          </div>
        </div>
      </div>

      {/* Observations Grid (Action Owner Card Styling) */}
      {!filteredItems.length ? (
        <div className="card">
          <Empty big="✦">
            No observations found
          </Empty>
        </div>
      ) : (
        <div className="myobs-grid">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="myobs-card"
              onClick={() => openItem(item)}
              title={`Open observation: ${item.title}`}
            >
              <div className="myobs-card-top">
                <CritPill crit={item.criticality} />
                <StatusPill status={item.status} />
                {item.isOverdue && item.status !== "Closed" ? (
                  <span className="pill c-Critical portal-overdue">overdue</span>
                ) : null}
                {!item.isOverdue && item.daysRemaining != null && item.daysRemaining <= 14 && item.status !== "Closed" ? (
                  <span className="pill c-High">Due in {item.daysRemaining}d</span>
                ) : null}
              </div>

              <div className="myobs-card-title">{item.title}</div>

              {item.findingDetail ? (
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-secondary, #475569)",
                    lineHeight: 1.45,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {item.findingDetail}
                </div>
              ) : null}

              <div className="myobs-card-meta">
                Owner: {item.ownerName || "Unassigned"}
              </div>

              {item.remediationDate ? (
                <div className="myobs-card-foot">
                  <span className="hint">Expected close</span>
                  <span>
                    {item.remediationDate}
                    {item.isOverdue && item.status !== "Closed" ? (
                      <span className="pill c-Critical portal-overdue" style={{ marginLeft: 6 }}>overdue</span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
