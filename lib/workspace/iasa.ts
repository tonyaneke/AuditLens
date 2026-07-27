// IA quality self-assessment against the IIA Global Internal Audit Standards (2024) —
// data + helpers ported 1:1 from public/audit-bot.js (GIAS/rollupPrinc/overallOpinion/
// iasaStats/eqaDue/…). The legacy code reached the "current" assessment through a global
// (iaSA()/withIASA); here every helper takes the record explicitly.

import { fmtDate, today0, uid } from "./selectors";
import type { IaSaPrinciple, IaSaRecord, IaSaStandard, WorkspaceDb } from "./types";

/* ---------------- the standards framework ---------------- */

export type GiasPrinciple = { n: number; t: string; s: [string, string][] };
export type GiasDomain = { d: string; dt: string; ps: GiasPrinciple[] };

export const GIAS: GiasDomain[] = [
  {
    d: "II",
    dt: "Ethics & Professionalism",
    ps: [
      { n: 1, t: "Demonstrate Integrity", s: [["1.1", "Honesty and Professional Courage"], ["1.2", "Organization’s Ethical Expectations"], ["1.3", "Legal and Ethical Behavior"]] },
      { n: 2, t: "Maintain Objectivity", s: [["2.1", "Individual Objectivity"], ["2.2", "Safeguarding Objectivity"], ["2.3", "Disclosing Impairments to Objectivity"]] },
      { n: 3, t: "Demonstrate Competency", s: [["3.1", "Competency"], ["3.2", "Continuing Professional Development"]] },
      { n: 4, t: "Exercise Due Professional Care", s: [["4.1", "Conformance with the Global Internal Audit Standards"], ["4.2", "Due Professional Care"], ["4.3", "Professional Skepticism"]] },
      { n: 5, t: "Maintain Confidentiality", s: [["5.1", "Use of Information"], ["5.2", "Protection of Information"]] },
    ],
  },
  {
    d: "III",
    dt: "Governing the Internal Audit Function",
    ps: [
      { n: 6, t: "Authorized by the Board", s: [["6.1", "Internal Audit Mandate"], ["6.2", "Internal Audit Charter"], ["6.3", "Board and Senior Management Support"]] },
      { n: 7, t: "Positioned Independently", s: [["7.1", "Organizational Independence"], ["7.2", "Chief Audit Executive Qualifications"]] },
      { n: 8, t: "Overseen by the Board", s: [["8.1", "Board Interaction"], ["8.2", "Resources"], ["8.3", "Quality"], ["8.4", "External Quality Assessment"]] },
    ],
  },
  {
    d: "IV",
    dt: "Managing the Internal Audit Function",
    ps: [
      { n: 9, t: "Plan Strategically", s: [["9.1", "Understanding Governance, Risk Management, and Control Processes"], ["9.2", "Internal Audit Strategy"], ["9.3", "Methodologies"], ["9.4", "Internal Audit Plan"], ["9.5", "Coordination and Reliance"]] },
      { n: 10, t: "Manage Resources", s: [["10.1", "Financial Resource Management"], ["10.2", "Human Resources Management"], ["10.3", "Technological Resources"]] },
      { n: 11, t: "Communicate Effectively", s: [["11.1", "Building Relationships and Communicating with Stakeholders"], ["11.2", "Effective Communication"], ["11.3", "Communicating Results"], ["11.4", "Errors and Omissions"], ["11.5", "Communicating the Acceptance of Risks"]] },
      { n: 12, t: "Enhance Quality", s: [["12.1", "Internal Quality Assessment"], ["12.2", "Performance Measurement"], ["12.3", "Oversee and Improve Engagement Performance"]] },
    ],
  },
  {
    d: "V",
    dt: "Performing Internal Audit Services",
    ps: [
      { n: 13, t: "Plan Engagements Effectively", s: [["13.1", "Engagement Communication"], ["13.2", "Engagement Risk Assessment"], ["13.3", "Engagement Objectives and Scope"], ["13.4", "Evaluation Criteria"], ["13.5", "Engagement Resources"], ["13.6", "Work Program"]] },
      { n: 14, t: "Conduct Engagement Work", s: [["14.1", "Gathering Information for Analyses and Evaluation"], ["14.2", "Analyses and Potential Engagement Findings"], ["14.3", "Evaluation of Findings"], ["14.4", "Recommendations and Action Plans"], ["14.5", "Engagement Conclusions"], ["14.6", "Engagement Documentation"]] },
      { n: 15, t: "Communicate Engagement Results and Monitor Action Plans", s: [["15.1", "Final Engagement Communication"], ["15.2", "Confirming the Implementation of Recommendations or Action Plans"]] },
    ],
  },
];

