"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { CritPill, Empty, Kpi, RowOpen, StatusPill } from "@/components/ui";
import { DEPARTMENTS } from "@/components/settings/staff";
import { departmentToSlug, getDepartmentStats, type DepartmentStats } from "@/lib/dept-slugs";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import {
  allObs,
  daysToClose,
  effectiveClose,
  extList,
  extOverdue,
  fmtDate,
  isOverdueObs,
  obsIsApproved,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { deptNameOf } from "@/lib/dept-scope";

type UnifiedObservation = {
  id: string;
  type: "Internal" | "External";
  ref: string;
  title: string;
  department: string;
  departmentSlug: string;
  criticality: string;
  status: string;
  targetDate?: string;
  isOverdue: boolean;
  daysDiff: number | null;
  ownerName: string;
  source: string;
  rawInternal?: ObsWithContext;
  rawExternal?: ExtFinding;
};

export default function ExecutiveDashboard() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"pending" | "done" | "all">("pending");
  const [deptFilter, setDeptFilter] = useState<string>("All");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [search, setSearch] = useState<string>("");

  // Compile stats across all departments
  const departmentSummaries: DepartmentStats[] = useMemo(() => {
    return DEPARTMENTS.map((dept) => getDepartmentStats(db, dept));
  }, [db]);

  // Overall totals across all departments
  const overallTotals = useMemo(() => {
    let total = 0;
    let done = 0;
    let pending = 0;
    let overdue = 0;
    let internalTotal = 0;
    let externalTotal = 0;
    let critHighTotal = 0;

    for (const d of departmentSummaries) {
      total += d.totals.total;
      done += d.totals.done;
      pending += d.totals.pending;
      overdue += d.totals.overdue;
      internalTotal += d.internal.all.length;
      externalTotal += d.external.all.length;

      critHighTotal += d.internal.all.filter(
        (o) => o.criticality === "Critical" || o.criticality === "High",
      ).length;
      critHighTotal += d.external.all.filter(
        (f) => f.severity === "Critical" || f.severity === "High",
      ).length;
    }

    const rate = total > 0 ? Math.round((done / total) * 100) : 100;
    return {
      total,
      done,
      pending,
      overdue,
      internalTotal,
      externalTotal,
      critHighTotal,
      rate,
    };
  }, [departmentSummaries]);

  // Unified list of all observations
  const allObservations: UnifiedObservation[] = useMemo(() => {
    const list: UnifiedObservation[] = [];

    // Internal observations
    const approvedObs = allObs(db).filter(obsIsApproved);
    for (const o of approvedObs) {
      const deptName = deptNameOf(db, o) || "Unassigned";
      const dt = effectiveClose(o, o._r);
      const days = daysToClose(o, o._r);
      const isOver = isOverdueObs(o, o._r);

      list.push({
        id: o.id,
        type: "Internal",
        ref: o.code || `OBS-${o.id.slice(-4)}`,
        title: o.title || "Untitled observation",
        department: deptName,
        departmentSlug: departmentToSlug(deptName),
        criticality: o.criticality || "Moderate",
        status: o.status || "Open",
        targetDate: dt ? fmtDate(dt) : undefined,
        isOverdue: isOver,
        daysDiff: days,
        ownerName: o.owner || "Unassigned",
        source: o._r?.title ? `${o._a?.title || "Audit"} · ${o._r.title}` : o._a?.title || "Internal Audit",
        rawInternal: o,
      });
    }

    // External findings
    const extFindings = extList(db);
    for (const f of extFindings) {
      const deptName = deptNameOf(db, f) || "Unassigned";
      const isOver = extOverdue(f);

      list.push({
        id: f.id,
        type: "External",
        ref: f.ref || f.sourceRef || `EXT-${f.id.slice(-4)}`,
        title: f.title || "Untitled finding",
        department: deptName,
        departmentSlug: departmentToSlug(deptName),
        criticality: f.severity || "Medium",
        status: f.status || "Open",
        targetDate: f.targetDate ? fmtDate(f.targetDate) : undefined,
        isOverdue: isOver,
        daysDiff: null,
        ownerName: f.owner || "Unassigned",
        source: f.source ? `External · ${f.source}` : "External Finding",
        rawExternal: f,
      });
    }

    // Sort: overdue first, then by criticality, then targetDate
    return list.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [db]);

  // Filtered observations
  const filteredObservations = useMemo(() => {
    return allObservations.filter((item) => {
      // Tab filter
      if (activeTab === "pending" && item.status === "Closed") return false;
      if (activeTab === "done" && item.status !== "Closed") return false;

      // Department filter
      if (deptFilter !== "All" && item.department !== deptFilter) return false;

      // Criticality filter
      if (critFilter !== "All" && item.criticality !== critFilter) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchRef = item.ref.toLowerCase().includes(q);
        const matchOwner = item.ownerName.toLowerCase().includes(q);
        const matchDept = item.department.toLowerCase().includes(q);
        if (!matchTitle && !matchRef && !matchOwner && !matchDept) return false;
      }

      return true;
    });
  }, [allObservations, activeTab, deptFilter, critFilter, search]);

  function openObservation(item: UnifiedObservation) {
    if (item.type === "Internal" && item.rawInternal) {
      const o = item.rawInternal;
      const href = hrefForView("observation", {
        audit: o._a.id,
        report: o._r.id,
        obs: o.id,
      });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    } else if (item.type === "External" && item.rawExternal) {
      const href = hrefForView("extfinding", { ext: item.rawExternal.id });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Executive Welcome & Header */}
      <div className="card" style={{ background: "linear-gradient(135deg, #0d5a47 0%, #153e34 100%)", color: "#fff", padding: "20px 24px" }}>
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#9ac2b5" }}>
              Executive Governance &amp; Oversight
            </div>
            <h2 style={{ margin: "4px 0 2px", color: "#fff", fontSize: 20 }}>
              Welcome, {user.name}
            </h2>
            <div style={{ fontSize: 13, color: "#d2e5df", maxWidth: 650 }}>
              Full cross-department overview of audit observations, remediation progress, and pending governance matters.
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Link href="/exco" className="btn sm" style={{ background: "#fff", color: "#0d5a47", fontWeight: 600 }}>
              Executive Assurance Brief →
            </Link>
          </div>
        </div>
      </div>

      {/* Top Governance KPI Cards */}
      <div className="kpis-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Kpi
          label="Total Observations"
          value={overallTotals.total}
          hint={`${overallTotals.internalTotal} internal · ${overallTotals.externalTotal} external`}
        />
        <Kpi
          label="What Has Been Done"
          value={overallTotals.done}
          hint={`${overallTotals.rate}% overall remediation rate`}
          color="var(--closed)"
        />
        <Kpi
          label="What's Left (Pending)"
          value={overallTotals.pending}
          hint="Open &amp; In Progress"
          color="var(--high)"
        />
        <Kpi
          label="Overdue Actions"
          value={overallTotals.overdue}
          hint="Target date passed"
          color={overallTotals.overdue > 0 ? "var(--crit)" : undefined}
        />
        <Kpi
          label="Critical &amp; High"
          value={overallTotals.critHighTotal}
          hint="High severity matters"
          color="var(--crit)"
        />
      </div>

      {/* Governance Matrix: Departments Overview */}
      <div className="card">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Departments Governance Matrix</h3>
            <div className="hint" style={{ marginTop: 2 }}>
              Overview of observation workload, remediation rate, and pending actions across all 13 departments.
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col" style={{ textAlign: "center" }}>Total</th>
                <th scope="col" style={{ textAlign: "center" }}>Done (Closed)</th>
                <th scope="col" style={{ textAlign: "center" }}>What&rsquo;s Left</th>
                <th scope="col" style={{ textAlign: "center" }}>Overdue</th>
                <th scope="col" style={{ minWidth: 140 }}>Progress</th>
                <th scope="col">Status</th>
                <th scope="col" style={{ textAlign: "right" }}>Explore</th>
              </tr>
            </thead>
            <tbody>
              {departmentSummaries.map((ds) => {
                const cleanName = ds.department.replace(/\s+Department$/i, "");
                return (
                  <tr key={ds.department} className="tracker-row">
                    <td>
                      <Link
                        href={`/departments/${ds.slug}/internal`}
                        style={{ color: "inherit", textDecoration: "none" }}
                      >
                        <b>{cleanName}</b>
                      </Link>
                    </td>
                    <td style={{ textAlign: "center", fontWeight: 600 }}>
                      {ds.totals.total}
                    </td>
                    <td style={{ textAlign: "center", color: "var(--closed)", fontWeight: 600 }}>
                      {ds.totals.done}
                    </td>
                    <td style={{ textAlign: "center", color: ds.totals.pending > 0 ? "var(--high)" : undefined, fontWeight: 600 }}>
                      {ds.totals.pending}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {ds.totals.overdue > 0 ? (
                        <span className="pill c-Critical" style={{ fontSize: 11, padding: "2px 6px" }}>
                          {ds.totals.overdue}
                        </span>
                      ) : (
                        <span className="hint">0</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background: "#e2ece8",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${ds.totals.rate}%`,
                              height: "100%",
                              background:
                                ds.totals.rate >= 80
                                  ? "var(--closed)"
                                  : ds.totals.rate >= 50
                                    ? "var(--med)"
                                    : "var(--high)",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 28, textAlign: "right" }}>
                          {ds.totals.rate}%
                        </span>
                      </div>
                    </td>
                    <td>
                      {ds.health === "good" ? (
                        <span className="pill c-Low" style={{ fontSize: 11 }}>Good</span>
                      ) : ds.health === "attention" ? (
                        <span className="pill c-High" style={{ fontSize: 11 }}>Attention</span>
                      ) : (
                        <span className="pill sop-pending-pill" style={{ fontSize: 11 }}>In Progress</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                        <Link
                          href={`/departments/${ds.slug}/internal`}
                          className="btn sec sm"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          title="View Internal Observations"
                        >
                          Internal ({ds.internal.pending.length})
                        </Link>
                        <Link
                          href={`/departments/${ds.slug}/external`}
                          className="btn sec sm"
                          style={{ padding: "3px 8px", fontSize: 11 }}
                          title="View External Observations"
                        >
                          External ({ds.external.pending.length})
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Snapshot of Observations: What's Left vs What Has Been Done */}
      <div className="card">
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Observations Snapshot</h3>
            <div className="hint" style={{ marginTop: 2 }}>
              Inspect observations raised across all departments, track remediation dates, and see past resolutions.
            </div>
          </div>
          {/* Tabs */}
          <div className="seg" role="tablist">
            <button
              type="button"
              className={activeTab === "pending" ? "active" : undefined}
              onClick={() => setActiveTab("pending")}
            >
              What&rsquo;s Left ({overallTotals.pending})
            </button>
            <button
              type="button"
              className={activeTab === "done" ? "active" : undefined}
              onClick={() => setActiveTab("done")}
            >
              What Has Been Done ({overallTotals.done})
            </button>
            <button
              type="button"
              className={activeTab === "all" ? "active" : undefined}
              onClick={() => setActiveTab("all")}
            >
              All ({overallTotals.total})
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="row" style={{ gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label">Department</span>
            <select
              className="field-select field-select-sm"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="All">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

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
              placeholder="Search observations, references, owners…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 12px", fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* Observations Table */}
        {!filteredObservations.length ? (
          <Empty big="✓">
            No observations match the selected criteria.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Ref &amp; Criticality</th>
                  <th scope="col">What Was Raised</th>
                  <th scope="col">Department</th>
                  <th scope="col">Progress</th>
                  <th scope="col">Remediation Date</th>
                  <th scope="col">Owner</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {filteredObservations.slice(0, 100).map((item) => (
                  <tr
                    key={`${item.type}-${item.id}`}
                    className="tracker-row"
                    onClick={() => openObservation(item)}
                    title="Click to view details"
                  >
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{item.ref}</span>
                        <CritPill c={item.criticality} />
                      </div>
                      <div className="hint" style={{ fontSize: 10.5, marginTop: 2 }}>
                        {item.type} finding
                      </div>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <RowOpen onOpen={() => openObservation(item)} label={`Open ${item.title}`}>
                        <b>{item.title}</b>
                      </RowOpen>
                      <div className="hint" style={{ fontSize: 11, marginTop: 2 }}>
                        {item.source}
                      </div>
                    </td>
                    <td>
                      <span className="pill" style={{ background: "#edf4f1", color: "#19302a", fontSize: 11 }}>
                        {item.department.replace(/\s+Department$/i, "")}
                      </span>
                    </td>
                    <td>
                      <StatusPill s={item.status} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {item.targetDate ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{item.targetDate}</div>
                          {item.status !== "Closed" && (
                            item.isOverdue ? (
                              <span className="pill c-Critical" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}>
                                Overdue
                              </span>
                            ) : item.daysDiff != null && item.daysDiff <= 14 ? (
                              <span className="pill c-High" style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}>
                                Due in {item.daysDiff}d
                              </span>
                            ) : null
                          )}
                        </div>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>{item.ownerName}</div>
                    </td>
                    <td className="ra-actions-cell">
                      <button
                        className="btn-icon-action"
                        type="button"
                        title="View details"
                        onClick={(e) => {
                          e.stopPropagation();
                          openObservation(item);
                        }}
                      >
                        ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
