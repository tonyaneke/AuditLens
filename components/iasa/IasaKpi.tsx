"use client";

// Port of iasaKpi()/iasaKpiIcon() — the self-assessment KPI tile has its own tone-driven icon
// set (good/mid/bad/accent/base) and shrinks long values via .num-compact.

import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  good: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  mid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  ),
  bad: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  ),
  accent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 19h16" />
      <path d="M7 16V8" />
      <path d="M12 16V5" />
      <path d="M17 16v-4" />
    </svg>
  ),
  base: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 3v18" />
      <path d="M3 12h18" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
};

export default function IasaKpi({
  tone,
  label,
  value,
  sub,
}: {
  tone: string;
  label: ReactNode;
  value: string | number;
  sub: ReactNode;
}) {
  const compact = String(value).length > 14 ? " num-compact" : "";
  return (
    <div className={`kpi iasa-kpi ${tone}`}>
      <div className="kpi-head">
        <span className="kpi-icon">{ICONS[tone] || ICONS.base}</span>
        <div className="lab">{label}</div>
      </div>
      <div className={`num${compact}`}>{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
