// Audit risk assessment & annual audit plan (IIA Standard 2010) — helpers ported 1:1 from
// public/audit-bot.js (raComposite/raBand/raDue/raInPlan/parseQuarters/rolloverPlan/…).
// Everything takes the workspace db explicitly; nothing reads a global.

import type { Approval, AuditUniverseUnit, WorkspaceDb } from "./types";

/* ---------------- constants (verbatim from audit-bot.js) ---------------- */

export const RA_FACTORS: readonly (readonly [string, string, number])[] = [
  ["materiality", "Financial materiality / exposure", 0.2],
  ["complexity", "Inherent risk & complexity", 0.15],
  ["regulatory", "Regulatory & compliance impact", 0.15],
  ["change", "Change & volatility", 0.15],
  ["control", "Control environment / prior issues", 0.15],
  ["fraud", "Fraud susceptibility", 0.1],
  ["strategic", "Strategic significance", 0.1],
];
export const RA_BANDS = ["Low", "Medium", "High", "Critical"] as const;
export const ENG_STATUS = ["Not started", "In progress", "Completed", "Deferred"] as const;
export const RA_HEX: Record<string, string> = {
  Low: "#2e7d32",
  Medium: "#c9a300",
  High: "#b00020",
  Critical: "#7a0012",
};

/* ---------------- scoring ---------------- */

export function raComposite(f: Record<string, number> | undefined): number {
  let s = 0;
  RA_FACTORS.forEach(([k, , w]) => {
    s += (Number(f?.[k]) || 3) * w;
  });
  return s;
}
export function raBand(score: number): string {
  return score >= 4.2 ? "Critical" : score >= 3.4 ? "High" : score >= 2.6 ? "Medium" : "Low";
}
export function raFreqYears(band: string): number {
  return band === "Critical" || band === "High" ? 1 : band === "Medium" ? 2 : 3;
}
export function raFreqLabel(band: string): string {
  return (
    ({
      Critical: "Annual (priority)",
      High: "Annual",
      Medium: "Every 2 years",
      Low: "Every 3 years",
    }) as Record<string, string>
  )[band];
}

/* ---------------- universe & plan year ---------------- */

/** Read-only accessor. Use ensureUniverse() inside mutate() when pushing/removing units. */
export function universe(db: WorkspaceDb): AuditUniverseUnit[] {
  return db.auditUniverse || [];
}
export function ensureUniverse(db: WorkspaceDb): AuditUniverseUnit[] {
  db.auditUniverse = db.auditUniverse || [];
  return db.auditUniverse;
}
export function planYear(db: WorkspaceDb): string {
  return db.planYear || String(new Date().getFullYear());
}
export function raYearsIn(period: string | number | undefined): number[] {
  const out: number[] = [];
  const re = /(20\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(period || "")))) out.push(+m[1]);
  return out;
}
export function planYearsList(db: WorkspaceDb): string[] {
  const set = new Set<string>();
  (db.planYears || []).forEach((y) => set.add(String(y)));
  universe(db).forEach((e) => raYearsIn(e.plannedPeriod).forEach((y) => set.add(String(y))));
  if (db.planYear) set.add(String(db.planYear));
  const arr = [...set].filter(Boolean);
  if (!arr.length) arr.push(planYear(db));
  return arr.sort((a, b) => +a - +b);
}
export function planYearHasData(db: WorkspaceDb, y: string): boolean {
  return (
    universe(db).some((e) => raYearsIn(e.plannedPeriod).includes(+y)) ||
    (db.planYears || []).map(String).includes(String(y))
  );
}

/** Due = never audited, or last audited + frequency cycle has been reached by the plan year. */
export function raDue(db: WorkspaceDb, e: AuditUniverseUnit, band: string): boolean {
  const py = +planYear(db);
  const la = parseInt(String(e.lastAudited ?? ""), 10);
  if (isNaN(la)) return true;
  return la + raFreqYears(band) <= py;
}
export function raInPlan(e: AuditUniverseUnit, band: string, due: boolean): boolean {
  return e.includeInPlan != null ? !!e.includeInPlan : due || band === "Critical" || band === "High";
}
export function raDueYear(db: WorkspaceDb, e: AuditUniverseUnit, band: string): number {
  const la = parseInt(String(e.lastAudited ?? ""), 10);
  return isNaN(la) ? +planYear(db) : la + raFreqYears(band);
}

/* ---------------- quarters / engagement status ---------------- */

