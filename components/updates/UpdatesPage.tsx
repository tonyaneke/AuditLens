"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { CritPill, Empty, Kpi, StatusPill } from "@/components/ui";
import { DEPARTMENTS } from "@/components/settings/staff";
import { deptNameOf } from "@/lib/dept-scope";
import { departmentToSlug } from "@/lib/dept-slugs";
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
  timeAgo,
  uid,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

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

type ActivityItem = {
  id: string;
  kind: "closure" | "update" | "response";
  title: string;
  ref: string;
  department: string;
  criticality: string;
  status: string;
  actor: string;
  dateStr: string;
  dateISO: string;
  text: string;
  source: string;
  rawItem: UnifiedObservation;
};

export default function UpdatesPage() {
  usePageChrome({ title: "Remediation Activity & Latest Updates" });
  const { db } = useWorkspace();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"all" | "closure" | "update" | "response">("all");
  const [deptFilter, setDeptFilter] = useState<string>("All");
  const [critFilter, setCritFilter] = useState<string>("All");
  const [search, setSearch] = useState<string>("");

  // Extract all approved internal observations and external findings
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
        ref: String(o.ref || `OBS-${o.id.slice(-4)}`),
        title: o.title || "Untitled observation",
        department: deptName,
        departmentSlug: departmentToSlug(deptName),
        criticality: o.criticality || "Moderate",
        status: o.status || "Open",
        targetDate: dt ? fmtDate(dt) : undefined,
        isOverdue: isOver,
        daysDiff: days,
        ownerName: o.owner || "Unassigned",
        source: String(o._r?.title ? `${o._a?.name || "Audit"} · ${o._r.title}` : o._a?.name || "Internal Audit"),
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
        title: f.title || "Untitled Finding",
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

    return list;
  }, [db]);

  // Full chronological activity items across all observations
  const allActivities: ActivityItem[] = useMemo(() => {
    const list: ActivityItem[] = [];

    for (const obs of allObservations) {
      if (obs.type === "Internal" && obs.rawInternal) {
        const raw = obs.rawInternal;

        // Verified closures
        if (raw.status === "Closed" && raw.closedDateISO) {
          list.push({
            id: `cl-${raw.id}`,
            kind: "closure",
            title: raw.title || "Untitled observation",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            status: obs.status,
            actor: raw.headVerifiedByName || raw.verifiedBy || "Internal Audit",
            dateStr: fmtDate(raw.closedDateISO),
            dateISO: raw.closedDateISO,
            text: raw.closureNote || "Observation remediated and verified closed by Internal Audit.",
            source: obs.source,
            rawItem: obs,
          });
        }

        // Progress updates
        if (raw.updates && raw.updates.length > 0) {
          for (const u of raw.updates) {
            list.push({
              id: `up-${u.id || uid()}`,
              kind: "update",
              title: raw.title || "Untitled observation",
              ref: obs.ref,
              department: obs.department,
              criticality: obs.criticality,
              status: obs.status,
              actor: u.byName || u.by || raw.owner || "Action Owner",
              dateStr: u.at ? fmtDate(u.at) : "",
              dateISO: u.at || "",
              text: u.text || "Remediation progress update submitted.",
              source: obs.source,
              rawItem: obs,
            });
          }
        }

        // Initial Owner Response
        if (raw.ownerResponse) {
          const dt = effectiveClose(raw, raw._r);
          list.push({
            id: `resp-${raw.id}`,
            kind: "response",
            title: raw.title || "Untitled observation",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            status: obs.status,
            actor: raw.owner || "Action Owner",
            dateStr: dt ? fmtDate(dt) : "",
            dateISO: dt ? dt.toISOString() : "",
            text: raw.ownerResponse,
            source: obs.source,
            rawItem: obs,
          });
        }
      } else if (obs.type === "External" && obs.rawExternal) {
        const raw = obs.rawExternal;

        // External verified closures
        if (raw.status === "Closed" && raw.closedDateISO) {
          list.push({
            id: `ext-cl-${raw.id}`,
            kind: "closure",
            title: raw.title || "Untitled Finding",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            status: obs.status,
            actor: raw.verifiedBy || "Compliance / External Audit",
            dateStr: fmtDate(raw.closedDateISO),
            dateISO: raw.closedDateISO,
            text: raw.closureEvidence || "External audit finding remediated and verified closed.",
            source: obs.source,
            rawItem: obs,
          });
        }

        // External management responses
        if (raw.ownerResponse || raw.managementResponse) {
          list.push({
            id: `ext-resp-${raw.id}`,
            kind: "response",
            title: raw.title || "Untitled Finding",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            status: obs.status,
            actor: raw.owner || "Management",
            dateStr: raw.targetDate ? fmtDate(raw.targetDate) : "",
            dateISO: raw.targetDate || "",
            text: raw.ownerResponse || raw.managementResponse || "Management response recorded.",
            source: obs.source,
            rawItem: obs,
          });
        }
      }
    }

    return list.sort((a, b) => {
      const da = a.dateISO ? new Date(a.dateISO).getTime() : 0;
      const db = b.dateISO ? new Date(b.dateISO).getTime() : 0;
      return db - da;
    });
  }, [allObservations]);

  // Counts by kind
  const { closureCount, updateCount, responseCount } = useMemo(() => {
    let closureCount = 0;
    let updateCount = 0;
    let responseCount = 0;
    for (const a of allActivities) {
      if (a.kind === "closure") closureCount++;
      else if (a.kind === "update") updateCount++;
      else if (a.kind === "response") responseCount++;
    }
    return { closureCount, updateCount, responseCount };
  }, [allActivities]);

  // Filtered activities
  const filteredActivities = useMemo(() => {
    return allActivities.filter((item) => {
      // Tab filter
      if (activeTab !== "all" && item.kind !== activeTab) return false;

      // Department filter
      if (deptFilter !== "All" && item.department !== deptFilter) return false;

      // Criticality filter
      if (critFilter !== "All" && item.criticality !== critFilter) return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchRef = item.ref.toLowerCase().includes(q);
        const matchText = item.text.toLowerCase().includes(q);
        const matchActor = item.actor.toLowerCase().includes(q);
        const matchDept = item.department.toLowerCase().includes(q);
        if (!matchTitle && !matchRef && !matchText && !matchActor && !matchDept) return false;
      }

      return true;
    });
  }, [allActivities, activeTab, deptFilter, critFilter, search]);

  // Navigate to observation
  function openObservation(rawItem: UnifiedObservation) {
    if (rawItem.type === "Internal" && rawItem.rawInternal) {
      const o = rawItem.rawInternal;
      const href = hrefForView("observation", {
        audit: o._a.id,
        report: o._r.id,
        obs: o.id,
      });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    } else if (rawItem.type === "External" && rawItem.rawExternal) {
      const href = hrefForView("extfinding", { ext: rawItem.rawExternal.id });
      if (isLegacyPath(href)) window.location.assign(href);
      else router.push(href);
    }
  }

  const isFiltered = deptFilter !== "All" || critFilter !== "All" || search.trim().length > 0 || activeTab !== "all";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header Breadcrumb & Controls */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
            Remediation Activity &amp; Latest Updates
          </h2>
          <div className="hint" style={{ marginTop: 2, fontSize: 13 }}>
            Full chronological activity feed of verified closures, progress updates, and owner responses across all departments.
          </div>
        </div>

        <Link
          href="/"
          className="btn ghost sm"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span>Return to Dashboard</span>
        </Link>
      </div>

      {/* Summary KPI Cards */}
      <div
        className="kpis-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <Kpi
          tone="base"
          label="Total Activity Logs"
          value={allActivities.length}
          sub="Remediation history recorded"
          icon="audit"
        />
        <Kpi
          tone="good"
          label="Verified Closures"
          value={closureCount}
          sub="Resolved & closed by IA"
          icon="check"
        />
        <Kpi
          tone="accent"
          label="Progress Updates"
          value={updateCount}
          sub="Action owner submissions"
          icon="obs"
        />
        <Kpi
          tone="warn"
          label="Management Responses"
          value={responseCount}
          sub="Formal action owner responses"
          icon="alert"
        />
      </div>

      {/* Toolbar: Workflow Tabs, Department, Criticality, and Search */}
      <div
        className="card"
        style={{
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div
          className="row"
          style={{
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Segmented Controls for Activity Kind */}
          <div
            style={{
              display: "inline-flex",
              background: "var(--surface-subtle, #eef2f0)",
              padding: 3,
              borderRadius: 8,
              gap: 3,
              border: "1px solid var(--line, #e2e8f0)",
              flexWrap: "wrap",
            }}
            role="tablist"
          >
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              style={{
                border: "none",
                background: activeTab === "all" ? "#fff" : "transparent",
                color: activeTab === "all" ? "var(--brand-700, #0a4a3b)" : "var(--muted, #64748b)",
                fontWeight: activeTab === "all" ? 700 : 500,
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: activeTab === "all" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              All ({allActivities.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("closure")}
              style={{
                border: "none",
                background: activeTab === "closure" ? "#fff" : "transparent",
                color: activeTab === "closure" ? "var(--closed, #2e7d32)" : "var(--muted, #64748b)",
                fontWeight: activeTab === "closure" ? 700 : 500,
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: activeTab === "closure" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              Verified Closures ({closureCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("update")}
              style={{
                border: "none",
                background: activeTab === "update" ? "#fff" : "transparent",
                color: activeTab === "update" ? "#2c5f8a" : "var(--muted, #64748b)",
                fontWeight: activeTab === "update" ? 700 : 500,
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: activeTab === "update" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              Progress Updates ({updateCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("response")}
              style={{
                border: "none",
                background: activeTab === "response" ? "#fff" : "transparent",
                color: activeTab === "response" ? "#b06000" : "var(--muted, #64748b)",
                fontWeight: activeTab === "response" ? 700 : 500,
                fontSize: 12,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                boxShadow: activeTab === "response" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              Management Responses ({responseCount})
            </button>
          </div>

          {/* Quick Clear Button */}
          {isFiltered ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setActiveTab("all");
                setDeptFilter("All");
                setCritFilter("All");
                setSearch("");
              }}
              style={{ fontSize: 11.5 }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {/* Filters Row: Department, Criticality, and Search */}
        <div
          className="row"
          style={{
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
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
                  {d.replace(/\s+Department$/i, "")}
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

          <div style={{ flex: 1, minWidth: 240 }}>
            <input
              type="text"
              placeholder="Search updates, notes, findings, actors, or departments…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "6px 12px", fontSize: 12.5 }}
            />
          </div>
        </div>
      </div>

      {/* Feed Counter */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="hint" style={{ fontSize: 12.5 }}>
          Showing <b>{filteredActivities.length}</b> of <b>{allActivities.length}</b> total updates
        </span>
      </div>

      {/* Chronological Activity Feed */}
      {!filteredActivities.length ? (
        <div className="card">
          <Empty big="📋">
            No remediation updates or closures match the current filter criteria.
          </Empty>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredActivities.map((act) => {
            const cleanDept = act.department.replace(/\s+Department$/i, "");
            return (
              <div
                key={act.id}
                className="card tracker-row"
                onClick={() => openObservation(act.rawItem)}
                style={{
                  margin: 0,
                  padding: "16px 18px",
                  border: "1px solid var(--line, #e2e8f0)",
                  borderRadius: 12,
                  cursor: "pointer",
                  transition: "box-shadow 0.15s ease, transform 0.15s ease",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
                title={`Open finding: ${act.title}`}
              >
                {/* Top Badge Bar */}
                <div
                  className="row"
                  style={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Kind Pill */}
                    {act.kind === "closure" ? (
                      <span
                        className="pill"
                        style={{
                          background: "#eaf5ec",
                          color: "#1e7e34",
                          fontWeight: 700,
                          fontSize: 11,
                          padding: "2px 8px",
                        }}
                      >
                        ✓ Verified Closed
                      </span>
                    ) : act.kind === "update" ? (
                      <span
                        className="pill"
                        style={{
                          background: "#ebf2fa",
                          color: "#1967d2",
                          fontWeight: 600,
                          fontSize: 11,
                          padding: "2px 8px",
                        }}
                      >
                        ✎ Progress Update
                      </span>
                    ) : (
                      <span
                        className="pill"
                        style={{
                          background: "#fef6e6",
                          color: "#b06000",
                          fontWeight: 600,
                          fontSize: 11,
                          padding: "2px 8px",
                        }}
                      >
                        💬 Management Response
                      </span>
                    )}

                    <span
                      className="tag"
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--navy2)",
                      }}
                    >
                      {act.ref}
                    </span>

                    <CritPill crit={act.criticality} />
                    <span className="tag">{cleanDept}</span>
                    <StatusPill status={act.status} />
                  </div>

                  <span className="hint" style={{ fontSize: 12 }}>
                    {act.dateISO ? `${timeAgo(act.dateISO)} · ${act.dateStr}` : act.dateStr}
                  </span>
                </div>

                {/* Finding Title & Source */}
                <div>
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--ink)",
                      marginBottom: 2,
                      lineHeight: 1.35,
                    }}
                  >
                    {act.title}
                  </div>
                  <div className="hint" style={{ fontSize: 12 }}>
                    Source: {act.source}
                  </div>
                </div>

                {/* Logged Note / Message */}
                <div
                  style={{
                    background: "var(--surface-subtle, #f8faf9)",
                    border: "1px solid #edf2f7",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: 13,
                    color: "var(--ink-secondary, #334155)",
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontStyle: "italic", marginBottom: 6 }}>
                    &ldquo;{act.text}&rdquo;
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <span>
                      {act.kind === "closure" ? "Verified by " : "Logged by "}
                      <b style={{ color: "var(--ink)" }}>{act.actor}</b>
                    </span>
                    <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 11.5 }}>
                      Inspect Observation &rarr;
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
