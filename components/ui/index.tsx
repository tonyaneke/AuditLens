"use client";

// Small shared UI ports of legacy HTML helpers — identical class names, so globals.css
// styles them without changes.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ck, hx2rgba } from "@/lib/workspace/selectors";

/* ---- criticality pill: `<span class="pill c-…">` ---- */
export function CritPill({ crit }: { crit: string | undefined }) {
  if (!crit) return null;
  return <span className={`pill c-${ck(crit)}`}>{crit}</span>;
}

/* ---- generic tinted pill from a hex colour ---- */
export function TintPill({
  hex,
  children,
  bold,
}: {
  hex: string;
  children: ReactNode;
  bold?: boolean;
}) {
  return (
    <span
      className="pill"
      style={{ background: hx2rgba(hex, 0.16), color: hex, fontWeight: bold ? 700 : undefined }}
    >
      {children}
    </span>
  );
}

/* ---- status pill (Open / In Progress / Closed / Withdrawn) ---- */
export function StatusPill({ status }: { status: string | undefined }) {
  const k = status || "Open";
  if (k === "Withdrawn") return <span className="status-pill withdrawn">Withdrawn</span>;
  const cls = k === "Closed" ? "closed" : k === "In Progress" ? "progress" : "open";
  return <span className={`status-pill ${cls}`}>{k}</span>;
}

/* ---- dashboard KPI card (port of kpi()) ---- */
const KPI_ICONS: Record<string, ReactNode> = {
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M8 7V5h8v2" />
    </svg>
  ),
  obs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
};

export function Kpi({
  tone,
  label,
  value,
  sub,
  icon = "audit",
}: {
  tone: string;
  label: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  icon?: keyof typeof KPI_ICONS | string;
}) {
  return (
    <div className={`kpi ${tone}`}>
      <div className="kpi-head">
        <span className="kpi-icon">{KPI_ICONS[icon] || KPI_ICONS.audit}</span>
        <div className="lab">{label}</div>
      </div>
      <div className="num">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

/* ---- avatar (port of avatarHTML) ---- */
export function Avatar({
  user,
  size = 28,
}: {
  user: { name?: string; photo?: string | null } | null | undefined;
  size?: number;
}) {
  const style: CSSProperties = { width: size, height: size };
  if (user?.photo) {
    // eslint-disable-next-line @next/next/no-img-element -- data-URL avatars, not optimizable
    return <img src={user.photo} alt="" className="al-avatar" style={style} />;
  }
  const initials =
    String(user?.name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      className="al-avatar al-avatar-initials"
      style={{ ...style, fontSize: Math.round(size * 0.4) }}
    >
      {initials}
    </span>
  );
}

/* ---- back button (port of backBtn) ---- */
export function BackButton({ href, onClick }: { href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span aria-hidden="true">←</span> Back
    </>
  );
  if (href) {
    return (
      <Link className="btn-back" href={href} title="Back">
        {inner}
      </Link>
    );
  }
  return (
    <button className="btn-back" type="button" onClick={onClick} title="Back">
      {inner}
    </button>
  );
}

/* ---- empty state card ---- */
export function Empty({ big, children }: { big?: string; children: ReactNode }) {
  return (
    <div className="empty">
      {big ? <div className="big">{big}</div> : null}
      {children}
    </div>
  );
}
