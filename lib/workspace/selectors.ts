// Pure selectors + derivation helpers ported 1:1 from public/audit-bot.js (the behavioral
// spec). All take the workspace db explicitly — no globals — so they are shared by every
// migrated view and unit-testable.

import type {
  Approval,
  Audit,
  AuditUniverseUnit,
  Criticality,
  ExtFinding,
  FraudRisk,
  NotificationItem,
  Observation,
  Report,
  WorkspaceDb,
} from "./types";

/* ---------------- constants (verbatim from audit-bot.js) ---------------- */

export const CRITS: Criticality[] = [
  "Critical",
  "High",
  "Moderate",
  "Low",
  "Process Improvement",
];
export const STATUSES = ["Open", "In Progress", "Closed"] as const;
export const RUBRIC: Record<string, string> = {
  Critical:
    "Contravenes the Corporation's zero risk-tolerance indicators / risk appetite. Requires immediate remediation; an auditable unit in breach (or with numerous high-risk observations) is assigned an adverse opinion.",
  High: "Significant vulnerability with potentially severe consequences (major control failure, regulatory breach, critical weakness). Requires immediate remediation and close executive/Board Audit Committee monitoring.",
  Moderate:
    "Notable weakness causing inefficiencies and moderate financial or reputational harm if unresolved. Short-term remediation (1–3 months).",
  Low: "Minor control weakness or process deviation with minimal operational impact. Medium-term remediation (4–6 months).",
  "Process Improvement":
    "Opportunity to boost efficiency and best practice rather than a risk. Flexible implementation based on operational-excellence needs.",
};
export const CRIT_HEX: Record<string, string> = {
  Critical: "#7a0012",
  High: "#b00020",
  Moderate: "#e8590c",
  Low: "#2e7d32",
  "Process Improvement": "#2c5f8a",
};
export const BANDS = ["Low", "Medium", "High", "Extreme"] as const;
export const BAND_HEX: Record<string, string> = {
  Low: "#2e7d32",
  Medium: "#c9a300",
  High: "#e8590c",
  Extreme: "#b00020",
};
export const CLOSE_DAYS: Record<string, number> = {
  Immediate: 30,
  "Short-term": 60,
  "Long-term": 120,
};
export const AGE_BUCKETS = ["0–30 days", "31–60 days", "61–90 days", ">90 days"] as const;
export const CLOSE_BUCKETS = [
  "Overdue",
  "≤ 2 weeks",
  "2–4 weeks",
  "1–3 months",
  "> 3 months",
] as const;
export const CLOSEB_HEX: Record<string, string> = {
  Overdue: "#b00020",
  "≤ 2 weeks": "#e8590c",
  "2–4 weeks": "#c9a300",
  "1–3 months": "#2c5f8a",
  "> 3 months": "#2e7d32",
};

/** CSS-safe key for a criticality (handles the space in "Process Improvement"). */
export function ck(c: string | undefined): string {
  return (
    (
      {
        Critical: "Critical",
        High: "High",
        Moderate: "Moderate",
        Low: "Low",
        "Process Improvement": "Improve",
      } as Record<string, string>
    )[c || ""] || "Moderate"
  );
}

