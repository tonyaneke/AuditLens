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
  approvedObs,
  closeBucketOf,
  CLOSE_BUCKETS,
  CRITS,
  CRIT_HEX,
  daysToClose,
  effectiveClose,
  fmtDate,
  isOverdueObs,
  percentages,
  timeAgo,
  uid,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { deptNameOf } from "@/lib/dept-scope";

type UnifiedObservation = {
  id: string;
  type: "Internal";
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
  rawInternal: ObsWithContext;
};

function shortDeptName(name: string): string {
  const clean = name.replace(/\s+Department$/i, "").trim();
  const lower = clean.toLowerCase();
  if (lower === "office of the managing director" || lower === "omd") return "OMD";
  if (lower === "risk management") return "Risk Mgt";
  if (lower === "corporate communications") return "Corp Comms";
  if (lower === "credit operations") return "Credit Ops";
  if (lower === "people & culture" || lower === "people and culture") return "P&C";
  if (lower === "impact & sustainability" || lower === "impact and sustainability") return "Impact & Sust";
  return clean;
}

type ActivityItem = {
  id: string;
  kind: "closure" | "update";
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

type WatchFilter = "critical" | "overdue" | "due_soon";

const WATCH_FILTERS: {
  key: WatchFilter;
  label: string;
  on: string;
  offBg: string;
  offFg: string;
  href: string;
  empty: string;
}[] = [
  {
    key: "critical",
    label: "Critical",
    on: "#7a0012",
    offBg: "#f6dde0",
    offFg: "#7a0012",
    href: "/observations?crit=Critical",
    empty: "No open Critical observations.",
  },
  {
    key: "overdue",
    label: "Overdue",
    on: "#b00020",
    offBg: "#fdecef",
    offFg: "#b00020",
    href: "/observations?timeline=overdue",
    empty: "No overdue observations.",
  },
  {
    key: "due_soon",
    label: "Due ≤ 2 wks",
    on: "#c98a00",
    offBg: "#fbf3dd",
    offFg: "#805b00",
    href: "/observations?timeline=due_soon",
    empty: "Nothing due in the next two weeks.",
  },
];

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

  // Approved internal observations (Head of Audit standard — exactly 125 unique items, no double-counting, no external add-in)
  const approved = useMemo(() => approvedObs(db), [db]);

  // Overall totals matching Head of Audit standard exactly
  const overallTotals = useMemo(() => {
    const total = approved.length;
    const openObs = approved.filter((o) => o.status !== "Closed");
    const pending = openObs.length;
    const done = total - pending;
    const overdue = openObs.filter((o) => isOverdueObs(o, o._r)).length;
    // Open Critical & High exposures (matching Head of Audit standard: 26 active key exposures)
    const critHighTotal = openObs.filter(
      (o) => o.criticality === "Critical" || o.criticality === "High",
    ).length;
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;

    return {
      total,
      done,
      pending,
      overdue,
      critHighTotal,
      rate,
    };
  }, [approved]);

  // List of all approved internal observations
  const allObservations: UnifiedObservation[] = useMemo(() => {
    const list: UnifiedObservation[] = [];

    for (const o of approved) {
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

    // Sort: overdue first, then by criticality, then targetDate
    return list.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [approved, db]);

  // Priority Watch — open observations needing executive oversight, sliced three ways.
  // Overdue / due-soon go through closeBucketOf() so they match the posture tiles (QA-11).
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("critical");
  const [watchPage, setWatchPage] = useState<number>(1);
  const WATCH_PAGE_SIZE = 5;

  const watchLists = useMemo(() => {
    const lists: Record<WatchFilter, UnifiedObservation[]> = { critical: [], overdue: [], due_soon: [] };
    for (const o of allObservations) {
      if (o.status === "Closed") continue;
      if (o.criticality === "Critical") lists.critical.push(o);
      const bucket = closeBucketOf(o.rawInternal, o.rawInternal._r);
      if (bucket === "Overdue") lists.overdue.push(o);
      else if (bucket === "≤ 2 weeks") lists.due_soon.push(o);
    }
    // Overdue first, then severity, then longest-overdue / soonest-due.
    const byPriority = (a: UnifiedObservation, b: UnifiedObservation) =>
      Number(b.isOverdue) - Number(a.isOverdue) ||
      CRITS.indexOf(a.rawInternal.criticality) - CRITS.indexOf(b.rawInternal.criticality) ||
      (a.daysDiff ?? 999) - (b.daysDiff ?? 999);
    for (const k of WATCH_FILTERS) lists[k.key].sort(byPriority);
    return lists;
  }, [allObservations]);

  const priorityWatch = watchLists[watchFilter];
  const activeWatchFilter = WATCH_FILTERS.find((f) => f.key === watchFilter)!;

  const totalWatchPages = Math.max(1, Math.ceil(priorityWatch.length / WATCH_PAGE_SIZE));
  const currentWatchPage = Math.min(watchPage, totalWatchPages);

  const paginatedWatch = useMemo(() => {
    const start = (currentWatchPage - 1) * WATCH_PAGE_SIZE;
    return priorityWatch.slice(start, start + WATCH_PAGE_SIZE);
  }, [priorityWatch, currentWatchPage]);

  // Ranked departments by pending internal observations
  const rankedDepartments = useMemo(() => {
    return [...departmentSummaries]
      .filter((d) => d.internal.all.length > 0)
      .sort(
        (a, b) =>
          b.internal.pending.length - a.internal.pending.length ||
          b.internal.overdue.length - a.internal.overdue.length ||
          b.internal.all.length - a.internal.all.length,
      )
      .slice(0, 6);
  }, [departmentSummaries]);

  // Recent remediation updates and verified closures (Internal only)
  const recentActivities: ActivityItem[] = useMemo(() => {
    const list: ActivityItem[] = [];

    for (const obs of allObservations) {
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
    return recentActivities.filter((a) => a.kind === "update");
  }, [recentActivities, activityFilter]);

  // Criticality distribution counts (all 5 standard criticalities)
  const byC = useMemo(() => {
    const counts: Record<string, number> = {};
    CRITS.forEach((c) => (counts[c] = 0));
    for (const o of allObservations) {
      if (counts[o.criticality] != null) counts[o.criticality]++;
      else counts.Moderate = (counts.Moderate || 0) + 1;
    }
    return counts;
  }, [allObservations]);

  // Criticality percentages
  const critPercentages = useMemo(() => {
    return percentages(CRITS.map((c) => byC[c] || 0));
  }, [byC]);

  // Donut chart segments
  const donutSegs = useMemo(() => {
    return CRITS.map((c) => ({
      value: byC[c] || 0,
      color: CRIT_HEX[c] || "#64748b",
    }));
  }, [byC]);

  // Due status counts for open items (matching Head of Audit close buckets)
  const dueStatusCounts = useMemo(() => {
    const closeB: Record<string, number> = {};
    CLOSE_BUCKETS.forEach((b) => (closeB[b] = 0));
    for (const o of allObservations) {
      if (o.status === "Closed") continue;
      const b = closeBucketOf(o.rawInternal, o.rawInternal._r);
      if (b != null) closeB[b]++;
    }
    const onTrack = closeB["2–4 weeks"] + closeB["1–3 months"] + closeB["> 3 months"];
    return {
      overdue: closeB["Overdue"] || 0,
      watchlist: closeB["≤ 2 weeks"] || 0,
      onTrack,
    };
  }, [allObservations]);

  function openObservation(item: UnifiedObservation) {
    if (item.rawInternal) {
      const o = item.rawInternal;
      const href = hrefForView("observation", {
        audit: o._a.id,
        report: o._r.id,
        obs: o.id,
      });
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
          sub={`${overallTotals.pending} open · ${overallTotals.done} closed`}
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
          sub="Open key exposures"
          icon="alert"
        />
      </div>

      {/* Top 2-Column Section: Left (Criticality Donut + Recent Activity) vs Right (Risk spread + Priority Watch) */}
      <div className="dash2" style={{ alignItems: "stretch", marginBottom: 18 }}>
        {/* Left Column: Donut card (fit-content) + Recent Remediation Activity filling below */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, height: "100%" }}>
          {/* Card 1: Observations by Criticality & Status Posture (hugs actual height) */}
          <div className="card chart-card anim-fade-in" style={{ height: "fit-content", flexShrink: 0 }}>
            <div className="seclabel">Observations by Criticality &amp; Posture</div>
            <div className="donutwrap" style={{ marginTop: 10, marginBottom: 16 }}>
              <Donut segs={donutSegs} total={overallTotals.total} label="total" />
              <div className="legend" style={{ flex: 1 }}>
                {CRITS.map((c, i) => (
                  <div className="li" key={c}>
                    <span className="dot" style={{ background: CRIT_HEX[c] || "#64748b" }} />
                    <span className="lname">{c}</span>
                    <span className="lval">{byC[c] || 0}</span>
                    <span className="lpct">{critPercentages[i]}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="tline">
              <Link
                href="/observations?timeline=overdue"
                className="tcell tcell-overdue"
                style={{ textDecoration: "none", cursor: "pointer" }}
                title="View overdue observations in full register"
              >
                <div className="tn">{dueStatusCounts.overdue}</div>
                <div className="tl">Overdue</div>
              </Link>
              <Link
                href="/observations?timeline=due_soon"
                className="tcell tcell-watch"
                style={{ textDecoration: "none", cursor: "pointer" }}
                title="View watchlist (≤2wks) observations in full register"
              >
                <div className="tn">{dueStatusCounts.watchlist}</div>
                <div className="tl">Watchlist · ≤2wks</div>
              </Link>
              <Link
                href="/observations?timeline=on_track"
                className="tcell tcell-track"
                style={{ textDecoration: "none", cursor: "pointer" }}
                title="View on track observations in full register"
              >
                <div className="tn">{dueStatusCounts.onTrack}</div>
                <div className="tl">On track</div>
              </Link>
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

        {/* Right Column: Department Risk Exposure (Bar Chart) + Priority Watch */}
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
                <div className="seclabel">Departmental risk spread</div>
              </div>
              {/* Severity Legend */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--muted)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--high, #dc2626)" }} />
                  Critical
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b" }} />
                  High
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand-500, #10b981)" }} />
                  Moderate/Low
                </span>
              </div>
            </div>

            {/* Vertical Bar Chart Container */}
            <div style={{ padding: "18px 20px 16px 20px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${rankedDepartments.length}, 1fr)`,
                  gap: 12,
                }}
              >
                {rankedDepartments.map((ds, idx) => {
                  const cleanName = shortDeptName(ds.department);
                  const pendingCount = ds.internal.pending.length;
                  const critCount = ds.internal.all.filter((o) => o.criticality === "Critical" && o.status !== "Closed").length;
                  const highCount = ds.internal.all.filter((o) => o.criticality === "High" && o.status !== "Closed").length;
                  const otherCount = Math.max(0, pendingCount - critCount - highCount);
                  const maxPending = Math.max(...rankedDepartments.map((d) => d.internal.pending.length), 1);
                  const MAX_BAR_HEIGHT = 100;
                  const barHeight =
                    pendingCount > 0
                      ? Math.max(12, Math.round((pendingCount / maxPending) * MAX_BAR_HEIGHT))
                      : 4;

                  const critPct = pendingCount > 0 ? (critCount / pendingCount) * 100 : 0;
                  const highPct = pendingCount > 0 ? (highCount / pendingCount) * 100 : 0;
                  const otherPct = pendingCount > 0 ? (otherCount / pendingCount) * 100 : 0;

                  return (
                    <Link
                      key={ds.department}
                      href={`/departments/${ds.slug}/internal`}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        textDecoration: "none",
                        color: "inherit",
                        width: "100%",
                      }}
                      className="dash-bar-column"
                      title={`${cleanName}: ${pendingCount} pending (${critCount} Critical, ${highCount} High, ${otherCount} Moderate/Low)`}
                    >
                      {/* Bar Column Area */}
                      <div
                        style={{
                          height: 135,
                          width: "100%",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "flex-end",
                        }}
                      >
                        {/* Top Pending Count */}
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: pendingCount > 0 ? "var(--ink)" : "var(--muted)",
                            marginBottom: 6,
                          }}
                        >
                          {pendingCount}
                        </span>

                        {/* Stacked Vertical Bar */}
                        <div
                          style={{
                            width: "50%",
                            maxWidth: 32,
                            minWidth: 18,
                            height: barHeight,
                            background: pendingCount === 0 ? "#e2e8f0" : "transparent",
                            borderRadius: "5px 5px 0 0",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            transformOrigin: "bottom",
                            animation: `barRise 0.65s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 65}ms both`,
                            boxShadow: pendingCount > 0 ? "0 2px 4px rgba(0,0,0,0.06)" : "none",
                          }}
                        >
                          {critCount > 0 ? (
                            <div
                              style={{
                                height: `${critPct}%`,
                                background: "var(--high, #dc2626)",
                                minHeight: 3,
                              }}
                              title={`${critCount} Critical`}
                            />
                          ) : null}
                          {highCount > 0 ? (
                            <div
                              style={{
                                height: `${highPct}%`,
                                background: "#f59e0b",
                                minHeight: 3,
                              }}
                              title={`${highCount} High`}
                            />
                          ) : null}
                          {otherCount > 0 ? (
                            <div
                              style={{
                                height: `${otherPct}%`,
                                background: "var(--brand-500, #10b981)",
                                minHeight: 3,
                              }}
                              title={`${otherCount} Moderate/Low`}
                            />
                          ) : null}
                        </div>
                      </div>

                      {/* Baseline axis line */}
                      <div style={{ height: 1, background: "var(--line, #e2e8f0)", width: "100%", margin: "0 0 8px 0" }} />

                      {/* Department Name */}
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: "var(--ink)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                          textAlign: "center",
                        }}
                      >
                        {cleanName}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 2: Priority Watch — Critical / Overdue / Due ≤ 2 wks */}
          <div
            className="card anim-fade-in"
            style={{
              padding: 0,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Header section with sub-filter buttons */}
            <div
              style={{
                padding: "16px 20px 14px 20px",
                borderBottom: "1px solid var(--line, #e2e8f0)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div className="seclabel" style={{ margin: 0 }}>
                  Priority Watch
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Link
                    href={activeWatchFilter.href}
                    className="btn sec sm"
                    style={{ fontSize: "11px", padding: "3px 9px", height: "auto", textDecoration: "none" }}
                  >
                    View in register →
                  </Link>
                </div>
              </div>

              {/* Filter chips: Critical / Overdue / Due ≤ 2 wks */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {WATCH_FILTERS.map((f) => {
                  const active = watchFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className="btn sm"
                      aria-pressed={active}
                      style={{
                        fontSize: "11.5px",
                        padding: "3px 10px",
                        borderRadius: "16px",
                        height: "auto",
                        fontWeight: 600,
                        background: active ? f.on : f.offBg,
                        color: active ? "#ffffff" : f.offFg,
                        border: "none",
                      }}
                      onClick={() => {
                        setWatchFilter(f.key);
                        setWatchPage(1);
                      }}
                    >
                      {f.label} ({watchLists[f.key].length})
                    </button>
                  );
                })}
              </div>
            </div>

            {!priorityWatch.length ? (
              <div style={{ padding: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Empty big="✓">{activeWatchFilter.empty}</Empty>
              </div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: 100 }}>Severity</th>
                        <th scope="col">Observation</th>
                        <th scope="col" style={{ width: 140 }}>Department</th>
                        <th scope="col" style={{ width: 120 }}>Timeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedWatch.map((item) => (
                        <tr
                          key={`${item.type}-${item.id}`}
                          className="tracker-row"
                          onClick={() => openObservation(item)}
                          title="Click to view full observation"
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ whiteSpace: "nowrap" }}>
                            <CritPill crit={item.criticality} />
                          </td>
                          <td>
                            {item.ref ? (
                              <span style={{ fontSize: 11.5, color: "var(--muted)", marginRight: 6 }}>
                                {item.ref}
                              </span>
                            ) : null}
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
                          <td style={{ whiteSpace: "nowrap" }}>
                            {item.isOverdue ? (
                              <span className="pill c-Critical" style={{ fontSize: 10, fontWeight: 700 }}>
                                OVERDUE
                              </span>
                            ) : item.daysDiff != null && item.daysDiff >= 0 && item.daysDiff <= 14 ? (
                              <span className="pill c-Moderate" style={{ fontSize: 10, fontWeight: 600 }}>
                                {item.daysDiff === 0 ? "Due today" : `${item.daysDiff}d left`}
                              </span>
                            ) : item.targetDate ? (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                                {item.targetDate}
                              </span>
                            ) : (
                              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer */}
                <div
                  style={{
                    padding: "10px 18px",
                    borderTop: "1px solid var(--line, #e2e8f0)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    background: "var(--card-sub, #fafbfc)",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  <div>
                    Showing{" "}
                    <b style={{ color: "var(--ink)" }}>
                      {(currentWatchPage - 1) * WATCH_PAGE_SIZE + 1}–
                      {Math.min(currentWatchPage * WATCH_PAGE_SIZE, priorityWatch.length)}
                    </b>{" "}
                    of <b style={{ color: "var(--ink)" }}>{priorityWatch.length}</b> observation{priorityWatch.length === 1 ? "" : "s"}
                  </div>
                  {totalWatchPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        className="btn sec sm"
                        disabled={currentWatchPage <= 1}
                        onClick={() => setWatchPage((p) => Math.max(1, p - 1))}
                        style={{ fontSize: 11, padding: "3px 9px", height: "auto" }}
                      >
                        ← Previous
                      </button>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink)", padding: "0 4px" }}>
                        Page {currentWatchPage} of {totalWatchPages}
                      </span>
                      <button
                        type="button"
                        className="btn sec sm"
                        disabled={currentWatchPage >= totalWatchPages}
                        onClick={() => setWatchPage((p) => Math.min(totalWatchPages, p + 1))}
                        style={{ fontSize: 11, padding: "3px 9px", height: "auto" }}
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
