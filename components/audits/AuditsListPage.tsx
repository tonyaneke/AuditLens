"use client";

// Audits & Reports list — React port of viewAudits/auditListHTML/auditCard/reportCard.
// Audit/report detail pages are still legacy: cards link through the route map, which
// hands over to /legacy until those views migrate.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { Empty } from "@/components/ui";
import { hrefForView } from "@/lib/routes";
import {
  ck,
  CRITS,
  hx2rgba,
  zeroCrit,
} from "@/lib/workspace/selectors";
import type { Audit, Report } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const AUDIT_STATUS = ["Planned", "In progress", "Completed", "On hold"];
const AUDIT_STATUS_HEX: Record<string, string> = {
  Planned: "#64748b",
  "In progress": "#c9a300",
  Completed: "#2e7d32",
  "On hold": "#b00020",
};

function periodKey(p: string | undefined): number {
  const s = p || "";
  const ym = s.match(/(20\d{2})/);
  const qm = s.match(/Q\s*([1-4])/i);
  return (ym ? +ym[1] : 0) * 10 + (qm ? +qm[1] : 0);
}
function periodYear(p: string | undefined): string {
  const m = (p || "").match(/(20\d{2})/);
  return m ? m[1] : "";
}

function navTo(href: string) {
  window.location.assign(href);
}

function AuditCard({ a }: { a: Audit }) {
  const obs = (a.reports || []).flatMap((r) => r.observations || []);
  const c = zeroCrit();
  obs.forEach((o) => c[o.criticality]++);
  const sh = AUDIT_STATUS_HEX[a.status || ""] || "#64748b";
  const open = obs.filter((o) => o.status !== "Closed").length;
  return (
    <div className="entity-card" onClick={() => navTo(hrefForView("audit", { audit: a.id }))}>
      <div className="entity-card-head">
        <div className="entity-card-icon audit-icon" aria-hidden="true">▤</div>
        <div className="entity-card-main">
          <div className="entity-card-title">{a.name}</div>
          <div className="entity-card-meta">
            {(a.area as string) || "—"}
            {a.period ? " · " + a.period : ""}
            {a.leadAuditor ? " · Lead: " + a.leadAuditor : ""}
          </div>
        </div>
        <div className="entity-card-tags">
          {a.status ? (
            <span className="pill" style={{ background: hx2rgba(sh, 0.16), color: sh }}>
              {a.status}
            </span>
          ) : null}
          <span className="tag">{a.type === "department" ? "Department" : "Process"}</span>
          <span className="tag">
            {(a.reports || []).length} report{(a.reports || []).length !== 1 ? "s" : ""}
          </span>
          {obs.length ? <span className="tag">{obs.length} obs.</span> : null}
        </div>
      </div>
      <div className="entity-card-foot">
        {obs.length ? (
          <div className="mini-tiles">
            {CRITS.filter((k) => c[k]).map((k) => (
              <span key={k} className={`mini-tile c-${ck(k)}`}>
                {c[k]} {k}
              </span>
            ))}
            {open ? <span className="tag">{open} open</span> : null}
          </div>
        ) : (
          <span className="hint">No observations yet</span>
        )}
      </div>
    </div>
  );
}

