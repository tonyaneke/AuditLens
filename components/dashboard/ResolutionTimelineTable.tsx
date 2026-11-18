"use client";

import { useMemo } from "react";
import type { ObsWithContext } from "@/lib/workspace/selectors";

interface TimelinePeriodEntry {
  key: string;
  label: string;
  year: number;
  quarter: number;
  total: number;
  closed: number;
  open: number;
  pctResolved: number;
  items: ObsWithContext[];
  openItems: ObsWithContext[];
}

function parseTimelinePeriod(o: ObsWithContext): { key: string; label: string; year: number; quarter: number } {
  const raw = (o._r?.period || o._a?.period || "").trim();

  // Pattern 1: "Q1 2026" or "Q1, 2026" or "Q1 - 2026"
  const mQuarterYear = raw.match(/Q([1-4])\s*[-/,]?\s*(\d{4})/i);
  if (mQuarterYear) {
    const q = parseInt(mQuarterYear[1], 10);
    const y = parseInt(mQuarterYear[2], 10);
    return { key: `Q${q} ${y}`, label: `Quarter ${q} ${y}`, year: y, quarter: q };
  }

  // Pattern 2: "Quarter 1 2026"
  const mFullQuarter = raw.match(/Quarter\s*([1-4])\s*[-/,]?\s*(\d{4})/i);
  if (mFullQuarter) {
    const q = parseInt(mFullQuarter[1], 10);
    const y = parseInt(mFullQuarter[2], 10);
    return { key: `Q${q} ${y}`, label: `Quarter ${q} ${y}`, year: y, quarter: q };
  }

  // Pattern 3: Quarter only, year from audit name or dates
  const mQuarterOnly = raw.match(/Q([1-4])/i);
  const auditText = `${o._a?.name || ""} ${o._r?.title || ""}`;
  const mYearInText = auditText.match(/\b(20\d\d)\b/);
  const defaultYear = mYearInText
    ? parseInt(mYearInText[1], 10)
    : o._r?.reportDateISO
    ? new Date(o._r.reportDateISO).getFullYear()
    : o.createdAt
    ? new Date(o.createdAt).getFullYear()
    : 2026;

  if (mQuarterOnly) {
    const q = parseInt(mQuarterOnly[1], 10);
    return { key: `Q${q} ${defaultYear}`, label: `Quarter ${q} ${defaultYear}`, year: defaultYear, quarter: q };
  }

  // Fallback from reportDate or createdAt
  const dateStr = o._r?.reportDateISO || o.createdAt || o._a?.createdAt;
  if (dateStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const q = Math.floor(d.getMonth() / 3) + 1;
      const y = d.getFullYear();
      return { key: `Q${q} ${y}`, label: `Quarter ${q} ${y}`, year: y, quarter: q };
    }
  }

  return { key: `Q1 ${defaultYear}`, label: `Quarter 1 ${defaultYear}`, year: defaultYear, quarter: 1 };
}