export const STD_CONF = ["Not rated", "Conforms", "Partially Conforms", "Does Not Conform"];
export const CONF_HEX: Record<string, string> = {
  Conforms: "#2e7d32",
  "Generally Conforms": "#2e7d32",
  "Partially Conforms": "#c9a300",
  "Does Not Conform": "#b00020",
  "Not rated": "#94a3b8",
};
export const MATURITY = [
  "—",
  "1 · Initial",
  "2 · Developing",
  "3 · Established",
  "4 · Managed",
  "5 · Optimised",
];
/** The IA function self-assesses every 6 months. */
export const IASA_CADENCE_MONTHS = 6;
/** NCCG requires an external assessment at least every 3 years (stricter than IIA Std 8.4). */
export const EQA_CYCLE_YEARS = 3;

export type PrincipleRef = { n: number; t: string; d: string; dt: string; s: [string, string][] };
export type StandardRef = { num: string; title: string; pn: number; pt: string; d: string; dt: string };

export function allPrinc(): PrincipleRef[] {
  return GIAS.flatMap((g) => g.ps.map((p) => ({ n: p.n, t: p.t, d: g.d, dt: g.dt, s: p.s })));
}
export function allStandards(): StandardRef[] {
  return GIAS.flatMap((g) =>
    g.ps.flatMap((p) => p.s.map(([num, title]) => ({ num, title, pn: p.n, pt: p.t, d: g.d, dt: g.dt }))),
  );
}
export function findPrinc(pn: number): PrincipleRef | undefined {
  return allPrinc().find((p) => p.n === +pn);
}

/* ---------------- the assessment records ---------------- */

/** Fill in the fields the UI reads. Mutating — call inside mutate() or on a fresh object. */
export function normOneIASA(s: Partial<IaSaRecord>): IaSaRecord {
  const r = s as IaSaRecord;
  r.id = r.id || uid();
  r.period = r.period || "";
  r.assessor = r.assessor || "";
  r.scope = r.scope || "";
  r.approach = r.approach || "";
  r.lastEQA = r.lastEQA || "";
  r.commentary = r.commentary || "";
  r.items = r.items || {};
  r.std = r.std || {};
  r.status = r.status || (r.completedAt ? "completed" : "in_progress");
  r.startedAt = r.startedAt || (r.createdAt as string) || "";
  return r;
}

/** Read-only list, newest first is NOT applied here (callers sort). */
export function iaSaList(db: WorkspaceDb): IaSaRecord[] {
  return db.iaSAList || [];
}

// Pre-list workspaces kept a single assessment on DB.iaSA; it becomes the first list entry.
export function needsIaSaMigration(db: WorkspaceDb): boolean {
  const legacy = db.iaSA as Record<string, unknown> | undefined;
  return !!(legacy && Object.keys(legacy).length && !legacy._migrated);
}

/** Mutating: create the list and fold in any pre-list single assessment. */
export function ensureIaSaList(db: WorkspaceDb): IaSaRecord[] {
  db.iaSAList = db.iaSAList || [];
  if (needsIaSaMigration(db)) {
    const legacy = normOneIASA(db.iaSA as Partial<IaSaRecord>);
    legacy.startedAt = legacy.startedAt || new Date().toISOString();
    db.iaSAList.unshift(legacy);
    db.iaSA = { _migrated: true };
    db.iaSACurrentId = legacy.id;
  }
  db.iaSAList.forEach(normOneIASA);
  return db.iaSAList;
}

/** The assessment currently being viewed (legacy iaSACurrentId, falling back to the newest). */
export function currentIaSa(db: WorkspaceDb): IaSaRecord | null {
  const all = iaSaList(db);
  return all.find((s) => s.id === db.iaSACurrentId) || all[0] || null;
}

export function iasaPeriodForDate(d: Date): string {
  return "H" + (d.getMonth() < 6 ? 1 : 2) + " " + d.getFullYear();
}

/** Mutating: append a fresh blank assessment and make it current. Returns its id. */
export function newIaSa(db: WorkspaceDb, period?: string): string {
  const all = ensureIaSaList(db);
  const now = new Date();
  const rec = normOneIASA({
    id: uid(),
    period: period || iasaPeriodForDate(now),
    startedAt: now.toISOString(),
    status: "in_progress",
  });
  all.unshift(rec);
  db.iaSACurrentId = rec.id;
  return rec.id;
}

/* ---------------- ratings & rollups ---------------- */

export function stdItem(rec: IaSaRecord | null, num: string): IaSaStandard {
  return (rec && rec.std && rec.std[num]) || {};
}
export function stdConf(rec: IaSaRecord | null, num: string): string {
  return stdItem(rec, num).conf || "Not rated";
}
export function princItem(rec: IaSaRecord | null, pn: number): IaSaPrinciple {
  return (rec && rec.items && rec.items[pn]) || {};
}
export function princMaturity(rec: IaSaRecord | null, pn: number): number {
  return Number(princItem(rec, pn).maturity) || 0;
}