function ReportCard({ a, r }: { a: Audit; r: Report }) {
  const c = zeroCrit();
  (r.observations || []).forEach((o) => c[o.criticality]++);
  return (
    <div
      className="entity-card"
      onClick={() => navTo(hrefForView("report", { audit: a.id, report: r.id }))}
    >
      <div className="entity-card-head">
        <div className="entity-card-icon report-icon" aria-hidden="true">▦</div>
        <div className="entity-card-main">
          <div className="entity-card-title">{r.title}</div>
          <div className="entity-card-meta">
            {a.name}
            {r.refNo ? " · " + r.refNo : ""}
            {r.period ? " · " + r.period : ""}
          </div>
        </div>
        <div className="entity-card-tags">
          <span className="tag">
            {(r.observations || []).length} obs.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function AuditsListPage() {
  const { db } = useWorkspace();
  const user = useUser();
  const isStaff = user.role !== "head_of_audit" && user.role !== "action_owner";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("All");
  const [period, setPeriod] = useState("All");
  const [year, setYear] = useState("All");
  const [mine, setMine] = useState(isStaff);

  const audits = db.audits || [];

  usePageChrome(
    {
      title: "Audits & Reports",
      search: (
        <input
          className="topbar-search"
          placeholder="Search audits, reports, refs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ),
      actions:
        user.role === "head_of_audit" ? (
          // The create-audit dialog is still legacy — deep-link opens it directly.
          <a className="btn sm" href="/audits/new">
            + New audit
          </a>
        ) : undefined,
    },
    [q],
  );

  if (!audits.length) {
    return (
      <div className="card">
        <Empty big="▤">
          No audits yet.
          <br />
          <br />
          {isStaff ? (
            "Ask your Head of Audit to create an audit and assign you as lead."
          ) : (
            <a className="btn" href="/audits/new">
              + Create your first audit
            </a>
          )}
        </Empty>
      </div>
    );
  }

  const ql = q.toLowerCase().trim();
  const matches = (a: Audit) => {
    if (status !== "All" && (a.status || "") !== status) return false;
    if (year !== "All" && periodYear(a.period) !== year) return false;
    if (period !== "All" && (a.period || "") !== period) return false;
    if (mine && a.leadAuditorId !== user.id) return false;
    if (ql) {
      const hay = (
        a.name + " " + ((a.area as string) || "") + " " + (a.period || "") + " " + (a.leadAuditor || "") + " " +
        (a.reports || []).map((r) => r.title + " " + (r.refNo || "")).join(" ")
      ).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  };

  const periods = [...new Set(audits.map((a) => a.period || "").filter(Boolean))].sort(
    (x, y) => periodKey(y) - periodKey(x),
  );
  const years = [...new Set(audits.map((a) => periodYear(a.period)).filter(Boolean))].sort(
    (x, y) => +y - +x,
  );
  const list = audits.filter(matches);

  // Matching reports surface directly when searching.
  const reps: { a: Audit; r: Report }[] = [];
  if (ql) {
    audits.forEach((a) =>
      (a.reports || []).forEach((r) => {
        const hay = ((r.title || "") + " " + (r.refNo || "") + " " + (r.period || "") + " " + (a.name || "") + " " + ((a.area as string) || "")).toLowerCase();
        if (hay.includes(ql)) reps.push({ a, r });
      }),
    );
  }

  const sorted = list.slice().sort((a, b) => periodKey(b.period) - periodKey(a.period) || a.name.localeCompare(b.name));
  const groups: { k: string; items: Audit[] }[] = [];
  const idx: Record<string, number> = {};
  sorted.forEach((a) => {
    const k = a.period || "No period set";
    if (idx[k] == null) {
      idx[k] = groups.length;
      groups.push({ k, items: [] });
    }
    groups[idx[k]].items.push(a);
  });

  const filtersActive = status !== "All" || period !== "All" || year !== "All" || mine || !!ql;

  return (
    <>
      <div className="audit-filters-bar filter-row-right anim-fade-in">
        <span className="hint">
          {list.length} of {audits.length} audits
        </span>
        <div className="spacer" />
        <div className="filter-group">
          <span className="filter-label">Year</span>
          <select className="field-select field-select-sm" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="All">All years</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Quarter</span>
          <select className="field-select field-select-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="All">All quarters</option>
            {periods.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Status</span>
          <select className="field-select field-select-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            {["All", ...AUDIT_STATUS].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <label className="filter-check" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={mine} onChange={(e) => setMine(e.target.checked)} />{" "}
          Assigned to me
        </label>
        {filtersActive ? (
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => {
              setQ("");
              setStatus("All");
              setPeriod("All");
              setYear("All");
              setMine(false);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {reps.length ? (
        <div className="audit-quarter-group">
          <div className="audit-quarter-head">
            <span className="seclabel" style={{ margin: 0 }}>Matching reports</span>
            <span className="hint">
              {reps.length} report{reps.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="entity-card-grid">
            {reps.map((x) => (
              <ReportCard key={x.r.id} a={x.a} r={x.r} />
            ))}
          </div>
        </div>
      ) : null}

      {!list.length && !reps.length ? (
        <div className="card">
          <Empty big="🔍">
            No audits or reports match the current filter.
            <br />
            Try clearing the search or filters to see everything.
          </Empty>
        </div>
      ) : (
        groups.map((g) => (
          <div className="audit-quarter-group" key={g.k}>
            <div className="audit-quarter-head">
              <span className="seclabel" style={{ margin: 0 }}>{g.k}</span>
              <span className="hint">
                {g.items.length} audit{g.items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="entity-card-grid">
              {g.items.map((a) => (
                <AuditCard key={a.id} a={a} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
