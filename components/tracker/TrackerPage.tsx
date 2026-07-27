"use client";

// Remediation Tracker — React port of viewTracker/viewInsights/trackerRecent* with
// ?mode=actions|insights|recent as URL state.

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { CritPill, Empty, Kpi, StatusPill } from "@/components/ui";
import { esc, excelDoc, stamp, wordDoc } from "@/lib/client/exports";
import { hrefForView } from "@/lib/routes";
import {
  allObs,
  allObsRaw,
  ck,
  closeBucket,
  CLOSE_BUCKETS,
  CRITS,
  CRIT_HEX,
  daysToClose,
  effectiveClose,
  fmtDate,
  fmtDateTime,
  hx2rgba,
  isoToDate,
  isOverdueObs,
  obsAge,
  obsIsApproved,
  rcThemes,
  readyToClose,
  timeAgo,
  zeroCrit,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const STATUSES = ["Open", "In Progress", "Closed"];
const BCOL: Record<string, string> = {
  "Ready to Close": "#1f8a5b",
  "Recently Closed": "#2e7d32",
  Overdue: "#b00020",
  "≤ 2 weeks": "#e8590c",
  "2–4 weeks": "#c98a00",
  "1–3 months": "#2c5f8a",
  "> 3 months": "#2e7d32",
  "No date": "#64748b",
};
const RECENT_COL: Record<string, string> = {
  opened: "#2c5f8a",
  you: "#6b3fa0",
  owner: "#e8590c",
  comment: "#0d5a47",
  ready: "#c9a300",
  closed: "#2e7d32",
};

type TrackerFilter = { crit: string; tl: string; status: string; repeat: boolean };

export default function TrackerPage() {
  const { db } = useWorkspace();
  const user = useUser();
  const router = useRouter();
  const search = useSearchParams();
  const mode = search.get("mode") === "insights" ? "insights" : search.get("mode") === "recent" ? "recent" : "actions";
  const [filter, setFilter] = useState<TrackerFilter>({ crit: "All", tl: "All", status: "All", repeat: false });

  const obs = useMemo(() => allObs(db).filter(obsIsApproved), [db]);

  function goObservation(o: ObsWithContext) {
    const href = hrefForView("observation", { audit: o._a.id, report: o._r.id, obs: o.id });
    if (href.startsWith("/legacy")) window.location.assign(href);
    else router.push(href);
  }
  const setMode = (m: string) => router.replace(m === "actions" ? "/tracker" : `/tracker?mode=${m}`);

  /* ---- exports ---- */
  function exportTracker() {
    const openObs = obs.filter((o) => o.status !== "Closed");
    const crank = (o: ObsWithContext) => CRITS.indexOf(o.criticality);
    let inner = `<h1>Remediation Tracker — Open Actions</h1><div class="meta">${esc(db.org)} — Internal Audit · ${openObs.length} open action(s) · ${openObs.filter((o) => o.isRepeat).length} repeat finding(s)</div>`;
    if (!openObs.length) inner += `<div>No open actions.</div>`;
    [...CLOSE_BUCKETS, "No date"].forEach((g) => {
      const rows = openObs.filter((o) => (closeBucket(daysToClose(o, o._r)) ?? "No date") === g);
      if (!rows.length) return;
      rows.sort((a, b) => {
        const da = daysToClose(a, a._r), dbb = daysToClose(b, b._r);
        if (da == null && dbb == null) return crank(a) - crank(b);
        if (da == null) return 1;
        if (dbb == null) return -1;
        return da - dbb || crank(a) - crank(b);
      });
      inner += `<h2>${g === "No date" ? "No expected close date" : g} (${rows.length})</h2>
      <table><tr><th>Criticality</th><th>Action / observation</th><th>Audit · Report</th><th>Owner</th><th>Expected close</th><th>Age</th><th>Repeat</th><th>Status</th></tr>
      ${rows
        .map((o) => {
          const ec = effectiveClose(o, o._r);
          const age = obsAge(o, o._r);
          return `<tr><td><span class="pill ${ck(o.criticality)}">${o.criticality}</span></td><td>${esc(o.title)}</td><td>${esc(o._a.name)} · ${esc(o._r.title)}</td><td>${esc(o.owner || "—")}</td><td>${ec ? fmtDate(ec) : "—"}${isOverdueObs(o, o._r) ? " (overdue)" : ""}</td><td>${age != null ? age + "d" : "—"}</td><td>${o.isRepeat ? "Yes" + (o.repeatOf ? " (" + esc(o.repeatOf) + ")" : "") : "—"}</td><td>${esc(o.status || "Open")}</td></tr>`;
        })
        .join("")}</table>`;
    });
    wordDoc("Remediation Tracker " + stamp(), inner, typeof db.logo === "string" ? db.logo : undefined);
  }

  function exportExcelObs() {
    // Excel export — formatted table with colour-coded criticality/status cells.
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
    const headers = ["Audit","Area / Department","Report","Ref","Observation","Criticality","Category","Description","Criteria","Risk / Impact","Root cause","Recommendation","Proposed SOP update","Management response","Owner","Timeline","Expected close","Actual close","Status","Overdue","Repeat","Repeat of","Raised by","Created"];
    const list = allObsRaw(db).sort(
      (a, b) =>
        String(a._a.name || "").localeCompare(String(b._a.name || "")) ||
        String(a._r.title || "").localeCompare(String(b._r.title || "")) ||
        String(a.ref || "").localeCompare(String(b.ref || "")),
    );
    if (!list.length) {
      toast("No observations to export.");
      return;
    }
    const cell = (v: string, style = "") => `<td${style ? ` style="${style}"` : ""}>${esc(v)}</td>`;
    const rowsHtml = list
      .map((o) => {
        const ec = effectiveClose(o, o._r);
        const od = isOverdueObs(o, o._r);
        const cb = CRIT_BG[o.criticality] || ["#ffffff", "#1c2733"];
        const sb = STATUS_BG[String(o.status || "Open")] || ["#ffffff", "#1c2733"];
        return `<tr>${[
          cell(o._a.name || ""),
          cell((o._a.area as string) || ""),
          cell(o._r.title || ""),
          cell(o.ref || ""),
          cell(o.title || "", "font-weight:bold"),
          cell(o.criticality || "", `background:${cb[0]};color:${cb[1]};font-weight:bold;text-align:center`),
          cell(o.category || ""),
          cell(o.description || ""),
          cell(o.criteria || ""),
          cell(o.risk || ""),
          cell(o.rootCause || ""),
          cell(o.recommendation || ""),
          cell(o.sopUpdate || ""),
          cell(o.managementResponse || ""),
          cell(o.owner || ""),
          cell((o.timeline as string) || ""),
          cell(ec ? fmtDate(ec) : ""),
          cell(o.closedDateISO ? fmtDate(isoToDate(o.closedDateISO)) : ""),
          cell(String(o.status || "Open"), `background:${sb[0]};color:${sb[1]};font-weight:bold;text-align:center`),
          cell(od ? "OVERDUE" : "", od ? "background:#b00020;color:#ffffff;font-weight:bold;text-align:center" : ""),
          cell(o.isRepeat ? "Yes" : "No", o.isRepeat ? "background:#efe3f7;color:#6b3fa0;font-weight:bold;text-align:center" : "text-align:center"),
          cell(o.repeatOf || ""),
          cell(o.raisedByName || ""),
          cell(o.createdAt ? fmtDateTime(o.createdAt) : ""),
        ].join("")}</tr>`;
      })
      .join("");
    const table = `<table>
      <tr><th colspan="${headers.length}" style="background:#0d5a47;color:#ffffff;font-size:13pt;text-align:left;padding:8pt">${esc(db.org || "AuditLens")} — All Audit Observations (${list.length}) · exported ${esc(fmtDate(new Date()))}</th></tr>
      <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      ${rowsHtml}</table>`;
    excelDoc("AuditLens-observations-" + stamp(), table);
  }

  function exportInsightsDoc() {
    if (!obs.length) {
      toast("No observations to analyse.");
      return;
    }
    const themeCount: Record<string, number> = {};
    obs.forEach((o) => rcThemes(o.rootCause).forEach((t) => (themeCount[t] = (themeCount[t] || 0) + 1)));
    const themeRows = Object.entries(themeCount).sort((a, b) => b[1] - a[1]);
    const areas: Record<string, Record<string, number>> = {};
    obs.forEach((o) => {
      const k = (o._a.area as string) || o._a.name;
      areas[k] = areas[k] || zeroCrit();
      areas[k][o.criticality]++;
    });
    const inner = `<h1>Audit Insights</h1><div class="meta">${esc(db.org)} — Internal Audit · thematic analysis across ${obs.length} observation(s)</div>
    <h2>Recurring Root-Cause Themes</h2>
    <table><tr><th>Theme</th><th>Count</th></tr>${themeRows.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v}</td></tr>`).join("")}</table>
    <h2>Risk Heat Map — Process/Department × Criticality</h2>
    <table><tr><th>Area</th>${CRITS.map((c) => `<th>${c}</th>`).join("")}<th>Total</th></tr>
    ${Object.entries(areas)
      .sort((a, b) => CRITS.reduce((s, c) => s + b[1][c], 0) - CRITS.reduce((s, c) => s + a[1][c], 0))
      .map(([k, v]) => {
        const tot = CRITS.reduce((s, c) => s + v[c], 0);
        return `<tr><td>${esc(k)}</td>${CRITS.map((c) => `<td style="text-align:center">${v[c] || ""}</td>`).join("")}<td><b>${tot}</b></td></tr>`;
      })
      .join("")}
    </table>`;
    wordDoc("Audit Insights " + stamp(), inner, typeof db.logo === "string" ? db.logo : undefined);
  }

  usePageChrome(
    {
      title: "Remediation Tracker",
      actions: (
        <>
          <button className="btn sec sm" type="button" onClick={mode === "insights" ? exportInsightsDoc : exportTracker}>
            ⤓ Export {mode === "insights" ? "insights" : "tracker"}
          </button>
          <button className="btn sec sm" type="button" onClick={exportExcelObs}>
            ⤓ All observations (Excel)
          </button>
        </>
      ),
    },
    [mode, obs.length],
  );

  /* ---- header tabs ---- */
  const tabs = (
    <div className="row" style={{ marginBottom: 14 }}>
      {mode === "recent" ? (
        <button className="btn sec sm" type="button" onClick={() => setMode("actions")}>
          ← Back to tracker
        </button>
      ) : (
        <>
          <div className="row" style={{ gap: 6 }}>
            <button className={`btn ${mode === "actions" ? "" : "sec"} sm`} type="button" onClick={() => setMode("actions")}>
              Open Actions
            </button>
            <button className={`btn ${mode === "insights" ? "" : "sec"} sm`} type="button" onClick={() => setMode("insights")}>
              Insights
            </button>
          </div>
          <div className="spacer" />
          {mode === "actions" ? (
            <button className="btn sec sm" type="button" onClick={() => setMode("recent")}>
              View Recent Observations
            </button>
          ) : null}
        </>
      )}
    </div>
  );

  if (!obs.length) {
    return (
      <>
        {tabs}
        <div className="card">
          <Empty big="◷">
            No observations yet. Once you raise observations, every open remediation action shows up
            here — grouped by expected close, with overdue flags.
          </Empty>
        </div>
      </>
    );
  }

  if (mode === "recent") return <>{tabs}<RecentPanel obs={obs} onOpen={goObservation} userId={user.id} /></>;
  if (mode === "insights") return <>{tabs}<InsightsPanel obs={obs} /></>;

  /* ---- Open Actions mode ---- */
  const isOver = (o: ObsWithContext) => isOverdueObs(o, o._r);
  const openAll = obs.filter((o) => o.status !== "Closed");
  const readyCount = openAll.filter(readyToClose).length;
  const recentClosed = obs
    .filter((o) => (o.status || "Open") === "Closed")
    .sort((a, b) => String(b.closedDateISO || "").localeCompare(String(a.closedDateISO || "")));
  const watch = openAll.filter((o) => {
    const d = daysToClose(o, o._r);
    return d != null && d >= 0 && d <= 14;
  }).length;
  const overdue = openAll.filter(isOver).length;
  const repeats = openAll.filter((o) => o.isRepeat).length;

  let pool = obs.slice();
  if (filter.crit !== "All") pool = pool.filter((o) => o.criticality === filter.crit);
  if (filter.repeat) pool = pool.filter((o) => o.isRepeat);
  const statusF = filter.status;
  const tlF = filter.tl;
  const showOpenGroups = statusF !== "Closed";
  const showClosedGroup = statusF === "All" || statusF === "Closed";
  const passStatus = (o: ObsWithContext) => statusF === "All" || (o.status || "Open") === statusF;
  const filtersActive = filter.crit !== "All" || statusF !== "All" || tlF !== "All" || filter.repeat;
  const bucketOf = (o: ObsWithContext) => closeBucket(daysToClose(o, o._r)) ?? "No date";

  const CLOSE_GROUPS = ["Ready to Close", ...CLOSE_BUCKETS, "No date", "Recently Closed"];
  const groupLabel = (g: string) =>
    g === "No date" ? "No expected close date" : g === "Ready to Close" ? "Ready to close — awaiting verification" : g === "Recently Closed" ? "Recently closed" : g;
  const kpiActive: Record<string, boolean> = {
    ready: tlF === "Ready to Close",
    closed: tlF === "Recently Closed",
    watch: tlF === "≤ 2 weeks",
    overdue: tlF === "Overdue",
    repeat: filter.repeat,
    open: !filtersActive,
  };
  const applyKpi = (which: string) =>
    setFilter((f) => {
      const n = { ...f };
      if (which === "open") return { crit: "All", tl: "All", status: "All", repeat: false };
      if (which === "ready") n.tl = f.tl === "Ready to Close" ? "All" : "Ready to Close";
      else if (which === "watch") n.tl = f.tl === "≤ 2 weeks" ? "All" : "≤ 2 weeks";
      else if (which === "overdue") n.tl = f.tl === "Overdue" ? "All" : "Overdue";
      else if (which === "closed") { n.status = "All"; n.tl = f.tl === "Recently Closed" ? "All" : "Recently Closed"; }
      else if (which === "repeat") n.repeat = !f.repeat;
      return n;
    });

  const groups = CLOSE_GROUPS.map((g) => {
    if (tlF !== "All" && tlF !== g) return null;
    let rows: ObsWithContext[];
    if (g === "Ready to Close") {
      if (!showOpenGroups) return null;
      rows = pool.filter((o) => readyToClose(o) && passStatus(o));
      rows.sort((a, b) => String(b.ownerRectifiedAt || "").localeCompare(String(a.ownerRectifiedAt || "")));
    } else if (g === "Recently Closed") {
      if (!showClosedGroup) return null;
      rows = pool
        .filter((o) => (o.status || "Open") === "Closed")
        .sort((a, b) => String(b.closedDateISO || "").localeCompare(String(a.closedDateISO || "")))
        .slice(0, 50);
    } else {
      if (!showOpenGroups) return null;
      rows = pool.filter((o) => (o.status || "Open") !== "Closed" && !readyToClose(o) && passStatus(o) && bucketOf(o) === g);
      rows.sort(
        (a, b) =>
          String(b.createdAt || "").localeCompare(String(a.createdAt || "")) ||
          CRITS.indexOf(a.criticality) - CRITS.indexOf(b.criticality),
      );
    }
    if (!rows.length) return null;
    return { g, rows };
  }).filter(Boolean) as { g: string; rows: ObsWithContext[] }[];

  return (
    <>
      {tabs}
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
        {(
          [
            ["closed", "good", "Recently closed", recentClosed.length, "verified & closed"],
            ["ready", "good", "Ready to close", readyCount, "awaiting verification"],
            ["open", "base", "Open actions", openAll.length, "across all audits"],
            ["watch", "warn", "Watchlist", watch, "due within 2 weeks"],
            ["overdue", "warn", "Overdue", overdue, "past expected close"],
            ["repeat", "accent", "Repeat findings", repeats, "recur from prior audits"],
          ] as [string, string, string, number, string][]
        ).map(([which, tone, label, value, sub]) => (
          <div
            key={which}
            className={`kpi-click${kpiActive[which] ? " active" : ""}`}
            onClick={() => applyKpi(which)}
            title="Click to filter"
          >
            <Kpi tone={tone} label={label} value={value} sub={sub} />
          </div>
        ))}
      </div>

      <div className="card tracker-filters">
        <div className="filter-row filter-row-right">
          <div className="filter-group">
            <span className="filter-label">Expected close</span>
            <select className="field-select field-select-sm" value={tlF} onChange={(e) => setFilter((f) => ({ ...f, tl: e.target.value }))}>
              <option value="All">All</option>
              {CLOSE_GROUPS.map((x) => (
                <option key={x} value={x}>
                  {groupLabel(x)}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label">Criticality</span>
            <select className="field-select field-select-sm" value={filter.crit} onChange={(e) => setFilter((f) => ({ ...f, crit: e.target.value }))}>
              {["All", ...CRITS].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <select className="field-select field-select-sm" value={statusF} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
              {["All", ...STATUSES].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <label className="filter-check" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={filter.repeat}
              onChange={(e) => setFilter((f) => ({ ...f, repeat: e.target.checked }))}
            />{" "}
            Repeats only
          </label>
          {filtersActive ? (
            <button className="btn ghost sm" type="button" onClick={() => setFilter({ crit: "All", tl: "All", status: "All", repeat: false })}>
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {groups.length ? (
        groups.map(({ g, rows }) => (
          <div className="card" key={g}>
            <div className="row" style={{ marginBottom: 10, alignItems: "center" }}>
              <span className="dot" style={{ width: 11, height: 11, borderRadius: 3, background: BCOL[g], display: "inline-block" }} />
              <div className="seclabel" style={{ margin: 0 }}>
                {groupLabel(g)}
              </div>
              <div className="hint">
                {rows.length} action{rows.length !== 1 ? "s" : ""}
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Criticality</th>
                  <th>Action / observation</th>
                  <th>Audit · Report</th>
                  <th>Owner</th>
                  <th>{g === "Ready to Close" ? "Submitted" : g === "Recently Closed" ? "Closed" : "Expected close"}</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const od = isOver(o);
                  const ec = effectiveClose(o, o._r);
                  return (
                    <tr className="tracker-row" key={o.id} onClick={() => goObservation(o)} title="Open observation">
                      <td>
                        <CritPill crit={o.criticality} />
                        {o.isRepeat ? (
                          <div style={{ marginTop: 4 }}>
                            <span className="pill" style={{ background: "#efe3f7", color: "#6b3fa0" }}>
                              ↻ REPEAT
                            </span>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <b>{o.title}</b>
                        {o.recommendation ? <div className="hint">{o.recommendation}</div> : null}
                      </td>
                      <td>
                        {o._a.name}
                        <div className="hint">
                          {o._r.title}
                          {o._a.area ? " · " + o._a.area : ""}
                        </div>
                      </td>
                      <td>{o.owner || "—"}</td>
                      <td>
                        {g === "Ready to Close" ? (
                          o.ownerRectifiedAt ? fmtDate(isoToDate(o.ownerRectifiedAt)) : "—"
                        ) : g === "Recently Closed" ? (
                          o.closedDateISO ? fmtDate(isoToDate(o.closedDateISO)) : "—"
                        ) : ec ? (
                          <>
                            {fmtDate(ec)}
                            {od ? (
                              <>
                                {" "}
                                <span className="pill c-Critical">overdue</span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td>
                        <div className="tracker-status-cell">
                          <StatusPill status={o.status} />
                          {o.closureRejection && (o.status || "Open") !== "Closed" ? (
                            <span className="pill" style={{ background: "#fdefe6", color: "#c05621" }} title="Returned by the Head of Audit">
                              ↩ returned
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <div className="card">
          <Empty big="🔍">
            No actions match the current filter.
            <br />
            Try clearing the search or filters to see all open actions.
          </Empty>
        </div>
      )}
    </>
  );
}

/* ---- Recent Observations mode ---- */

function RecentPanel({
  obs,
  onOpen,
  userId,
}: {
  obs: ObsWithContext[];
  onOpen: (o: ObsWithContext) => void;
  userId: string;
}) {
  const evs: { at: string; type: string; label: string; o: ObsWithContext }[] = [];
  obs.forEach((o) => {
    if (o.createdAt) evs.push({ at: o.createdAt, type: "opened", label: "New observation opened", o });
    (o.updates || []).forEach((u) => {
      if (u.audience === "owner" && !(userId && (u.by === userId || o.ownerUserId === userId || o.secondaryOwnerUserId === userId))) return;
      if (u.audience === "ia_only") return;
      const mine = !!userId && u.by === userId;
      const owner = u.role === "action_owner";
      const label = mine
        ? u.kind === "progress" ? "You posted a progress report" : "You commented"
        : owner
          ? u.kind === "progress" ? "Progress report from " + (u.byName || "the action owner") : "Action owner responded"
          : (u.byName || "A colleague") + " commented";
      evs.push({ at: u.at, type: mine ? "you" : owner ? "owner" : "comment", label, o });
    });
    if (o.ownerRectifiedAt) evs.push({ at: o.ownerRectifiedAt, type: "ready", label: "Marked Ready for Closure", o });
    if ((o.status || "Open") === "Closed" && o.closedDateISO) evs.push({ at: o.closedDateISO, type: "closed", label: "Observation closed", o });
  });
  const list = evs.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  if (!list.length)
    return (
      <div className="card">
        <Empty>No recent activity yet.</Empty>
      </div>
    );
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="seclabel">Recent observations</div>
      <div className="tracker-recent">
        {list.map((e, i) => (
          <div className="tracker-recent-row" key={i} onClick={() => onOpen(e.o)} title="Open observation">
            <div className="tracker-recent-main">
              <b>{e.label}</b>
              <div className="hint">{e.o.title}</div>
            </div>
            <CritPill crit={e.o.criticality} />
            <span className="hint" style={{ whiteSpace: "nowrap", color: RECENT_COL[e.type] }}>
              {timeAgo(e.at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Insights mode ---- */

function InsightsPanel({ obs }: { obs: ObsWithContext[] }) {
  const themeCount: Record<string, number> = {};
  const themeAreas: Record<string, Set<string>> = {};
  obs.forEach((o) =>
    rcThemes(o.rootCause).forEach((t) => {
      themeCount[t] = (themeCount[t] || 0) + 1;
      (themeAreas[t] = themeAreas[t] || new Set()).add((o._a.area as string) || o._a.name);
    }),
  );
  const themeRows = Object.entries(themeCount).sort((a, b) => b[1] - a[1]);
  const maxTheme = Math.max(1, ...themeRows.map((r) => r[1]));
  const areas: Record<string, Record<string, number>> = {};
  obs.forEach((o) => {
    const k = (o._a.area as string) || o._a.name;
    areas[k] = areas[k] || zeroCrit();
    areas[k][o.criticality]++;
  });
  const areaRows = Object.entries(areas)
    .map(([k, v]) => [k, v, CRITS.reduce((s, c) => s + v[c], 0)] as [string, Record<string, number>, number])
    .sort((a, b) => b[2] - a[2])
    .slice(0, 12);
  const maxCell = Math.max(1, ...areaRows.flatMap(([, v]) => CRITS.map((c) => v[c])));
  const colLab: Record<string, string> = { Critical: "Critical", High: "High", Moderate: "Moderate", Low: "Low", "Process Improvement": "Proc. Improve" };

  return (
    <>
      <div className="card">
        <div className="seclabel">Recurring root-cause themes</div>
        <p className="hint" style={{ marginTop: -6 }}>
          How often each underlying cause appears across observations (a finding can map to more
          than one theme). The longest bars are your systemic focus areas.
        </p>
        {themeRows.map(([t, v]) => (
          <div className="rcrow" key={t}>
            <div className="nm" title={[...(themeAreas[t] || [])].join(", ")}>
              {t}
            </div>
            <div className="track">
              <div className="fill" style={{ width: `${(v / maxTheme) * 100}%` }} />
            </div>
            <div className="vv">{v}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="seclabel">Risk heat map — process / department × criticality</div>
        <p className="hint" style={{ marginTop: -6 }}>
          Cell colour = severity; intensity = number of observations. Dense red rows are the areas
          needing most focus.
        </p>
        <table className="hm">
          <thead>
            <tr>
              <th className="axis">Process / Department</th>
              {CRITS.map((c) => (
                <th key={c}>{colLab[c]}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {areaRows.map(([k, v, tot]) => (
              <tr key={k}>
                <td className="axis">{k}</td>
                {CRITS.map((c) => {
                  const n = v[c];
                  const bg = n ? hx2rgba(CRIT_HEX[c], 0.16 + 0.8 * (n / maxCell)) : "#f7f9fb";
                  return (
                    <td key={c} className="cell" style={{ background: bg, color: n && n / maxCell > 0.55 ? "#fff" : "#1c2733" }}>
                      {n || ""}
                    </td>
                  );
                })}
                <td className="cell" style={{ background: "#f1f5f9" }}>
                  <b>{tot}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