export function hx2rgba(hex: string, a: number): string {
  const n = hex.replace("#", "");
  return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${a})`;
}

export function zeroCrit(): Record<string, number> {
  const o: Record<string, number> = {};
  CRITS.forEach((c) => (o[c] = 0));
  return o;
}

/* ---------------- ids & dates ---------------- */

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function isoToDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(String(s).length <= 10 ? s + "T00:00:00" : s);
  return isNaN(d.getTime()) ? null : d;
}
export function looseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
export function today0(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return d.getDate() + " " + m[d.getMonth()] + " " + d.getFullYear();
}
export function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return (
    fmtDate(d) + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}
export function isoNow(): string {
  const d = new Date();
  return (
    d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
  );
}
export function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return Math.floor(m) + "m ago";
  const h = m / 60;
  if (h < 24) return Math.floor(h) + "h ago";
  const dd = h / 24;
  if (dd < 7) return Math.floor(dd) + "d ago";
  return fmtDate(d);
}

/* ---------------- observations ---------------- */

export type ObsWithContext = Observation & { _a: Audit; _r: Report };

export function isWithdrawn(o: Observation | null | undefined): boolean {
  return !!(o && (o.withdrawn || (o.withdrawal && o.withdrawal.stage === "withdrawn")));
}
export function obsIsApproved(o: Observation): boolean {
  return o.obsApproval !== "pending" && o.obsApproval !== "rejected";
}

export function allObs(db: WorkspaceDb): ObsWithContext[] {
  const out: ObsWithContext[] = [];
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) =>
      (r.observations || []).forEach((x) => {
        if (!isWithdrawn(x)) out.push({ ...x, _a: a, _r: r });
      }),
    ),
  );
  return out;
}
export function allObsRaw(db: WorkspaceDb): ObsWithContext[] {
  const out: ObsWithContext[] = [];
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) =>
      (r.observations || []).forEach((x) => out.push({ ...x, _a: a, _r: r })),
    ),
  );
  return out;
}
export function withdrawnObsAll(db: WorkspaceDb): ObsWithContext[] {
  return allObsRaw(db).filter(isWithdrawn);
}
export function findAudit(db: WorkspaceDb, id: string | undefined): Audit | undefined {
  return (db.audits || []).find((a) => a.id === id);
}
export function findReport(a: Audit | undefined, id: string | undefined): Report | undefined {
  return a ? (a.reports || []).find((r) => r.id === id) : undefined;
}

export function reportDateOf(r: Report | undefined): Date | null {
  if (!r) return null;
  return isoToDate(r.reportDateISO) || looseDate(r.reportDate);
}
export function expectedClose(o: Observation, r: Report | undefined): Date | null {
  const base = reportDateOf(r);
  const w = CLOSE_DAYS[o.timeline || ""];
  return base && w ? addDays(base, w) : null;
}
/** Manual target (dueDate) overrides the computed expected close. */
export function effectiveClose(o: Observation, r: Report | undefined): Date | null {
  return looseDate(o.dueDate) || expectedClose(o, r);
}
export function obsAge(o: Observation, r: Report | undefined): number | null {
  const base = reportDateOf(r);
  if (!base) return null;
  const end =
    o.status === "Closed" && isoToDate(o.closedDateISO) ? isoToDate(o.closedDateISO)! : today0();
  return Math.max(0, daysBetween(base, end));
}
export function isOverdueObs(o: Observation, r: Report | undefined): boolean {
  if (o.status === "Closed") return false;
  const c = effectiveClose(o, r);
  return !!(c && today0() > c);
}
/** +ve = days remaining, -ve = overdue. */
export function daysToClose(o: Observation, r: Report | undefined): number | null {
  const c = effectiveClose(o, r);
  return c ? daysBetween(today0(), c) : null;
}
export function closeBucket(d: number | null): string | null {
  if (d == null) return null;
  if (d < 0) return "Overdue";
  if (d <= 14) return "≤ 2 weeks";
  if (d <= 30) return "2–4 weeks";
  if (d <= 90) return "1–3 months";
  return "> 3 months";
}
export function ageBucket(n: number | null): string {
  if (n == null) return "—";
  if (n <= 30) return "0–30 days";
  if (n <= 60) return "31–60 days";
  if (n <= 90) return "61–90 days";
  return ">90 days";
}
export function readyToClose(o: Observation): boolean {
  return !!o.ownerRectifiedAt && (o.status || "Open") !== "Closed";
}

/* ---------------- root-cause themes ---------------- */

const RC_THEMES: [string, RegExp][] = [
  ["Policy / procedure gaps", /(policy|policies|procedure|sop\b|standard operating|guideline|framework|methodology|risk appetite|not (defined|formalis|formaliz)|undefined|absence of (a |an )?(formal )?(policy|procedure|framework))/i],
  ["Process design / controls", /(process|workflow|reconcil|validation|review control|checklist|no (formal )?(procedure|process|control)|control (gap|weakness|design)|preventive control|detective control)/i],
  ["Segregation of duties", /(segregation|sod\b|conflict of|separation of duties|duties (are|not))/i],
  ["People / capacity / training", /(staff|capacity|resourc|training|skill|awareness|competen|headcount|personnel|key.?person|manpower)/i],
  ["Governance / oversight", /(governance|oversight|monitor|escalation|accountab|responsib|tone at the top|approval authority|delegation|board|committee)/i],
  ["System / automation", /(system|automat|manual|spreadsheet|excel|technology|application|integration|legacy|it general)/i],
  ["Documentation / records", /(document|record|evidence|audit trail|filing|retention|register)/i],
  ["Third-party / vendor", /(vendor|third.?party|outsourc|provider|pfi\b|counterpart|custodian|bureau)/i],
];
export function rcThemes(text: string | undefined): string[] {
  const out: string[] = [];
  const t = text || "";
  RC_THEMES.forEach(([n, re]) => {
    if (re.test(t)) out.push(n);
  });
  return out.length ? out : ["Other / unclassified"];
}

/* ---------------- fraud / RA / external ---------------- */

export function fraudList(db: WorkspaceDb): FraudRisk[] {
  return db.fraudRisks || [];
}
export function fraudBand(score: number): string {
  return score <= 4 ? "Low" : score <= 9 ? "Medium" : score <= 14 ? "High" : "Extreme";
}
export function residualBand(inherent: string, strength: string | undefined): string {
  const r = ({ Strong: 2, Moderate: 1, Weak: 0, None: 0 } as Record<string, number>)[strength || ""] || 0;
  return BANDS[Math.max(0, BANDS.indexOf(inherent as (typeof BANDS)[number]) - r)];
}
export function fraudResidual(f: FraudRisk): string {
  const inh = fraudBand((f.likelihood || 3) * (f.impact || 3));
  return f.residualOverride || residualBand(inh, f.controlStrength);
}

export function auditUniverse(db: WorkspaceDb): AuditUniverseUnit[] {
  return db.auditUniverse || [];
}
export function extList(db: WorkspaceDb): ExtFinding[] {
  return db.extFindings || [];
}
export function extOverdue(f: ExtFinding): boolean {
  if (f.status === "Closed") return false;
  const d = looseDate(f.targetDate);
  return !!(d && d < today0());
}

/* ---------------- approvals & notifications ---------------- */

export function approvals(db: WorkspaceDb): Approval[] {
  return db.approvals || [];
}
export function pendingApprovalCount(db: WorkspaceDb): number {
  return approvals(db).filter((x) => x.status === "pending").length;
}
export function notifications(db: WorkspaceDb): NotificationItem[] {
  return db.notifications || [];
}
export function myNotifications(db: WorkspaceDb, userId: string | undefined): NotificationItem[] {
  if (!userId) return [];
  return notifications(db)
    .filter((n) => n.userId === userId)
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}
export function unreadNotifCount(db: WorkspaceDb, userId: string | undefined): number {
  return myNotifications(db, userId).filter((n) => !n.read).length;
}

/** Locate an internal observation by id across the whole workspace. */
export function locateObs(
  db: WorkspaceDb,
  obsId: string,
): { a: Audit; r: Report; o: Observation } | null {
  for (const a of db.audits || [])
    for (const r of a.reports || []) {
      const o = (r.observations || []).find((x) => x.id === obsId);
      if (o) return { a, r, o };
    }
  return null;
}
