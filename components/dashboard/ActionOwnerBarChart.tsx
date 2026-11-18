"use client";

import { useMemo, useState } from "react";
import { CRITS, CRIT_HEX, type ObsWithContext } from "@/lib/workspace/selectors";
import { deptLabel, deptNameOf } from "@/lib/dept-scope";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

interface ActionOwnerGroup {
  id: string;
  shortLabel: string;
  fullLabel: string;
  count: number;
  items: ObsWithContext[];
  byCrit: Record<string, number>;
}

function normalizeDeptDisplay(rawDept: string): { short: string; full: string } {
  const clean = deptLabel(rawDept).trim();
  const lower = clean.toLowerCase();

  if (lower === "it" || lower.includes("information tech") || lower.includes("info tech")) {
    return { short: "INFO. TECH.", full: "Information Technology" };
  }
  if (lower.includes("risk")) {
    return { short: "RISK", full: "Risk Management" };
  }
  if (lower.includes("finance") || lower.includes("account")) {
    return { short: "FINANCE", full: "Finance" };
  }
  if (lower.includes("procure")) {
    return { short: "PROCUREMENT", full: "Procurement" };
  }
  if (lower.includes("credit")) {
    return { short: "CREDIT", full: "Credit Operations" };
  }
  if (lower.includes("impact") || lower.includes("sustain") || lower.includes("operat")) {
    return { short: "IMPACT", full: "Impact & Sustainability" };
  }
  if (lower.includes("admin")) {
    return { short: "ADMIN", full: "Administration" };
  }
  if (lower.includes("omd") || lower.includes("managing director")) {
    return { short: "OMD", full: "Office of the MD" };
  }
  if (lower.includes("comm")) {
    return { short: "COMMS", full: "Corporate Communications" };
  }
  if (lower.includes("strategy") || lower.includes("innovat")) {
    return { short: "STRATEGY", full: "Strategy & Innovation" };
  }
  if (lower.includes("legal") || lower.includes("sec")) {
    return { short: "LEGAL", full: "Company Sec. / Legal" };
  }
  if (lower.includes("internal audit") || lower === "audit") {
    return { short: "AUDIT", full: "Internal Audit" };
  }

  const shortName = clean.length > 11 ? clean.slice(0, 10).toUpperCase() + "…" : clean.toUpperCase();
  return { short: shortName, full: clean || "Unassigned" };
}

/* The hover popover: what the bar is made of, by criticality. Rendered inside the hovered bar's
   column and placed beside the bar — to its right in the left half of the chart, to its left in
   the right half — so it always stays inside the card instead of spilling over the header. */
