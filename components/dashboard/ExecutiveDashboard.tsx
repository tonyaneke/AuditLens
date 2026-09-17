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
      .slice(0, 5);
  }, [allObservations]);

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
      {/* Executive Welcome & Header — matches Head of Internal Audit styling */}
      <div className="dash-welcome anim-fade-in">
        <div className="dash-welcome-text">
          <h1>Welcome, {user.name}</h1>
          <p className="dash-welcome-role">
            Executive Committee · Cross-Department Governance &amp; Oversight
          </p>
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

      {/* Multi-column Grid Row 1: Severity Distribution & Critical/High Watch */}
      <div className="dash2">
        {/* Card 1: Observations by Criticality & Status Posture */}
        <div className="card chart-card anim-fade-in">
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

        {/* Card 2: Key Exposures: Critical & High Priority Governance Watch */}
        <div className="card anim-fade-in" style={{ display: "flex", flexDirection: "column" }}>
          <div
            className="row"
            style={{
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              <div className="seclabel">Critical &amp; High Priority Watch</div>
              <div className="hint" style={{ marginTop: 2, fontSize: 11.5 }}>
                Key exposures requiring executive oversight &amp; target date tracking.
              </div>
            </div>
            {overallTotals.overdue > 0 ? (
              <span className="pill c-Critical" style={{ fontSize: 10.5, fontWeight: 700 }}>
                {overallTotals.overdue} Overdue
              </span>
            ) : null}
          </div>

          {!highCritWatch.length ? (
            <Empty big="✓">
              No open Critical or High-risk observations across any department.
            </Empty>
          ) : (
            <div style={{ overflowX: "auto", flex: 1 }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Severity &amp; Ref</th>
                    <th scope="col">Observation</th>
                    <th scope="col">Dept</th>
                    <th scope="col">Target</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {highCritWatch.map((item) => (
                    <tr
                      key={`${item.type}-${item.id}`}
                      className="tracker-row"
                      onClick={() => openObservation(item)}
                      title="Click to view details"
                    >
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div className="row" style={{ gap: 6, alignItems: "center" }}>
                          <CritPill crit={item.criticality} />
                          <span style={{ fontWeight: 600, fontSize: 11.5 }}>{item.ref}</span>
                        </div>
                      </td>
                      <td style={{ maxWidth: 190 }}>
                        <RowOpen onOpen={() => openObservation(item)} label={`Open ${item.title}`}>
                          <b style={{ fontSize: 12 }}>{item.title}</b>
                        </RowOpen>
                      </td>
                      <td>
                        <span
                          className="pill"
                          style={{ background: "#edf4f1", color: "#19302a", fontSize: 10.5 }}
                        >
                          {item.department.replace(/\s+Department$/i, "")}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {item.targetDate ? (
                          <div>
                            <div style={{ fontSize: 11.5, fontWeight: 600 }}>{item.targetDate}</div>
                            {item.isOverdue ? (
                              <span
                                className="pill c-Critical"
                                style={{ fontSize: 9.5, padding: "1px 4px", marginTop: 2 }}
                              >
                                Overdue
                              </span>
                            ) : item.daysDiff != null && item.daysDiff <= 14 ? (
                              <span
                                className="pill c-High"
                                style={{ fontSize: 9.5, padding: "1px 4px", marginTop: 2 }}
                              >
                                Due in {item.daysDiff}d
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td className="ra-actions-cell">
                        <button
                          className="btn-icon-action"
                          type="button"
                          title="View observation details"
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

      {/* Multi-column Grid Row 2: Department Workload & Recent Activity */}
      <div className="dash2">
        {/* Card 3: Department Risk Exposure & Workload */}
        <div className="card anim-fade-in" style={{ display: "flex", flexDirection: "column" }}>
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
              <div className="seclabel">Department Risk Exposure &amp; Workload</div>
              <div className="hint" style={{ marginTop: 2, fontSize: 11.5 }}>
                Ranked by pending observations and completion progress.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
            {rankedDepartments.map((ds) => {
              const cleanName = ds.department.replace(/\s+Department$/i, "");
              const critCount =
                ds.internal.all.filter((o) => o.criticality === "Critical").length +
                ds.external.all.filter((f) => f.severity === "Critical").length;
              const highCount =
                ds.internal.all.filter((o) => o.criticality === "High").length +
                ds.external.all.filter((f) => f.severity === "High").length;
              const medCount =
                ds.internal.all.filter((o) => o.criticality === "Moderate").length +
                ds.external.all.filter((f) => f.severity === "Medium").length;
              const lowCount = ds.totals.total - critCount - highCount - medCount;

              return (
                <div
                  key={ds.department}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--surface-subtle, #f8faf9)",
                    border: "1px solid var(--line, #e2e8f0)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    className="row"
                    style={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Link
                        href={`/departments/${ds.slug}/internal`}
                        style={{
                          fontWeight: 700,
                          fontSize: 12.5,
                          color: "var(--brand-700, #0a4a3b)",
                          textDecoration: "none",
                        }}
                      >
                        {cleanName}
                      </Link>
                      {critCount > 0 ? (
                        <span
                          className="pill c-Critical"
                          style={{ fontSize: 9.5, padding: "1px 5px" }}
                          title={`${critCount} Critical`}
                        >
                          {critCount}C
                        </span>
                      ) : null}
                      {highCount > 0 ? (
                        <span
                          className="pill c-High"
                          style={{ fontSize: 9.5, padding: "1px 5px" }}
                          title={`${highCount} High`}
                        >
                          {highCount}H
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        <b style={{ color: ds.totals.pending > 0 ? "var(--high)" : "var(--ink)" }}>
                          {ds.totals.pending} left
                        </b>{" "}
                        ·{" "}
                        <span style={{ color: "var(--closed)", fontWeight: 600 }}>
                          {ds.totals.rate}% done
                        </span>
                      </span>

                      <div className="row" style={{ gap: 4 }}>
                        <Link
                          href={`/departments/${ds.slug}/internal`}
                          className="btn sec sm"
                          style={{ padding: "2px 6px", fontSize: 10 }}
                          title="Internal Observations"
                        >
                          Int ({ds.internal.pending.length})
                        </Link>
                        <Link
                          href={`/departments/${ds.slug}/external`}
                          className="btn sec sm"
                          style={{ padding: "2px 6px", fontSize: 10 }}
                          title="External Observations"
                        >
                          Ext ({ds.external.pending.length})
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Stacked Severity Distribution & Progress Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: "#e2ece8",
                        overflow: "hidden",
                        display: "flex",
                      }}
                      title={`Critical: ${critCount}, High: ${highCount}, Medium: ${medCount}, Low/Other: ${Math.max(0, lowCount)}`}
                    >
                      {critCount > 0 ? (
                        <div
                          style={{
                            width: `${(critCount / ds.totals.total) * 100}%`,
                            background: SEV_COLOR.Critical,
                          }}
                        />
                      ) : null}
                      {highCount > 0 ? (
                        <div
                          style={{
                            width: `${(highCount / ds.totals.total) * 100}%`,
                            background: SEV_COLOR.High,
                          }}
                        />
                      ) : null}
                      {medCount > 0 ? (
                        <div
                          style={{
                            width: `${(medCount / ds.totals.total) * 100}%`,
                            background: SEV_COLOR.Moderate,
                          }}
                        />
                      ) : null}
                      {lowCount > 0 ? (
                        <div
                          style={{
                            width: `${(lowCount / ds.totals.total) * 100}%`,
                            background: SEV_COLOR.Low,
                          }}
                        />
                      ) : null}
                    </div>

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        minWidth: 28,
                        textAlign: "right",
                        color:
                          ds.totals.rate >= 80
                            ? "var(--closed)"
                            : ds.totals.rate >= 50
                              ? "var(--med)"
                              : "var(--high)",
                      }}
                    >
                      {ds.totals.rate}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 4: Recent Remediation Activity & Updates */}
        <div className="card anim-fade-in" style={{ display: "flex", flexDirection: "column" }}>
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
                Live feed of progress notes, department responses, and verified closures.
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Latest cross-department
            </div>
          </div>

          {!recentActivities.length ? (
            <Empty big="📋">No recent remediation updates recorded yet.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              {recentActivities.map((act) => (
                <div
                  key={act.id}
                  onClick={() => openObservation(act.rawItem)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--surface-subtle, #f8faf9)",
                    border: "1px solid var(--line, #e2e8f0)",
                    cursor: "pointer",
                    transition: "border-color 0.15s ease, background 0.15s ease",
                  }}
                  title="Click to view observation details"
                >
                  <div
                    className="row"
                    style={{
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {act.kind === "closure" ? (
                        <span
                          className="pill c-Low"
                          style={{ fontSize: 9.5, padding: "1px 5px", fontWeight: 700 }}
                        >
                          ✓ Closed
                        </span>
                      ) : act.kind === "update" ? (
                        <span
                          className="pill sop-pending-pill"
                          style={{ fontSize: 9.5, padding: "1px 5px", fontWeight: 700 }}
                        >
                          ✎ Update
                        </span>
                      ) : (
                        <span
                          className="pill"
                          style={{
                            fontSize: 9.5,
                            padding: "1px 5px",
                            background: "#edf4f1",
                            color: "#19302a",
                            fontWeight: 700,
                          }}
                        >
                          💬 Response
                        </span>
                      )}

                      <span style={{ fontWeight: 600, fontSize: 12 }}>
                        {act.title}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        className="pill"
                        style={{ background: "#eef2f7", color: "#475569", fontSize: 10 }}
                      >
                        {act.department.replace(/\s+Department$/i, "")}
                      </span>
                      <span className="hint" style={{ fontSize: 11 }}>
                        {act.dateISO ? timeAgo(act.dateISO) || act.dateStr : act.dateStr}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-secondary, #334155)",
                      lineHeight: 1.35,
                      background: "#fff",
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid #edf2f7",
                    }}
                  >
                    &ldquo;{act.text}&rdquo;
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 10.5,
                        color: "var(--muted)",
                        fontWeight: 500,
                      }}
                    >
                      Logged by {act.actor}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Full-width Cross-Department Observations Snapshot */}
      <div className="card anim-fade-in">
        <div
          className="row"
          style={{
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div>
            <div className="seclabel">Cross-Department Observations Snapshot</div>
            <div className="hint" style={{ marginTop: 2 }}>
              Inspect observations across all departments, review remediation dates, and track past closures.
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
        <div
          className="row"
          style={{ gap: 10, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}
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
              <option value="Moderate">Medium / Moderate</option>
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
                        <CritPill crit={item.criticality} />
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
                      <span
                        className="pill"
                        style={{ background: "#edf4f1", color: "#19302a", fontSize: 11 }}
                      >
                        {item.department.replace(/\s+Department$/i, "")}
                      </span>
                    </td>
                    <td>
                      <StatusPill status={item.status} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {item.targetDate ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{item.targetDate}</div>
                          {item.status !== "Closed" && (
                            item.isOverdue ? (
                              <span
                                className="pill c-Critical"
                                style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}
                              >
                                Overdue
                              </span>
                            ) : item.daysDiff != null && item.daysDiff <= 14 ? (
                              <span
                                className="pill c-High"
                                style={{ fontSize: 10, padding: "1px 5px", marginTop: 2 }}
                              >
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
    </>
  );
}