/** Principle conformance derived from its standards (legacy rollupPrinc). */
export function rollupPrinc(rec: IaSaRecord | null, pn: number): string {
  const p = findPrinc(pn);
  if (!p) return "Not rated";
  const rated = p.s.map(([num]) => stdConf(rec, num)).filter((c) => c !== "Not rated");
  if (!rated.length) {
    const legacy = princItem(rec, pn).conformance;
    if (legacy === "Conforms") return "Generally Conforms";
    if (legacy === "Partially Conforms" || legacy === "Does Not Conform") return legacy;
    return "Not rated";
  }
  const dnc = rated.filter((c) => c === "Does Not Conform").length;
  const pc = rated.filter((c) => c === "Partially Conforms").length;
  if (dnc > rated.length / 2) return "Does Not Conform";
  if (dnc > 0 || pc > 0) return "Partially Conforms";
  return "Generally Conforms";
}

export function overallOpinion(rec: IaSaRecord | null): string {
  const prs = allPrinc()
    .map((p) => rollupPrinc(rec, p.n))
    .filter((c) => c !== "Not rated");
  if (!prs.length) return "Not yet assessed";
  if (prs.every((c) => c === "Generally Conforms")) return "Generally Conforms";
  if (prs.filter((c) => c === "Does Not Conform").length >= 3) return "Does Not Conform";
  return "Partially Conforms";
}

export function opTone(op: string): string {
  return op === "Generally Conforms"
    ? "good"
    : op === "Partially Conforms"
      ? "mid"
      : op === "Does Not Conform"
        ? "bad"
        : "base";
}

export type IasaStats = {
  total: number;
  rated: number;
  cnt: Record<string, number>;
  prc: Record<string, number>;
  pRated: number;
  avgMat: number;
};

export function iasaStats(rec: IaSaRecord | null): IasaStats {
  const stds = allStandards();
  const cnt: Record<string, number> = { Conforms: 0, "Partially Conforms": 0, "Does Not Conform": 0 };
  let rated = 0;
  stds.forEach((s) => {
    const c = stdConf(rec, s.num);
    if (c !== "Not rated") {
      rated++;
      if (cnt[c] != null) cnt[c]++;
    }
  });
  const prc: Record<string, number> = {
    "Generally Conforms": 0,
    "Partially Conforms": 0,
    "Does Not Conform": 0,
  };
  let pRated = 0;
  allPrinc().forEach((p) => {
    const c = rollupPrinc(rec, p.n);
    if (c !== "Not rated") {
      pRated++;
      if (prc[c] != null) prc[c]++;
    }
  });
  const matVals = allPrinc()
    .map((p) => princMaturity(rec, p.n))
    .filter((v) => v >= 1);
  const avgMat = matVals.length ? matVals.reduce((a, b) => a + b, 0) / matVals.length : 0;
  return { total: stds.length, rated, cnt, prc, pRated, avgMat };
}

export function iasaSummary(rec: IaSaRecord): {
  op: string;
  rated: number;
  total: number;
  avgMat: number;
} {
  const st = iasaStats(rec);
  return { op: overallOpinion(rec), rated: st.rated, total: st.total, avgMat: st.avgMat };
}

/* ---------------- cadence & external quality assessment ---------------- */

export function iasaLastCompleted(db: WorkspaceDb): IaSaRecord | null {
  return (
    iaSaList(db)
      .filter((s) => s.status === "completed" && s.completedAt)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0] || null
  );
}

export function iasaNextDue(db: WorkspaceDb): {
  due: Date | null;
  overdue: boolean;
  txt: string;
  sub: string;
} {
  const last = iasaLastCompleted(db);
  if (!last)
    return { due: null, overdue: false, txt: "Due now", sub: "No self-assessment on record yet" };
  const d = new Date(last.completedAt as string);
  const due = new Date(d.getFullYear(), d.getMonth() + IASA_CADENCE_MONTHS, d.getDate());
  const overdue = due <= today0();
  return {
    due,
    overdue,
    txt: overdue ? "Due now" : "Due " + fmtDate(due),
    sub: "Last completed " + fmtDate(new Date(last.completedAt as string)) + " · " + (last.period || ""),
  };
}

export function eqaDue(
  rec: IaSaRecord | null,
  db: WorkspaceDb,
): { txt: string; sub: string; tone: string } {
  const m = rec?.lastEQA && String(rec.lastEQA).match(/\d{4}/);
  const yr = m ? +m[0] : null;
  const now = (db.planYear && +db.planYear) || new Date().getFullYear();
  if (!yr)
    return {
      txt: "Not on record",
      sub: EQA_CYCLE_YEARS + "-yearly EQA required (NCCG)",
      tone: "mid",
    };
  const due = yr + EQA_CYCLE_YEARS;
  const left = due - now;
  if (left <= 0)
    return {
      txt: "Due / overdue",
      sub: "Last EQA " + yr + " · " + EQA_CYCLE_YEARS + "-yr cycle reached",
      tone: "bad",
    };
  return { txt: "Due " + due, sub: left + " yr(s) left · last EQA " + yr, tone: left <= 1 ? "mid" : "good" };
}