function BarBreakdown({ group, side }: { group: ActionOwnerGroup; side: "left" | "right" }) {
  return (
    <div
      role="tooltip"
      id={`bar-tip-${group.id}`}
      style={{
        position: "absolute",
        bottom: 8,
        [side === "right" ? "left" : "right"]: "calc(50% + 26px)",
        zIndex: 5,
        minWidth: 160,
        padding: "9px 11px",
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        textAlign: "left",
        cursor: "default",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-700)" }}>{group.fullLabel}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 7 }}>
        {group.count} outstanding
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {CRITS.map((c) => {
          const cnt = group.byCrit[c];
          if (!cnt) return null;
          return (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: 2, background: CRIT_HEX[c], flexShrink: 0 }}
              />
              <span style={{ flex: 1, color: "#475569" }}>{c}</span>
              <span style={{ fontWeight: 700, color: CRIT_HEX[c] }}>{cnt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ActionOwnerBarChart({
  observations,
  onSelectGroup,
}: {
  observations: ObsWithContext[];
  onSelectGroup: (title: string, subtitle: string, items: ObsWithContext[]) => void;
}) {
  const { db } = useWorkspace();
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);

  // Filter only outstanding (open) observations — carryovers
  const openObs = useMemo(() => {
    return observations.filter((o) => o.status !== "Closed");
  }, [observations]);

  const groups: ActionOwnerGroup[] = useMemo(() => {
    const map = new Map<string, ActionOwnerGroup>();

    for (const o of openObs) {
      const meta = normalizeDeptDisplay(deptNameOf(db, o) || "Unassigned");
      const id = meta.short;

      if (!map.has(id)) {
        const byCrit: Record<string, number> = {};
        CRITS.forEach((c) => (byCrit[c] = 0));
        map.set(id, { id, shortLabel: meta.short, fullLabel: meta.full, count: 0, items: [], byCrit });
      }

      const g = map.get(id)!;
      g.count++;
      g.items.push(o);
      if (g.byCrit[o.criticality] != null) {
        g.byCrit[o.criticality]++;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [openObs, db]);

  const maxCount = useMemo(() => {
    return groups.reduce((m, g) => Math.max(m, g.count), 1);
  }, [groups]);

  const openGroup = (g: ActionOwnerGroup) =>
    onSelectGroup(
      `Outstanding Observations — ${g.fullLabel}`,
      `${g.count} active carryover(s) assigned to ${g.fullLabel}`,
      g.items
    );

  return (
    <div className="card anim-fade-in" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div className="seclabel" style={{ margin: 0 }}>
          Outstanding Observations by Action Owner
        </div>
      </div>

      {/* Chart Area */}
      {groups.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180 }}>
          <span className="hint">No outstanding open observations.</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 200, position: "relative" }}>
          {/* Bar Chart Container */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 10,
              paddingTop: 28,
              paddingBottom: 4,
              borderBottom: "2px solid #cbd5e1",
              minHeight: 170,
            }}
          >
            {groups.map((g, i) => {
              const heightPct = Math.max(12, Math.round((g.count / maxCount) * 100));
              const isHovered = hoveredGroupId === g.id;

              return (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${g.fullLabel}: ${g.count} outstanding. Open the list.`}
                  aria-describedby={isHovered ? `bar-tip-${g.id}` : undefined}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: "100%",
                    cursor: "pointer",
                    position: "relative",
                  }}
                  onMouseEnter={() => setHoveredGroupId(g.id)}
                  onMouseLeave={() => setHoveredGroupId(null)}
                  onFocus={() => setHoveredGroupId(g.id)}
                  onBlur={() => setHoveredGroupId(null)}
                  onClick={() => openGroup(g)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openGroup(g);
                    }
                  }}
                >
                  {/* Count Number on top of bar */}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: isHovered ? "#b00020" : "#0d5a47",
                      marginBottom: 4,
                      transition: "color 0.15s ease",
                    }}
                  >
                    {g.count}
                  </span>

                  {/* Vertical Bar */}
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 44,
                      minWidth: 16,
                      height: `${heightPct}%`,
                      background: isHovered
                        ? "linear-gradient(180deg, #1b7a62 0%, #0d5a47 100%)"
                        : "linear-gradient(180deg, #6ba192 0%, #4a8877 100%)",
                      borderRadius: "6px 6px 0 0",
                      boxShadow: isHovered ? "0 4px 12px rgba(13,90,71,0.25)" : "none",
                      transform: isHovered ? "scaleY(1.03)" : "scaleY(1)",
                      transformOrigin: "bottom",
                      transition: "all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1)",
                    }}
                  />

                  {isHovered ? <BarBreakdown group={g} side={i < groups.length / 2 ? "right" : "left"} /> : null}
                </div>
              );
            })}
          </div>

          {/* X-axis Labels */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              paddingTop: 8,
            }}
          >
            {groups.map((g) => {
              const isHovered = hoveredGroupId === g.id;
              return (
                <div
                  key={g.id}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => setHoveredGroupId(g.id)}
                  onMouseLeave={() => setHoveredGroupId(null)}
                  onClick={() => openGroup(g)}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                      color: isHovered ? "var(--brand-700)" : "#475569",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      transition: "color 0.15s ease",
                    }}
                  >
                    {g.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
