"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { CritPill, Empty, Kpi } from "@/components/ui";
import { DEPARTMENTS } from "@/components/settings/staff";
import { departmentToSlug, getDepartmentStats, type DepartmentStats } from "@/lib/dept-slugs";
import { getExecutiveTitle } from "@/lib/permissions";
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
  percentages,
  timeAgo,
  uid,
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

function shortDeptName(name: string): string {
  const clean = name.replace(/\s+Department$/i, "").trim();
  if (clean.toLowerCase() === "risk management") return "Risk Mgt";
  if (clean.toLowerCase() === "corporate communications") return "Corp Comms";
  if (clean.toLowerCase() === "credit operations") return "Credit Ops";
  return clean;
}

type ActivityItem = {
  id: string;
  kind: "closure" | "update" | "response";
  title: string;
  ref: string;
  department: string;
  criticality: string;
  actor: string;
  dateStr: string;
  dateISO: string;
  text: string;
  rawItem: UnifiedObservation;
};

const EXEC_CRITS = ["Critical", "High", "Moderate", "Low"] as const;

const SEV_COLOR: Record<string, string> = {
  Critical: "#7a0012",
  High: "#b00020",
  Moderate: "#e8590c",
  Medium: "#e8590c",
  Low: "#2e7d32",
  "Process Improvement": "#2c5f8a",
};

function Donut({
  segs,
  total,
  label,
}: {
  segs: { value: number; color: string }[];
  total: number;
  label: string;
}) {
  const r = 54;
  const C = 2 * Math.PI * r;
  const arcs: { color: string; len: number; off: number; delay: number }[] = [];
  {
    let off = 0;
    let idx = 0;
    for (const s of segs) {
      if (s.value <= 0) continue;
      const len = total ? (s.value / total) * C : 0;
      arcs.push({ color: s.color, len, off, delay: idx * 0.12 });
      off += len;
      idx++;
    }
  }
  return (
    <svg
      className="donut-chart"
      viewBox="0 0 140 140"
      width="144"
      height="144"
      style={{ flexShrink: 0 }}
    >
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth="16" />
      {arcs.map((s, i) => (
        <circle
          key={i}
          className="donut-seg"
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDashoffset={(-s.off).toFixed(2)}
          transform="rotate(-90 70 70)"
          style={{
            ["--seg-len" as string]: s.len.toFixed(2),
            ["--seg-delay" as string]: `${s.delay}s`,
          }}
        />
      ))}
      <text
        className="donut-center-num"
        x="70"
        y="66"
        textAnchor="middle"
        fontSize="28"
        fontWeight="700"
        fill="#0d5a47"
      >
        {total}
      </text>
      <text
        className="donut-center-lbl"
        x="70"
        y="86"
        textAnchor="middle"
        fontSize="11"
        fill="#64748b"
      >
        {label}
      </text>
    </svg>
  );
}

