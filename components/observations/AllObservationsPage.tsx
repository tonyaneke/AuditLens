"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { CritPill, Empty, Kpi, StatusPill } from "@/components/ui";
import { deptLabel, deptNameOf } from "@/lib/dept-scope";
import { esc, excelDoc, stamp } from "@/lib/client/exports";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import { effectiveRole } from "@/lib/permissions";
import {
  allObs,
  ck,
  closeBucketOf,
  CLOSE_BUCKETS,
  CRITS,
  CRIT_HEX,
  daysToClose,
  effectiveClose,
  fmtDate,
  fmtDateTime,
  isoToDate,
  isOverdueObs,
  obsAge,
  obsIsApproved,
  STATUSES,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function AllObservationsPage() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isExecutive = effectiveRole(user) === "executive";

  useEffect(() => {
    if (!isExecutive) {
      router.replace("/");
    }
  }, [isExecutive, router]);

  // Read initial filter from URL if passed (e.g. ?crit=Critical or ?timeline=overdue)
  const initialCrit = searchParams.get("crit") || "All";
  const initialTimeline = searchParams.get("timeline") || "All";

  const [critFilter, setCritFilter] = useState<string>(initialCrit);
  const [timelineFilter, setTimelineFilter] = useState<string>(initialTimeline);
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const sortBy = "severity";
  const sortDesc = true;

  // Sync state if navigation occurs with new search params
  useEffect(() => {
    const c = searchParams.get("crit");
    if (c) setCritFilter(c);
    const t = searchParams.get("timeline");
    if (t) setTimelineFilter(t);
  }, [searchParams]);

  // All approved observations across audits
  const allList: ObsWithContext[] = useMemo(() => {
    return allObs(db).filter(obsIsApproved);
  }, [db]);

  // Overall totals for KPI strip
  const totals = useMemo(() => {
    let critical = 0;
    let high = 0;
    let overdue = 0;
    let openPending = 0;
    let closed = 0;

    for (const o of allList) {
      if (o.criticality === "Critical") critical++;
      if (o.criticality === "High") high++;
      if (o.status === "Closed") {
        closed++;
      } else {
        openPending++;
        if (isOverdueObs(o, o._r)) overdue++;
      }
    }
    return { total: allList.length, critical, high, overdue, openPending, closed };
  }, [allList]);

  // Criticality live counts (for quick tabs)
  const critCounts = useMemo(() => {
    const counts: Record<string, number> = { All: allList.length };
    for (const c of CRITS) counts[c] = 0;
    for (const o of allList) {
      if (counts[o.criticality] != null) counts[o.criticality]++;
      else counts.Moderate = (counts.Moderate || 0) + 1;
    }
    return counts;
  }, [allList]);

  // Filtered observations
  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allList.filter((o) => {
      // 1. Criticality filter
      if (critFilter !== "All" && o.criticality !== critFilter) return false;

      // 2. Status filter
      if (statusFilter !== "All" && (o.status || "Open") !== statusFilter) return false;

      // 3. Department filter
      if (deptFilter !== "All") {
        const d = deptLabel(deptNameOf(db, o));
        if (d !== deptFilter) return false;
      }

      // 4. Owner filter ("who")
      if (ownerFilter !== "All") {
        const primary = String(o.owner || "").trim();
        const secondary = String(o.secondaryOwner || "").trim();
        if (primary !== ownerFilter && secondary !== ownerFilter) return false;
      }

      // 5. Timeline filter
      if (timelineFilter !== "All") {
        const isOver = isOverdueObs(o, o._r);
        const days = daysToClose(o, o._r);
        if (timelineFilter === "overdue" || timelineFilter === "Overdue") {
          if (!isOver) return false;
        } else if (timelineFilter === "due_soon" || timelineFilter === "≤ 2 weeks") {
          if (isOver || days == null || days < 0 || days > 14) return false;
        } else if (timelineFilter === "on_track") {
          if (isOver || (days != null && days >= 0 && days <= 14)) return false;
        } else if (timelineFilter === "closed" || timelineFilter === "Closed") {
          if (o.status !== "Closed") return false;
        } else {
          const bucket = closeBucketOf(o, o._r) ?? "No date";
          if (bucket !== timelineFilter) return false;
        }
      }

      // 6. Search query
      if (query) {
        const matchTitle = (o.title || "").toLowerCase().includes(query);
        const matchRef = (o.ref || "").toLowerCase().includes(query);
        const matchOwner = (o.owner || "").toLowerCase().includes(query);
        const matchDesc = (o.description || "").toLowerCase().includes(query);
        const matchDept = (deptNameOf(db, o) || "").toLowerCase().includes(query);
        if (!matchTitle && !matchRef && !matchOwner && !matchDesc && !matchDept) return false;
      }

      return true;
    });
  }, [allList, critFilter, statusFilter, deptFilter, ownerFilter, timelineFilter, searchQuery, db]);

  // Sorted list
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let res = 0;
      if (sortBy === "severity") {
        const rankA = CRITS.indexOf(a.criticality);
        const rankB = CRITS.indexOf(b.criticality);
        res = rankA - rankB;
      } else if (sortBy === "due") {
        const da = daysToClose(a, a._r);
        const dbb = daysToClose(b, b._r);
        if (da == null && dbb == null) res = 0;
        else if (da == null) res = 1;
        else if (dbb == null) res = -1;
        else res = da - dbb;
      } else if (sortBy === "age") {
        const ageA = obsAge(a, a._r) ?? -1;
        const ageB = obsAge(b, b._r) ?? -1;
        res = ageA - ageB;
      } else {
        res = String(a.title || "").localeCompare(String(b.title || ""));
      }
      return sortDesc ? res : -res;
    });
  }, [filtered, sortBy, sortDesc]);

  function navigateToObs(o: ObsWithContext) {
    const href = hrefForView("observation", {
      audit: o._a.id,
      report: o._r.id,
      obs: o.id,
    });
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  function exportExcel() {
    if (!sorted.length) return;
    const CRIT_BG: Record<string, [string, string]> = {
      Critical: ["#f6dde0", "#7a0012"],
      High: ["#fdecef", "#b00020"],
      Moderate: ["#fdefe6", "#e8590c"],
      Low: ["#eaf5eb", "#2e7d32"],
      "Process Improvement": ["#e7eef5", "#2c5f8a"],
    };
    const STATUS_BG: Record<string, [string, string]> = {
      Open: ["#fdecef", "#b00020"],
      "In Progress": ["#fff3e6", "#a15c00"],
      Closed: ["#eaf5eb", "#2e7d32"],
    };
    const headers = [
      "Ref",
      "Severity",
      "Observation",
      "Department",
      "Action Owner",
      "Co-owner",
      "Audit",
      "Report",
      "Expected Close",
      "Status",
      "Overdue",
      "Age (Days)",
      "Created",
    ];
    const cell = (v: string, style = "") => `<td${style ? ` style="${style}"` : ""}>${esc(v)}</td>`;
    const rowsHtml = sorted
      .map((o) => {
        const ec = effectiveClose(o, o._r);
        const od = isOverdueObs(o, o._r);
        const cb = CRIT_BG[o.criticality] || ["#ffffff", "#1c2733"];
        const sb = STATUS_BG[String(o.status || "Open")] || ["#ffffff", "#1c2733"];
        const dept = deptLabel(deptNameOf(db, o)) || "—";
        return `<tr>${[
          cell(o.ref || ""),
          cell(o.criticality || "", `background:${cb[0]};color:${cb[1]};font-weight:bold;text-align:center`),
          cell(o.title || "", "font-weight:bold"),
          cell(dept),
          cell(o.owner ? String(o.owner) : "—"),
          cell(o.secondaryOwner ? String(o.secondaryOwner) : "—"),
          cell(o._a?.name || ""),
          cell(o._r?.title || ""),
          cell(ec ? fmtDate(ec) : ""),
          cell(String(o.status || "Open"), `background:${sb[0]};color:${sb[1]};font-weight:bold;text-align:center`),
          cell(od ? "OVERDUE" : "No", od ? "background:#b00020;color:#ffffff;font-weight:bold;text-align:center" : ""),
          cell(String(obsAge(o, o._r) ?? "—")),
          cell(o.createdAt ? fmtDateTime(o.createdAt) : ""),
        ].join("")}</tr>`;
      })
      .join("");

    const table = `<table>
      <tr><th colspan="${headers.length}" style="background:#0d5a47;color:#ffffff;font-size:13pt;text-align:left;padding:8pt">
        ${esc(db.org || "AuditLens")} — Observations Register (${sorted.length} records) · Exported ${esc(fmtDate(new Date()))}
      </th></tr>
      <tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr>
      ${rowsHtml}
    </table>`;
    excelDoc("AuditLens-Observations-Register-" + stamp(), table);
  }

  usePageChrome({
    title: "Observations",
    actions: (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn sec sm" type="button" onClick={exportExcel} disabled={!sorted.length}>
          ⤓ Export to Excel
        </button>
      </div>
    ),
  });

  const isFiltered =
    critFilter !== "All" ||
    timelineFilter !== "All" ||
    statusFilter !== "All" ||
    deptFilter !== "All" ||
    ownerFilter !== "All" ||
    searchQuery.trim().length > 0;

  function clearFilters() {
    setCritFilter("All");
    setTimelineFilter("All");
    setStatusFilter("All");
    setDeptFilter("All");
    setOwnerFilter("All");
    setSearchQuery("");
  }

  if (!isExecutive) {
    return null;
  }

  return (
    <div className="anim-fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Overview KPI Cards */}
      <div
        className="kpis-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <Kpi tone="base" label="Total Observations" value={totals.total} sub="Full register" icon="audit" />
        <Kpi
          tone="warn"
          label="Critical"
          value={totals.critical}
          sub="Severe risk findings"
          icon="alert"
        />
        <Kpi
          tone="accent"
          label="High Risk"
          value={totals.high}
          sub="Priority actions"
          icon="alert"
        />
        <Kpi
          tone={totals.overdue > 0 ? "warn" : "base"}
          label="Overdue Actions"
          value={totals.overdue}
          sub="Target date passed"
          icon="alert"
        />
        <Kpi tone="base" label="Pending" value={totals.openPending} sub="Open & In Progress" icon="obs" />
        <Kpi tone="good" label="Closed" value={totals.closed} sub="Remediated & verified" icon="check" />
      </div>

      {/* Main Register Card */}
      <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Severity Quick Tabs */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--line, #e2e8f0)",
            background: "var(--card-subtle, #f8fafc)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginRight: 4 }}>
              Severity:
            </span>
            <button
              type="button"
              className={`btn ${critFilter === "All" ? "pri" : "ghost"} sm`}
              style={{ fontSize: 12, padding: "4px 12px", borderRadius: 16, height: "auto" }}
              onClick={() => setCritFilter("All")}
            >
              All ({critCounts.All || 0})
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 16,
                height: "auto",
                fontWeight: 700,
                background: critFilter === "Critical" ? "#7a0012" : "#f6dde0",
                color: critFilter === "Critical" ? "#ffffff" : "#7a0012",
                border: "none",
              }}
              onClick={() => setCritFilter("Critical")}
            >
              Critical ({critCounts.Critical || 0})
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 16,
                height: "auto",
                fontWeight: 700,
                background: critFilter === "High" ? "#b00020" : "#fdecef",
                color: critFilter === "High" ? "#ffffff" : "#b00020",
                border: "none",
              }}
              onClick={() => setCritFilter("High")}
            >
              High ({critCounts.High || 0})
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 16,
                height: "auto",
                fontWeight: 600,
                background: critFilter === "Moderate" ? "#e8590c" : "#fdefe6",
                color: critFilter === "Moderate" ? "#ffffff" : "#e8590c",
                border: "none",
              }}
              onClick={() => setCritFilter("Moderate")}
            >
              Moderate ({critCounts.Moderate || 0})
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 16,
                height: "auto",
                fontWeight: 600,
                background: critFilter === "Low" ? "#2e7d32" : "#eaf5eb",
                color: critFilter === "Low" ? "#ffffff" : "#2e7d32",
                border: "none",
              }}
              onClick={() => setCritFilter("Low")}
            >
              Low ({critCounts.Low || 0})
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 16,
                height: "auto",
                fontWeight: 600,
                background: critFilter === "Process Improvement" ? "#2c5f8a" : "#e7eef5",
                color: critFilter === "Process Improvement" ? "#ffffff" : "#2c5f8a",
                border: "none",
              }}
              onClick={() => setCritFilter("Process Improvement")}
            >
              Process Improvement ({critCounts["Process Improvement"] || 0})
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hint" style={{ fontSize: 12.5 }}>
              Showing <b>{sorted.length}</b> of <b>{allList.length}</b>
            </span>
            {isFiltered && (
              <button
                type="button"
                className="btn ghost sm"
                style={{ fontSize: 11.5, height: "auto", padding: "2px 8px" }}
                onClick={clearFilters}
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--line, #e2e8f0)",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Search box */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <input
              type="text"
              className="field"
              placeholder="Search by title, ref, owner, department, description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: 12.5, height: 32, margin: 0 }}
            />
          </div>

          {/* Timeline Dropdown */}
          <div className="filter-group" style={{ margin: 0 }}>
            <span className="filter-label" id="flt-timeline">Timeline</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="flt-timeline"
              value={timelineFilter}
              onChange={(e) => setTimelineFilter(e.target.value)}
            >
              <option value="All">All Timelines</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due Soon (≤ 2 weeks)</option>
              <option value="on_track">On Track (&gt; 2 weeks)</option>
              <option value="closed">Closed</option>
              {CLOSE_BUCKETS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
              <option value="No date">No date</option>
            </select>
          </div>

          {/* Status Dropdown */}
          <div className="filter-group" style={{ margin: 0 }}>
            <span className="filter-label" id="flt-status">Status</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="flt-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="All">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Department Dropdown */}
          <div className="filter-group" style={{ margin: 0 }}>
            <span className="filter-label" id="flt-dept">Department</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="flt-dept"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="All">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Owner / Who Dropdown */}
          <div className="filter-group" style={{ margin: 0 }}>
            <span className="filter-label" id="flt-owner">Who (Owner)</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="flt-owner"
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
            >
              <option value="All">All Owners</option>
              {owners.map((ow) => (
                <option key={ow} value={ow}>{ow}</option>
              ))}
            </select>
          </div>

          {/* Sort By Dropdown */}
          <div className="filter-group" style={{ margin: 0 }}>
            <span className="filter-label" id="flt-sort">Sort</span>
            <select
              className="field-select field-select-sm"
              aria-labelledby="flt-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="severity">Severity (High to Low)</option>
              <option value="due">Target Date</option>
              <option value="age">Age</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>

        {/* Observations Table */}
        {!sorted.length ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <Empty big="✦">
              No observations match the selected criteria.
              {isFiltered && (
                <div style={{ marginTop: 14 }}>
                  <button type="button" className="btn sec sm" onClick={clearFilters}>
                    Clear all filters
                  </button>
                </div>
              )}
            </Empty>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 80 }}>Ref</th>
                  <th scope="col" style={{ width: 110 }}>Severity</th>
                  <th scope="col">Observation Title &amp; Audit</th>
                  <th scope="col" style={{ width: 140 }}>Department</th>
                  <th scope="col" style={{ width: 160 }}>Who (Action Owner)</th>
                  <th scope="col" style={{ width: 130 }}>Expected Close</th>
                  <th scope="col" style={{ width: 80 }}>Age</th>
                  <th scope="col" style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((o) => {
                  const ec = effectiveClose(o, o._r);
                  const isOver = isOverdueObs(o, o._r);
                  const days = daysToClose(o, o._r);
                  const age = obsAge(o, o._r);
                  const dept = deptLabel(deptNameOf(db, o)) || "—";
                  const primaryOwner = o.owner || "Unassigned";

                  return (
                    <tr
                      key={o.id}
                      className="tracker-row"
                      onClick={() => navigateToObs(o)}
                      title="Click to view full observation detail"
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ whiteSpace: "nowrap", fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>
                        {o.ref || "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <CritPill crit={o.criticality} />
                      </td>
                      <td>
                        <div>
                          <b style={{ fontSize: 13, color: "var(--ink)", display: "block" }}>{o.title}</b>
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            {o._a?.name} · {o._r?.title}
                          </span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span
                          className="pill"
                          style={{
                            background: "#edf4f1",
                            color: "#19302a",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {dept}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Avatar user={{ name: primaryOwner }} size={20} />
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", display: "block" }}>
                              {primaryOwner}
                            </span>
                            {o.secondaryOwner ? (
                              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                                Co: {String(o.secondaryOwner)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {o.status === "Closed" ? (
                          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                            {o.closedDateISO ? fmtDate(isoToDate(o.closedDateISO)) : "Closed"}
                          </span>
                        ) : isOver ? (
                          <span className="pill c-Critical" style={{ fontSize: 10.5, fontWeight: 700 }}>
                            OVERDUE
                          </span>
                        ) : days != null && days >= 0 && days <= 14 ? (
                          <span className="pill c-Moderate" style={{ fontSize: 10.5, fontWeight: 600 }}>
                            {days === 0 ? "Due today" : `${days}d left`}
                          </span>
                        ) : ec ? (
                          <span style={{ fontSize: 12, color: "var(--ink)" }}>{fmtDate(ec)}</span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--muted)" }}>
                        {age != null ? `${age}d` : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <StatusPill status={o.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