export default function ResolutionTimelineTable({
  observations,
  onSelectTimeline,
}: {
  observations: ObsWithContext[];
  onSelectTimeline: (title: string, subtitle: string, items: ObsWithContext[]) => void;
}) {
  const { periods, summary } = useMemo(() => {
    const map = new Map<string, TimelinePeriodEntry>();
    const ensure = (t: { key: string; label: string; year: number; quarter: number }) => {
      if (!map.has(t.key)) {
        map.set(t.key, {
          key: t.key,
          label: t.label,
          year: t.year,
          quarter: t.quarter,
          total: 0,
          closed: 0,
          open: 0,
          pctResolved: 0,
          items: [],
          openItems: [],
        });
      }
      return map.get(t.key)!;
    };

    /* Rows are keyed by the quarter an observation's audit/report covers, so a quarter only got a
       row once an audit with that period existed — the current quarter was missing until then.
       It is always listed now, at zero when nothing has been reported for it yet. */
    const now = new Date();
    const cq = Math.floor(now.getMonth() / 3) + 1;
    const cy = now.getFullYear();
    ensure({ key: `Q${cq} ${cy}`, label: `Quarter ${cq} ${cy}`, year: cy, quarter: cq });

    for (const o of observations) {
      const entry = ensure(parseTimelinePeriod(o));
      entry.total++;
      entry.items.push(o);
      if (o.status === "Closed") {
        entry.closed++;
      } else {
        entry.open++;
        entry.openItems.push(o);
      }
    }

    const list = Array.from(map.values())
      .map((entry) => ({
        ...entry,
        pctResolved: entry.total > 0 ? Math.round((entry.closed / entry.total) * 100) : 0,
      }))
      .sort((a, b) => a.year - b.year || a.quarter - b.quarter);

    const totalSum = list.reduce((s, r) => s + r.total, 0);
    const closedSum = list.reduce((s, r) => s + r.closed, 0);
    const openSum = list.reduce((s, r) => s + r.open, 0);
    const totalPct = totalSum > 0 ? Math.round((closedSum / totalSum) * 100) : 0;

    return {
      periods: list,
      summary: { total: totalSum, closed: closedSum, open: openSum, pctResolved: totalPct },
    };
  }, [observations]);

  return (
    <div className="card anim-fade-in" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div className="seclabel" style={{ margin: 0 }}>
            Resolution Status by Timeline
          </div>
        </div>

        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#eaf5eb",
            color: "#2e7d32",
            border: "1px solid #b8dcc0",
          }}
        >
          {summary.pctResolved}% Overall Resolved
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <table style={{ margin: 0, width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>Timeline</th>
              <th scope="col" style={{ textAlign: "center", width: 65 }}>Total</th>
              <th scope="col" style={{ textAlign: "center", width: 65 }}>Closed</th>
              <th scope="col" style={{ textAlign: "center", width: 75 }}>Open</th>
              <th scope="col" style={{ textAlign: "right", width: 110 }}>% Resolved</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "20px 0" }}>
                  <span className="hint">No observation timeline data found.</span>
                </td>
              </tr>
            ) : (
              periods.map((row) => (
                <tr
                  key={row.key}
                  style={{ transition: "background 0.15s ease" }}
                  className="timeline-table-row"
                >
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{row.key}</span>
                      <span className="hint" style={{ fontSize: 11, fontWeight: 400 }}>
                        ({row.label})
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{row.total}</td>
                  <td style={{ textAlign: "center", color: "#2e7d32", fontWeight: 700 }}>
                    {row.closed}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {row.open > 0 ? (
                      <button
                        type="button"
                        className="btn ghost sm"
                        style={{
                          background: "#fdecef",
                          color: "#b00020",
                          fontWeight: 700,
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 12,
                          border: "1px solid #f5c4c4",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                        title={`Click to open ${row.open} carryovers for ${row.key}`}
                        onClick={() =>
                          onSelectTimeline(
                            `Carryover Observations — ${row.key}`,
                            `${row.open} open carryovers originating from ${row.key}`,
                            row.openItems
                          )
                        }
                      >
                        <span>{row.open}</span>
                        <span style={{ fontSize: 9 }}>▸</span>
                      </button>
                    ) : (
                      <span style={{ color: "#2e7d32", fontSize: 12, fontWeight: 600 }}>0</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {row.total === 0 ? (
                      <span className="hint" title="No observations reported for this quarter yet">—</span>
                    ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                      <div
                        style={{
                          width: 48,
                          height: 6,
                          background: "#e2e8f0",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${row.pctResolved}%`,
                            height: "100%",
                            background: row.pctResolved >= 75 ? "#2e7d32" : row.pctResolved >= 50 ? "#e8590c" : "#b00020",
                            borderRadius: 3,
                          }}
                        />
                      </div>
                      <span style={{ fontWeight: 700, minWidth: 32, fontSize: 12 }}>
                        {row.pctResolved}%
                      </span>
                    </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {periods.length > 0 && (
            <tfoot>
              <tr
                style={{
                  borderTop: "2px solid #cbd5e1",
                  background: "rgba(13, 90, 71, 0.04)",
                  fontWeight: 700,
                }}
              >
                <td style={{ color: "var(--brand-700)" }}>Total</td>
                <td style={{ textAlign: "center" }}>{summary.total}</td>
                <td style={{ textAlign: "center", color: "#2e7d32" }}>{summary.closed}</td>
                <td style={{ textAlign: "center" }}>
                  {summary.open > 0 ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{
                        background: "#fdecef",
                        color: "#b00020",
                        fontWeight: 700,
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 12,
                        border: "1px solid #f5c4c4",
                        cursor: "pointer",
                      }}
                      title="Click to view all active carryovers"
                      onClick={() =>
                        onSelectTimeline(
                          "All Outstanding Carryover Observations",
                          `All ${summary.open} active carryovers across all audit years`,
                          observations.filter((o) => o.status !== "Closed")
                        )
                      }
                    >
                      {summary.open} ▸
                    </button>
                  ) : (
                    <span>0</span>
                  )}
                </td>
                <td style={{ textAlign: "right", color: "var(--brand-700)" }}>
                  {summary.pctResolved}%
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