/** "Q1-Q2 2026" / "Q1, Q3 2026" → ["Q1 2026","Q2 2026"] etc. (legacy parseQuarters). */
export function parseQuarters(s: string | undefined): string[] {
  let str = String(s || "");
  const out: string[] = [];
  str = str.replace(/Q\s*([1-4])\s*[–-]\s*Q\s*([1-4])(\s*\d{4})?/gi, (_m, a, b, y) => {
    const yr = String(y || "").trim();
    for (let i = +a; i <= +b; i++) out.push("Q" + i + (yr ? " " + yr : ""));
    return " ";
  });
  const re = /Q\s*([1-4])(\s*\d{4})?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const yr = String(m[2] || "").trim();
    out.push("Q" + m[1] + (yr ? " " + yr : ""));
  }
  const seen: Record<string, number> = {};
  const res: string[] = [];
  out.forEach((q) => {
    const k = q.replace(/\s+/g, " ").trim();
    if (!seen[k]) {
      seen[k] = 1;
      res.push(k);
    }
  });
  return res;
}
export function unitOcc(e: AuditUniverseUnit): { q: string; done: boolean }[] {
  const qs = parseQuarters(e.plannedPeriod);
  const d: Record<string, number> = {};
  (e.occDone || []).forEach((q) => (d[q] = 1));
  return qs.map((q) => ({ q, done: !!d[q] }));
}
export function unitOccTotal(e: AuditUniverseUnit): number {
  return Math.max(1, parseQuarters(e.plannedPeriod).length);
}
export function unitOccDone(e: AuditUniverseUnit): number {
  const occ = unitOcc(e);
  return occ.length > 1 ? occ.filter((o) => o.done).length : e.engStatus === "Completed" ? 1 : 0;
}
export function engIsComplete(e: AuditUniverseUnit): boolean {
  if (e.engStatus === "Completed") return true;
  const occ = unitOcc(e);
  return occ.length > 0 && occ.every((o) => o.done);
}
export function engStatusText(e: AuditUniverseUnit): string {
  const occ = unitOcc(e);
  if (occ.length > 1) {
    const d = occ.filter((o) => o.done).length;
    return d >= occ.length
      ? "Completed (all quarters)"
      : d > 0
        ? d + "/" + occ.length + " quarters done"
        : "Not started";
  }
  return e.engStatus || "Not started";
}
export function pendingCompletion(db: WorkspaceDb, unitId: string): Approval | undefined {
  return (db.approvals || []).find(
    (x) => x.kind === "engagement_completion" && x.unitId === unitId && x.status === "pending",
  );
}
export function engStatusLabel(db: WorkspaceDb, e: AuditUniverseUnit): string {
  if (engIsComplete(e)) return "Completed";
  if (pendingCompletion(db, e.id)) return "Pending approval";
  return e.engStatus || "Not started";
}

/* ---------------- linked audits ---------------- */

export function raLinkIds(e: AuditUniverseUnit): string[] {
  return e.linkedAuditIds || (e.linkedAuditId ? [e.linkedAuditId] : []);
}

/* ---------------- ranked view model ---------------- */

export type RaUnitView = AuditUniverseUnit & {
  score: number;
  band: string;
  due: boolean;
  incl: boolean;
  freq: string;
};

/** The universe enriched with score/band/due/plan-inclusion, ranked by risk score. */
export function raRanked(db: WorkspaceDb): RaUnitView[] {
  return universe(db)
    .map((e) => {
      const score = raComposite(e.factors);
      const band = e.ratingOverride || raBand(score);
      const due = raDue(db, e, band);
      return {
        ...e,
        score,
        band,
        due,
        incl: raInPlan(e, band, due),
        freq: e.frequencyOverride || raFreqLabel(band),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/* ---------------- plan-year rollover ---------------- */

// An engagement planned for an earlier year that is neither complete nor awaiting approval
// rolls into the current plan year (keeping a note of where it slipped from).
function rollsOver(db: WorkspaceDb, e: AuditUniverseUnit): boolean {
  const per = (e.plannedPeriod || "").trim();
  if (!per) return false;
  const yrs = raYearsIn(per);
  if (!yrs.length) return false;
  return Math.max(...yrs) < +planYear(db) && !engIsComplete(e) && !pendingCompletion(db, e.id);
}

/** Pure check — lets a component decide whether a rollover mutation is needed at all. */
export function needsRollover(db: WorkspaceDb): boolean {
  return universe(db).some((e) => rollsOver(db, e));
}

/** Mutating: run inside mutate(). Returns whether anything changed. */
export function rolloverPlan(db: WorkspaceDb): boolean {
  const py = planYear(db);
  let changed = false;
  universe(db).forEach((e) => {
    if (!rollsOver(db, e)) return;
    const yrs = raYearsIn(e.plannedPeriod);
    e.carryOverFrom = e.carryOverFrom || Math.max(...yrs);
    e.plannedPeriod = (e.plannedPeriod || "").replace(/20\d{2}/g, py);
    e.occDone = [];
    changed = true;
  });
  return changed;
}
