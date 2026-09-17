"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { CritPill, Empty, Kpi, RowOpen, StatusPill } from "@/components/ui";
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
  const pageTitle = `${cleanDeptName} — ${type === "external" ? "External" : "Internal"} Observations`;

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
        ref: o.code || `OBS-${o.id.slice(-4)}`,
        title: o.title || "Untitled Observation",
        findingDetail: o.finding || o.recommendation,
        source: o._r?.title ? `${o._a?.title || "Audit"} · ${o._r.title}` : o._a?.title || "Internal Audit",
        raisedDate: o.raisedAt ? (fmtDate(o.raisedAt) || o.raisedAt) : undefined,
        criticality: o.criticality || "Moderate",
        status: o.status || "Open",
        remediationDate: dt ? fmtDate(dt) : undefined,
        isOverdue: isOver,
        daysRemaining: days,
        ownerName: o.owner || "Unassigned",
        ownerResponse: o.ownerResponse || (o.updates && o.updates.length ? o.updates[o.updates.length - 1].note : undefined),
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
      {/* Header & Subnav Tabs */}
      <div className="card" style={{ padding: "16px 20px" }}>
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="hint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, color: "var(--navy2)" }}>
              Department Observations
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: 22, color: "var(--ink)" }}>
              {cleanDeptName}
            </h2>
          </div>

          {/* Internal vs External Toggle Tabs */}
          <div className="seg" role="tablist">
            <Link
              href={`/departments/${deptSlug}/internal`}
              className={`seg-btn ${type === "internal" ? "active" : ""}`}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>Internal observations</span>
              <span className="pill" style={{ fontSize: 11, padding: "1px 6px", background: type === "internal" ? "rgba(255,255,255,0.25)" : "#e6eeeb" }}>
                {stats.internal.all.length}
              </span>
            </Link>
            <Link
              href={`/departments/${deptSlug}/external`}
              className={`seg-btn ${type === "external" ? "active" : ""}`}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>External observations</span>
              <span className="pill" style={{ fontSize: 11, padding: "1px 6px", background: type === "external" ? "rgba(255,255,255,0.25)" : "#e6eeeb" }}>
                {stats.external.all.length}
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* Mini Dashboard Snapshot */}
      <div className="kpis-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Kpi
          label="Total Observations"
          value={totalCount}
          hint={`${type === "internal" ? "Internal audit" : "Regulatory & external"} findings`}
        />
        <Kpi
          label="What Has Been Done"
          value={doneCount}
          hint={`${remRate}% resolved & closed`}
          color="var(--closed)"
        />
        <Kpi
          label="What's Left (Pending)"
          value={pendingCount}
          hint="Under active remediation"
          color="var(--high)"
        />
        <Kpi
          label="Overdue Actions"
          value={overdueCount}
          hint="Remediation date passed"
          color={overdueCount > 0 ? "var(--crit)" : undefined}
        />
      </div>

      {/* Observation Explorer & Detailed Cards */}
      <div className="card">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              {type === "internal" ? "Internal Observations Register" : "External Findings Register"}
            </h3>
            <div className="hint" style={{ marginTop: 2 }}>
              Inspect what was raised, track remediation progress and target dates, and review past completed actions.
            </div>
          </div>

          {/* Workflow Tabs: What's Left vs What Has Been Done */}
          <div className="seg" role="tablist">
            <button
              type="button"
              className={activeFilter === "pending" ? "active" : undefined}
              onClick={() => setActiveFilter("pending")}
            >
              What&rsquo;s Left ({pendingCount})
            </button>
            <button
              type="button"
              className={activeFilter === "done" ? "active" : undefined}
              onClick={() => setActiveFilter("done")}
            >
              What Has Been Done ({doneCount})
            </button>
            <button
              type="button"
              className={activeFilter === "all" ? "active" : undefined}
              onClick={() => setActiveFilter("all")}
            >
              All ({totalCount})
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
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

          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              placeholder={`Search ${cleanDeptName} observations, references, owners…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 12px", fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Observations List */}
        {!filteredItems.length ? (
          <Empty big="✦">
            No observations match this criteria for {cleanDeptName}.
          </Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="card tracker-row"
                style={{
                  margin: 0,
                  padding: "14px 16px",
                  border: "1px solid var(--line)",
                  borderLeft: `4px solid ${
                    item.criticality === "Critical"
                      ? "var(--crit)"
                      : item.criticality === "High"
                        ? "var(--high)"
                        : item.criticality === "Medium" || item.criticality === "Moderate"
                          ? "var(--med)"
                          : "var(--low)"
                  }`,
                  cursor: "pointer",
                }}
                onClick={() => openItem(item)}
              >
                <div className="row" style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: "var(--navy2)" }}>{item.ref}</span>
                      <CritPill c={item.criticality} />
                      <StatusPill s={item.status} />
                      {item.isOverdue && item.status !== "Closed" && (
                        <span className="pill c-Critical" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                          Overdue
                        </span>
                      )}
                      {!item.isOverdue && item.daysRemaining != null && item.daysRemaining <= 14 && item.status !== "Closed" && (
                        <span className="pill c-High" style={{ fontSize: 10.5, padding: "2px 6px" }}>
                          Due in {item.daysRemaining}d
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                      <RowOpen onOpen={() => openItem(item)} label={`Open observation ${item.title}`}>
                        {item.title}
                      </RowOpen>
                    </div>

                    {item.findingDetail ? (
                      <div className="hint" style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {item.findingDetail}
                      </div>
                    ) : null}

                    {item.ownerResponse ? (
                      <div style={{ fontSize: 11.5, color: "#195244", background: "#edf6f3", padding: "6px 10px", borderRadius: 6, marginTop: 6 }}>
                        <b>Latest Progress:</b> {item.ownerResponse.slice(0, 180)}
                        {item.ownerResponse.length > 180 ? "…" : ""}
                      </div>
                    ) : null}
                  </div>

                  {/* Metadata Sidebar: Progress, Remediation Date, Owner */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 200, flexShrink: 0 }}>
                    <div style={{ fontSize: 11.5 }}>
                      <span className="hint">Source:</span> <b>{item.source}</b>
                    </div>
                    <div style={{ fontSize: 11.5 }}>
                      <span className="hint">Action Owner:</span> <b>{item.ownerName}</b>
                    </div>
                    <div style={{ fontSize: 11.5 }}>
                      <span className="hint">Remediation Date:</span>{" "}
                      <b>{item.remediationDate || "Not set"}</b>
                    </div>
                    {item.raisedDate ? (
                      <div style={{ fontSize: 11 }}>
                        <span className="hint">Raised:</span> {item.raisedDate}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