export default function ExecutiveDashboard() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();


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

  // Open High & Critical observations needing executive oversight
  const highCritWatch = useMemo(() => {
    return allObservations
      .filter(
        (o) =>
          (o.criticality === "Critical" || o.criticality === "High") &&
          o.status !== "Closed",
      )
      .sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        if (a.criticality === "Critical" && b.criticality !== "Critical") return -1;
        if (a.criticality !== "Critical" && b.criticality === "Critical") return 1;
        return (a.daysDiff ?? 999) - (b.daysDiff ?? 999);
      })
      .slice(0, 6);
  }, [allObservations]);

  // Ranked departments by pending observations
  const rankedDepartments = useMemo(() => {
    return [...departmentSummaries]
      .filter((d) => d.totals.total > 0)
      .sort(
        (a, b) =>
          b.totals.pending - a.totals.pending ||
          b.totals.overdue - a.totals.overdue ||
          b.totals.total - a.totals.total,
      )
      .slice(0, 6);
  }, [departmentSummaries]);

  // Recent remediation updates and verified closures
  const recentActivities: ActivityItem[] = useMemo(() => {
    const list: ActivityItem[] = [];

    for (const obs of allObservations) {
      if (obs.type === "Internal" && obs.rawInternal) {
        const raw = obs.rawInternal;
        if (raw.status === "Closed" && raw.closedDateISO) {
          list.push({
            id: `cl-${raw.id}`,
            kind: "closure",
            title: raw.title || "Untitled",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            actor: raw.headVerifiedByName || raw.verifiedBy || "Internal Audit",
            dateStr: fmtDate(raw.closedDateISO),
            dateISO: raw.closedDateISO,
            text: raw.closureNote || "Observation remediated and verified closed by Internal Audit.",
            rawItem: obs,
          });
        }
        if (raw.updates && raw.updates.length > 0) {
          for (const u of raw.updates) {
            list.push({
              id: `up-${u.id || uid()}`,
              kind: "update",
              title: raw.title || "Untitled",
              ref: obs.ref,
              department: obs.department,
              criticality: obs.criticality,
              actor: u.byName || u.by || raw.owner || "Action Owner",
              dateStr: u.at ? fmtDate(u.at) : "",
              dateISO: u.at || "",
              text: u.text || "Remediation progress update submitted.",
              rawItem: obs,
            });
          }
        }
      } else if (obs.type === "External" && obs.rawExternal) {
        const raw = obs.rawExternal;
        if (raw.status === "Closed" && raw.closedDateISO) {
          list.push({
            id: `ext-cl-${raw.id}`,
            kind: "closure",
            title: raw.title || "Untitled Finding",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            actor: raw.verifiedBy || "Compliance / External Audit",
            dateStr: fmtDate(raw.closedDateISO),
            dateISO: raw.closedDateISO,
            text: raw.closureEvidence || "External audit finding remediated and closed.",
            rawItem: obs,
          });
        }
        if (raw.ownerResponse || raw.managementResponse) {
          list.push({
            id: `ext-resp-${raw.id}`,
            kind: "response",
            title: raw.title || "Untitled Finding",
            ref: obs.ref,
            department: obs.department,
            criticality: obs.criticality,
            actor: raw.owner || "Management",
            dateStr: raw.targetDate ? fmtDate(raw.targetDate) : "",
            dateISO: raw.targetDate || "",
            text: raw.ownerResponse || raw.managementResponse || "Management response recorded.",
            rawItem: obs,
          });
        }
      }
    }

    return list
      .sort((a, b) => {
        const da = a.dateISO ? new Date(a.dateISO).getTime() : 0;
        const db = b.dateISO ? new Date(b.dateISO).getTime() : 0;
        return db - da;
      })
      .slice(0, 3);
  }, [allObservations]);

  const [activityFilter, setActivityFilter] = useState<"all" | "closure" | "update">("all");

  const { closureCount, updateCount } = useMemo(() => {
    let closureCount = 0;
    let updateCount = 0;
    for (const a of recentActivities) {
      if (a.kind === "closure") closureCount++;
      else updateCount++;
    }
    return { closureCount, updateCount };
  }, [recentActivities]);

  const filteredActivities = useMemo(() => {
    if (activityFilter === "all") return recentActivities;
    if (activityFilter === "closure") return recentActivities.filter((a) => a.kind === "closure");
    return recentActivities.filter((a) => a.kind === "update" || a.kind === "response");
  }, [recentActivities, activityFilter]);


  // Criticality distribution counts
  const byC = useMemo(() => {
    const counts: Record<string, number> = {
      Critical: 0,
      High: 0,
      Moderate: 0,
      Low: 0,
    };
    for (const o of allObservations) {
      const c = o.criticality === "Medium" ? "Moderate" : o.criticality;
      if (counts[c] !== undefined) counts[c]++;
      else counts.Moderate = (counts.Moderate || 0) + 1;
    }
    return counts;
  }, [allObservations]);

  // Criticality percentages
  const critPercentages = useMemo(() => {
    return percentages(EXEC_CRITS.map((c) => byC[c] || 0));
  }, [byC]);

  // Donut chart segments
  const donutSegs = useMemo(() => {
    return EXEC_CRITS.map((c) => ({
      value: byC[c] || 0,
      color: SEV_COLOR[c],
    }));
  }, [byC]);

  // Due status counts for open items
  const dueStatusCounts = useMemo(() => {
    let overdue = 0;
    let watchlist = 0;
    let onTrack = 0;
    for (const o of allObservations) {
      if (o.status === "Closed") continue;
      if (o.isOverdue) overdue++;
      else if (o.daysDiff != null && o.daysDiff <= 14) watchlist++;
      else onTrack++;
    }
    return { overdue, watchlist, onTrack };
  }, [allObservations]);

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
    <>
      {/* Executive Welcome & Header */}
      <div className="dash-welcome anim-fade-in">
        <div className="dash-welcome-text">
          <h1>Welcome, {user.name}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500, marginTop: 4 }}>
            {getExecutiveTitle(user)}
          </div>
        </div>
      </div>

      {/* Top Governance KPI Cards */}
      <div
        className="kpis-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <Kpi
          tone="base"
          label="Total Observations"
          value={overallTotals.total}
          sub={`${overallTotals.internalTotal} internal · ${overallTotals.externalTotal} external`}
          icon="audit"
        />
        <Kpi
          tone="good"
          label="What Has Been Done"
          value={overallTotals.done}
          sub={`${overallTotals.rate}% overall remediation rate`}
          icon="check"
        />
        <Kpi
          tone="accent"
          label="What's Left (Pending)"
          value={overallTotals.pending}
          sub="Open & In Progress"
          icon="obs"
        />
        <Kpi
          tone={overallTotals.overdue > 0 ? "warn" : "base"}
          label="Overdue Actions"
          value={overallTotals.overdue}
          sub="Target date passed"
          icon="alert"
        />
        <Kpi
          tone="warn"
          label="Critical & High"
          value={overallTotals.critHighTotal}
          sub="High severity matters"
          icon="alert"
        />
      </div>

      {/* Top 2-Column Section: Left (Criticality Donut + Recent Activity) vs Right (Table Critical Watch) */}
      <div className="dash2" style={{ alignItems: "stretch", marginBottom: 18 }}>
        {/* Left Column: Donut card (fit-content) + Recent Remediation Activity filling below */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, height: "100%" }}>
          {/* Card 1: Observations by Criticality & Status Posture (hugs actual height) */}
          <div className="card chart-card anim-fade-in" style={{ height: "fit-content", flexShrink: 0 }}>
            <div className="seclabel">Observations by Criticality &amp; Posture</div>
            <div className="donutwrap" style={{ marginTop: 10, marginBottom: 16 }}>
              <Donut segs={donutSegs} total={overallTotals.total} label="total" />
              <div className="legend" style={{ flex: 1 }}>
                {EXEC_CRITS.map((c, i) => (
                  <div className="li" key={c}>
                    <span className="dot" style={{ background: SEV_COLOR[c] }} />
                    <span className="lname">{c}</span>
                    <span className="lval">{byC[c] || 0}</span>
                    <span className="lpct">{critPercentages[i]}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tline">
              <div className="tcell tcell-overdue">
                <div className="tn">{dueStatusCounts.overdue}</div>
                <div className="tl">Overdue</div>
              </div>
              <div className="tcell tcell-watch">
                <div className="tn">{dueStatusCounts.watchlist}</div>
                <div className="tl">Watchlist · ≤2wks</div>
              </div>
              <div className="tcell tcell-track">
                <div className="tn">{dueStatusCounts.onTrack}</div>
                <div className="tl">On track</div>
              </div>
            </div>
          </div>

          {/* Card 2: Recent Remediation Activity & Updates (Enhanced & fills the space below) */}
          <div className="card anim-fade-in" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div
              className="row"
              style={{
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <div>
                <div className="seclabel">Recent Remediation Activity &amp; Updates</div>
                <div className="hint" style={{ marginTop: 2, fontSize: 11.5 }}>
                  Live feed of verified closures, progress updates, and owner responses.
                </div>
              </div>

              {/* Activity Filter Tabs — Upgraded segmented controls */}
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
                  onClick={() => setActivityFilter("all")}
                  style={{
                    border: "none",
                    background: activityFilter === "all" ? "#fff" : "transparent",
                    color: activityFilter === "all" ? "var(--brand-700, #0a4a3b)" : "var(--muted, #64748b)",
                    fontWeight: activityFilter === "all" ? 700 : 500,
                    fontSize: 11.5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    boxShadow: activityFilter === "all" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>All</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 10,
                      background: activityFilter === "all" ? "rgba(10,74,59,0.1)" : "rgba(0,0,0,0.05)",
                      color: activityFilter === "all" ? "var(--brand-700, #0a4a3b)" : "inherit",
                    }}
                  >
                    {recentActivities.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter("closure")}
                  style={{
                    border: "none",
                    background: activityFilter === "closure" ? "#fff" : "transparent",
                    color: activityFilter === "closure" ? "var(--closed, #2e7d32)" : "var(--muted, #64748b)",
                    fontWeight: activityFilter === "closure" ? 700 : 500,
                    fontSize: 11.5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    boxShadow: activityFilter === "closure" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>Closures</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 10,
                      background: activityFilter === "closure" ? "rgba(46,125,50,0.12)" : "rgba(0,0,0,0.05)",
                      color: activityFilter === "closure" ? "var(--closed, #2e7d32)" : "inherit",
                    }}
                  >
                    {closureCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter("update")}
                  style={{
                    border: "none",
                    background: activityFilter === "update" ? "#fff" : "transparent",
                    color: activityFilter === "update" ? "#2c5f8a" : "var(--muted, #64748b)",
                    fontWeight: activityFilter === "update" ? 700 : 500,
                    fontSize: 11.5,
                    padding: "4px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    boxShadow: activityFilter === "update" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    transition: "all 0.15s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>Updates</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 5px",
                      borderRadius: 10,
                      background: activityFilter === "update" ? "rgba(44,95,138,0.12)" : "rgba(0,0,0,0.05)",
                      color: activityFilter === "update" ? "#2c5f8a" : "inherit",
                    }}
                  >
                    {updateCount}
                  </span>
                </button>
              </div>
            </div>

            {!filteredActivities.length ? (
              <Empty big="📋">No recent remediation updates matching this filter.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                {filteredActivities.map((act) => (
                  <div
                    key={act.id}
                    onClick={() => openObservation(act.rawItem)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: "var(--surface-subtle, #f8faf9)",
                      border: "1px solid var(--line, #e2e8f0)",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease",
                    }}
                    className="tracker-row"
                    title="Click to inspect observation"
                  >
                    <div style={{ marginBottom: 8, fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
                      {act.title}
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--ink-secondary, #334155)",
                        lineHeight: 1.4,
                        background: "#fff",
                        padding: "8px 12px",
                        borderRadius: 6,
                        border: "1px solid #edf2f7",
                      }}
                    >
                      <span style={{ fontStyle: "italic" }}>&ldquo;{act.text}&rdquo;</span>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11,
                          color: "var(--muted)",
                          fontWeight: 500,
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
                          {" · "}
                          <span>{act.dateISO ? timeAgo(act.dateISO) || act.dateStr : act.dateStr}</span>
                        </span>
                        <span style={{ color: "var(--accent)", fontSize: 11 }}>View details ↗</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* View More Activity Button */}
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid var(--line, #e2e8f0)",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Link
                href="/updates"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--brand-700, #0a4a3b)",
                  background: "var(--surface-subtle, #f0f5f2)",
                  border: "1px solid var(--line, #e2e8f0)",
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                }}
              >
                <span>View more updates &amp; remediation activity</span>
                <span style={{ fontSize: 13 }}>&rarr;</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column: Department Risk Exposure (Bar Chart) + Critical & High Priority Watch */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Card 1: Department Risk Exposure & Workload (Bar Chart) */}
          <div
            className="card anim-fade-in"
            style={{
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              className="row"
              style={{
                padding: "16px 20px 12px 20px",
                borderBottom: "1px solid var(--line, #e2e8f0)",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <div className="seclabel">Department Risk Exposure &amp; Workload</div>
              </div>
              <span className="hint" style={{ fontSize: 11 }}>
                Pending observations by department
              </span>
            </div>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {rankedDepartments.map((ds) => {
                const cleanName = shortDeptName(ds.department);
                const critCount =
                  ds.internal.all.filter((o) => o.criticality === "Critical" && o.status !== "Closed").length +
                  ds.external.all.filter((f) => f.severity === "Critical" && f.status !== "Closed").length;
                const highCount =
                  ds.internal.all.filter((o) => o.criticality === "High" && o.status !== "Closed").length +
                  ds.external.all.filter((f) => f.severity === "High" && f.status !== "Closed").length;
                const otherCount = Math.max(0, ds.totals.pending - critCount - highCount);
                const maxPending = Math.max(...rankedDepartments.map((d) => d.totals.pending), 1);
                const critWidth = (critCount / maxPending) * 100;
                const highWidth = (highCount / maxPending) * 100;
                const otherWidth = (otherCount / maxPending) * 100;

                return (
                  <Link
                    key={ds.department}
                    href={`/departments/${ds.slug}/internal`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      textDecoration: "none",
                      color: "inherit",
                      padding: "6px 8px",
                      borderRadius: 8,
                      transition: "background 0.15s ease",
                    }}
                    className="tracker-row"
                    title={`View ${ds.department} observations`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{cleanName}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {critCount > 0 ? (
                          <span className="pill c-Critical" style={{ fontSize: 9.5, padding: "1px 5px", whiteSpace: "nowrap" }}>
                            {critCount} Crit
                          </span>
                        ) : null}
                        {highCount > 0 ? (
                          <span className="pill c-High" style={{ fontSize: 9.5, padding: "1px 5px", whiteSpace: "nowrap" }}>
                            {highCount} High
                          </span>
                        ) : null}
                        {ds.totals.overdue > 0 ? (
                          <span className="pill c-Critical" style={{ fontSize: 9.5, padding: "1px 5px", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {ds.totals.overdue} Overdue
                          </span>
                        ) : null}
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: 13,
                            color: ds.totals.pending > 0 ? "var(--brand-700, #0a4a3b)" : "var(--muted)",
                            minWidth: 60,
                            textAlign: "right",
                          }}
                        >
                          {ds.totals.pending} <span style={{ fontSize: 10.5, fontWeight: 400, color: "var(--muted)" }}>pending</span>
                        </span>
                      </div>
                    </div>

                    {/* Horizontal Bar Chart Track */}
                    <div
                      style={{
                        width: "100%",
                        height: 8,
                        background: "var(--surface-subtle, #edf2ef)",
                        borderRadius: 4,
                        overflow: "hidden",
                        display: "flex",
                      }}
                    >
                      {critCount > 0 ? (
                        <div
                          style={{
                            width: `${critWidth}%`,
                            background: "var(--high, #dc2626)",
                            transition: "width 0.3s ease",
                          }}
                          title={`${critCount} Critical`}
                        />
                      ) : null}
                      {highCount > 0 ? (
                        <div
                          style={{
                            width: `${highWidth}%`,
                            background: "#f59e0b",
                            transition: "width 0.3s ease",
                          }}
                          title={`${highCount} High`}
                        />
                      ) : null}
                      {otherCount > 0 ? (
                        <div
                          style={{
                            width: `${otherWidth}%`,
                            background: "var(--brand-500, #10b981)",
                            transition: "width 0.3s ease",
                          }}
                          title={`${otherCount} Moderate/Low`}
                        />
                      ) : null}
                      {ds.totals.pending === 0 ? (
                        <div style={{ width: "100%", background: "#e2e8f0" }} />
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Card 2: Critical & High Priority Watch (Interchanged under Department Risk Exposure) */}
          <div
            className="card anim-fade-in"
            style={{
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header section (without subtext) */}
            <div
              className="row"
              style={{
                padding: "16px 20px 12px 20px",
                borderBottom: "1px solid var(--line, #e2e8f0)",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div>
                <div className="seclabel">Critical &amp; High Priority Watch</div>
              </div>
              {highCritWatch.length > 0 && (
                <span className="pill c-High" style={{ fontSize: 10.5, fontWeight: 700 }}>
                  {highCritWatch.length} Active
                </span>
              )}
            </div>

            {!highCritWatch.length ? (
              <div style={{ padding: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Empty big="✓">
                  No open Critical or High-risk observations across any department.
                </Empty>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={{ width: 110 }}>Severity</th>
                      <th scope="col">Observation</th>
                      <th scope="col">Department</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highCritWatch.map((item) => (
                      <tr
                        key={`${item.type}-${item.id}`}
                        className="tracker-row"
                        onClick={() => openObservation(item)}
                        title="Click to view details"
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ whiteSpace: "nowrap" }}>
                          <CritPill crit={item.criticality} />
                        </td>
                        <td>
                          <b style={{ fontSize: 12.5, color: "var(--ink)" }}>{item.title}</b>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <span
                            className="pill"
                            style={{
                              background: "#edf4f1",
                              color: "#19302a",
                              fontSize: 10.5,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {shortDeptName(item.department)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
