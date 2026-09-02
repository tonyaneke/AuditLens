"use client";

// External Audit & Regulatory Findings Register view — port of viewExternal/extRegister/
// extInsights from public/audit-bot.js with ?mode=register|insights as URL state.

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty, Kpi, TintPill } from "@/components/ui";
import {
  clusterExt,
  ensureExtList,
  extCoverageCross,
  extMatches,
  extOverdue,
  extStatusCls,
  EXT_SEV_HEX,
  EXT_SEVERITIES,
  EXT_SOURCES,
  EXT_THEMES,
  type ExtFilter,
} from "@/lib/workspace/external";
import { isInternalAudit } from "@/lib/workspace/observations";
import { fmtDate, hx2rgba, isoNow, isoToDate } from "@/lib/workspace/selectors";
import type { ExtFinding, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ExtCommentaryDialog,
  ExtEditDialog,
  ExtImportDialog,
  ExtRaiseDialog,
} from "./lazy";
import { exportAllExtFindingsCsv } from "./exports";

const ExtRemindersDialog = dynamic(() => import("./ExtRemindersDialog"), { loading: () => null });

const STATUSES = ["Open", "In Progress", "Closed"];

export default function ExternalPage() {
  const { db, mutate, version } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const search = useSearchParams();
  const mode = search.get("mode") === "insights" ? "insights" : "register";
  const canRemind = isInternalAudit(user);

  const [q, setQ] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [themeFilter, setThemeFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const list = ensureExtList(db);

  usePageChrome(
    {
      title: "External Findings Register",
      actions: (
        <div style={{ display: "flex", gap: 8 }}>
          {canRemind ? (
            <button
              className="btn sec sm"
              type="button"
              onClick={() => modal.open(<ExtRemindersDialog />)}
            >
              🔔 Remind owners
            </button>
          ) : null}
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
    },
    [version, canRemind],
  );

  const setMode = (m: string) =>
    router.replace(m === "register" ? "/external" : `/external?mode=${m}`);

  /* ---- port of extSetStatus ---- */
  function setStatus(id: string, v: string) {
    mutate((d) => {
      const f = (d.extFindings || []).find((x) => x.id === id);
      if (!f) return;
      if (v === "Closed" && !f.closedDateISO) f.closedDateISO = isoNow();
      if (v !== "Closed") f.closedDateISO = "";
      f.status = v;
    });
  }

  /* ---- port of modalDelExt / delExt ---- */
  function delExt(f: ExtFinding) {
    void modal.confirm({
      title: "Delete finding",
      message: (
        <>
          Delete finding <b>{f.title}</b>? This cannot be undone.
        </>
      ),
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.extFindings = (d.extFindings || []).filter((x) => x.id !== f.id);
        });
      },
    });
  }

  /* ---- legacy empty state (viewExternal) ---- */
  if (!list.length) {
    return (
      <div className="card">
        <Empty big="❖">
          No external findings yet.
          <br />
          <br />
          <button className="btn dark" type="button" onClick={() => modal.open(<ExtImportDialog />)}>
            ⤒ Import findings
          </button>
          {"  "}
          <button className="btn" type="button" onClick={() => modal.open(<ExtRaiseDialog />)}>
            + Add finding
          </button>
        </Empty>
      </div>
    );
  }

  /* ---- Register | Insights tabs (legacy extMode switch) ---- */
  const tabs = (
    <div className="row" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 6 }}>
        <button
          className={`btn ${mode === "register" ? "" : "sec"} sm`}
          type="button"
          onClick={() => setMode("register")}
        >
          Register
        </button>
        <button
          className={`btn ${mode === "insights" ? "" : "sec"} sm`}
          type="button"
          onClick={() => setMode("insights")}
        >
          Insights
        </button>
      </div>
      <div className="spacer" />
      <span className="hint">{list.length} finding(s)</span>
    </div>
  );

  if (mode === "insights") {
    return (
      <>
        {tabs}
        <ExtInsightsPanel db={db} onOpenCommentary={() => modal.open(<ExtCommentaryDialog />)} />
      </>
    );
  }

  /* ---- register KPI summary cards (legacy extRegister kpi() calls) ---- */
  const open = list.filter((f) => f.status !== "Closed").length;
  const closed = list.length - open;
  const overdue = list.filter(extOverdue).length;
  const reps = list.filter((f) => f.isRepeat).length;

  /* ---- filters (legacy extFilter + the newer severity filter) ---- */
  const sources = [...new Set(list.map((f) => f.source).filter(Boolean))] as string[];
  const sourceChoices = [
    "All",
    ...EXT_SOURCES.filter((s) => sources.includes(s)),
    ...sources.filter((s) => !EXT_SOURCES.includes(s)),
  ];
  const years = [...new Set(list.map((f) => String(f.year || "")).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a),
  );

  const base: ExtFilter = {
    q: "",
    source: sourceFilter,
    theme: themeFilter,
    status: statusFilter,
    year: yearFilter,
  };
  const qt = q.toLowerCase().trim();
  const filtered = list.filter((f) => {
    if (!extMatches(f, base)) return false;
    if (severityFilter !== "All" && f.severity !== severityFilter) return false;
    if (qt) {
      const h = (
        f.title +
        " " +
        (f.detail || "") +
        " " +
        (f.recommendation || "") +
        " " +
        (f.source || "") +
        " " +
        (f.sourceRef || "") +
        " " +
        (f.ref || "") +
        " " +
        (f.theme || "") +
        " " +
        (f.year || "") +
        " " +
        (f.owner || "")
      ).toLowerCase();
      if (!h.includes(qt)) return false;
    }
    return true;
  });
  // Legacy sort: overdue first, then by source.
  const rows = filtered
    .slice()
    .sort(
      (a, b) =>
        Number(extOverdue(b)) - Number(extOverdue(a)) ||
        String(a.source || "").localeCompare(String(b.source || "")),
    );

  return (
    <div>
      {tabs}

      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <Kpi tone="base" label="Findings" value={list.length} sub={open + " open · " + closed + " closed"} />
        <Kpi tone="warn" label="Unresolved" value={open} sub={overdue + " of them overdue"} icon="alert" />
        <Kpi tone="accent" label="Repeat findings" value={reps} sub="recur across audits" icon="obs" />
        <Kpi
          tone="good"
          label="Closure rate"
          value={(list.length ? Math.round((closed / list.length) * 100) : 0) + "%"}
          sub={closed + " of " + list.length + " closed"}
          icon="check"
        />
      </div>

      <div className="card" style={{ padding: "12px 16px" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            value={q}
            placeholder="Search findings…"
            style={{ maxWidth: 220 }}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="mini" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            {sourceChoices.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="mini" value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)}>
            {["All", ...EXT_THEMES].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="mini" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            {["All", ...years].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <select
            className="mini"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option>All</option>
            {EXT_SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="mini" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {["All", ...STATUSES].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <div className="spacer" />
          <span className="hint">
            {filtered.length} of {list.length}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty big="🔍">
            No findings match the filter.
            <br />
            Try clearing the search or filters.
          </Empty>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="dt-table">
            <thead>
              <tr>
                <th scope="col">Ref</th>
                <th scope="col">Title &amp; Source</th>
                <th scope="col">Theme</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Owner</th>
                <th scope="col">Target Date</th>
                <th scope="col" style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const st = f.status || "Open";
                return (
                  <tr
                    key={f.id}
                    className="ext-row-clickable"
                    onClick={() => router.push(`/external/${f.id}`)}
                  >
                    <td>
                      <b>{f.ref || f.id}</b>
                    </td>
                    <td>
                      <Link
                        href={`/external/${f.id}`}
                        className="ext-row-title"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {f.title}
                      </Link>
                      <div className="meta">
                        {f.source} {f.year ? `(${f.year})` : ""}
                      </div>
                      {f.isRepeat ? (
                        <div style={{ marginTop: 3 }}>
                          <span className="pill" style={{ background: "#efe3f7", color: "#6b3fa0" }}>
                            ↻ REPEAT
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>{f.theme || "—"}</td>
                    <td>
                      {f.severity ? (
                        <TintPill hex={EXT_SEV_HEX[f.severity] || "#64748b"}>{f.severity}</TintPill>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`status-select status-${extStatusCls(st)}`}
                        value={st}
                        onChange={(e) => setStatus(f.id, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{f.owner || "—"}</td>
                    <td className="meta">
                      {f.targetDate ? fmtDate(isoToDate(f.targetDate)) || f.targetDate : "—"}
                      {extOverdue(f) ? (
                        <>
                          {" "}
                          <span className="pill c-Critical">overdue</span>
                        </>
                      ) : null}
                    </td>
                    <td
                      style={{ textAlign: "right", whiteSpace: "nowrap" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn sec sm"
                        style={{ marginRight: 6 }}
                        onClick={() => modal.open(<ExtEditDialog findingId={f.id} />)}
                      >
                        Edit
                      </button>
                      <Link
                        href={`/external/${f.id}`}
                        className="btn pri sm"
                        style={{ marginRight: 6 }}
                      >
                        View
                      </Link>
                      <button className="btn ghost sm danger" onClick={() => delExt(f)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Insights (port of extInsights) ---------------- */

function ExtInsightsPanel({
  db,
  onOpenCommentary,
}: {
  db: WorkspaceDb;
  onOpenCommentary: () => void;
}) {
  const F = db.extFindings || [];
  const themeC: Record<string, number> = {};
  F.forEach((f) => {
    const t = f.theme || "Other";
    themeC[t] = (themeC[t] || 0) + 1;
  });
  const themeRows = Object.entries(themeC).sort((a, b) => b[1] - a[1]);
  const maxTheme = Math.max(1, ...themeRows.map((r) => r[1]));
  const srcs: Record<string, { t: number; closed: number; overdue: number }> = {};
  F.forEach((f) => {
    const s = f.source || "Other";
    (srcs[s] = srcs[s] || { t: 0, closed: 0, overdue: 0 }).t++;
    if (f.status === "Closed") srcs[s].closed++;
    if (extOverdue(f)) srcs[s].overdue++;
  });
  const srcRows = Object.entries(srcs).sort((a, b) => b[1].t - a[1].t);
  const topSrc = srcRows.slice(0, 6).map((r) => r[0]);
  const heat: Record<string, Record<string, number>> = {};
  F.forEach((f) => {
    const t = f.theme || "Other",
      s = f.source || "Other";
    (heat[t] = heat[t] || {})[s] = (heat[t][s] || 0) + 1;
  });
  const maxHeat = Math.max(
    1,
    ...themeRows.map(([t]) => Math.max(0, ...topSrc.map((s) => (heat[t] && heat[t][s]) || 0))),
  );
  const clusters = clusterExt(F);
  const cross = extCoverageCross(db);
  const covered = cross.filter((c) => c.bs >= 0.4);
  const blind = cross.filter((c) => c.bs < 0.4);

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Strategic view of external &amp; regulatory findings.
        </div>
        <div className="spacer" />
        <button className="btn ghost sm ai-generate-btn" type="button" onClick={onOpenCommentary}>
          Generate insight commentary
        </button>
      </div>
      {db.extCommentary ? <div className="note">{db.extCommentary}</div> : null}

      <div className="card">
        <div className="seclabel">Recurring areas of concern (by theme)</div>
        {themeRows.map(([t, v]) => (
          <div className="rcrow" key={t}>
            <div className="nm">{t}</div>
            <div className="track">
              <div className="fill" style={{ width: `${(v / maxTheme) * 100}%` }} />
            </div>
            <div className="vv">{v}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="seclabel">Theme × source heat map</div>
        <table className="hm">
          <thead>
            <tr>
              <th scope="col" className="axis">Theme</th>
              {topSrc.map((s) => (
                <th scope="col" key={s}>{s}</th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {themeRows.map(([t, tot]) => (
              <tr key={t}>
                <td className="axis">{t}</td>
                {topSrc.map((s) => {
                  const n = (heat[t] && heat[t][s]) || 0;
                  const bg = n ? hx2rgba("#b00020", 0.14 + 0.8 * (n / maxHeat)) : "#f7f9fb";
                  return (
                    <td
                      key={s}
                      className="cell"
                      style={{ background: bg, color: n && n / maxHeat > 0.55 ? "#fff" : "#1c2733" }}
                    >
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

      <div className="card">
        <div className="seclabel">Source scorecard</div>
        <table>
          <thead>
            <tr>
              <th scope="col">External body</th>
              <th scope="col">Findings</th>
              <th scope="col">Closed</th>
              <th scope="col">Closure rate</th>
              <th scope="col">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {srcRows.map(([s, v]) => (
              <tr key={s}>
                <td>{s}</td>
                <td>{v.t}</td>
                <td>{v.closed}</td>
                {/* QA-21 — an unguarded divide rendered "NaN%" whenever a source had no rows. */}
                <td>{v.t ? Math.round((v.closed / v.t) * 100) : 0}%</td>
                <td>{v.overdue ? <span className="pill c-High">{v.overdue}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="seclabel">Repeat / recurring findings</div>
        {clusters.length ? (
          clusters.map((cl, i) => (
            <div
              key={i}
              className="obs-block"
              style={{
                padding: "11px 13px",
                marginBottom: 10,
                background: "#f3eef8",
                borderColor: "#d4c4e8",
              }}
            >
              <div className="row">
                <b style={{ flex: 1 }}>{cl.rep}</b>
                <span className="pill" style={{ background: "#efe3f7", color: "#6b3fa0" }}>
                  ×{cl.items.length}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 5 }}>
                Raised by:{" "}
                {cl.items
                  .map((x) => (x.source || "?") + (x.year ? " " + x.year : ""))
                  .filter((v, ix, ar) => ar.indexOf(v) === ix)
                  .join(" · ")}
              </div>
            </div>
          ))
        ) : (
          <div className="hint">
            No recurring findings detected yet (auto-detected by fuzzy match). Flag known repeats on
            each finding, or they&apos;ll cluster here as more are added.
          </div>
        )}
      </div>

      <div className="card">
        <div className="seclabel">Internal Audit coverage cross-reference</div>
        <div className="row" style={{ gap: 18 }}>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#2e7d32" }}>{covered.length}</div>
            <div className="hint">
              also identified by Internal Audit
              <br />
              (validates IA coverage)
            </div>
          </div>
          <div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "var(--crit)" }}>{blind.length}</div>
            <div className="hint">
              not matched to an IA observation
              <br />
              (potential coverage gap)
            </div>
          </div>
        </div>
        {blind.length ? (
          <>
            <div className="seclabel" style={{ marginTop: 14 }}>
              Potential coverage gaps
            </div>
            <table>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Finding</th>
                  <th scope="col">Theme</th>
                </tr>
              </thead>
              <tbody>
                {blind.slice(0, 10).map((c) => (
                  <tr key={c.f.id}>
                    <td>{c.f.source || "—"}</td>
                    <td>{c.f.title}</td>
                    <td>{c.f.theme || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blind.length > 10 ? (
              <div className="hint" style={{ marginTop: 6 }}>
                Showing 10 of {blind.length}.
              </div>
            ) : null}
          </>
        ) : null}
        <div className="hint" style={{ marginTop: 8 }}>
          Matched by fuzzy title similarity to your internal observations — indicative, review
          before relying on it.
        </div>
      </div>
    </div>
  );
}
