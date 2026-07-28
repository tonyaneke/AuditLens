// External audit findings domain — pure helpers ported 1:1 from the EXTERNAL AUDIT FINDINGS
// section of public/audit-bot.js (~2809–3255) plus the repeat-similarity helpers (repSim et al,
// ~5845) and parseCSV (~4615) it relies on. All take the workspace db (or plain data) explicitly.

import { allObs, extOverdue, isoNow, uid, type ObsWithContext } from "./selectors";
import type { ExtFinding, ObsUpdate, WorkspaceDb } from "./types";

/* ---------------- constants (verbatim) ---------------- */

export const EXT_SOURCES = [
  "Statutory / External Audit",
  "CBN Examination",
  "ICPC",
  "ISO",
  "NDPC Data Protection",
  "EFCC/NFIU AML-CFT",
  "FIRS / Tax",
  "Funding / Donor",
  "Other",
];
export const EXT_THEMES = [
  "Access & IT security",
  "Financial reporting",
  "Procurement & expenses",
  "Credit & lending",
  "AML/CFT",
  "Data protection",
  "Governance & compliance",
  "HR & payroll",
  "Asset management",
  "Documentation & records",
  "Third-party / vendor",
  "BCP/DR",
  "Other",
];
export const EXT_SEV_HEX: Record<string, string> = {
  High: "#b00020",
  Medium: "#c9a300",
  Low: "#2e7d32",
};
export const EXT_SEVERITIES = ["High", "Medium", "Low"];
const EXT_STATUSES = ["Open", "In Progress", "Closed"];

/* ---------------- register filter ---------------- */

export type ExtFilter = { q: string; source: string; theme: string; status: string; year: string };
export const DEFAULT_EXT_FILTER: ExtFilter = {
  q: "",
  source: "All",
  theme: "All",
  status: "All",
  year: "All",
};

export function ensureExtList(db: WorkspaceDb): ExtFinding[] {
  db.extFindings = db.extFindings || [];
  return db.extFindings;
}

export function extMatches(f: ExtFinding, filter: ExtFilter): boolean {
  const q = (filter.q || "").toLowerCase().trim();
  if (filter.source !== "All" && f.source !== filter.source) return false;
  if (filter.theme !== "All" && f.theme !== filter.theme) return false;
  if (filter.status !== "All" && (f.status || "Open") !== filter.status) return false;
  if (filter.year !== "All" && String(f.year || "") !== filter.year) return false;
  if (q) {
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
      (f.year || "")
    ).toLowerCase();
    if (!h.includes(q)) return false;
  }
  return true;
}

export function extStatusCls(s: string | undefined): string {
  return s === "Closed" ? "closed" : s === "In Progress" ? "progress" : "open";
}

export function extNextRef(db: WorkspaceDb): string {
  const F = db.extFindings || [];
  const used = new Set(F.map((f) => f.ref).filter(Boolean));
  let n = F.length + 1;
  let ref: string;
  do {
    ref = "EF-" + String(n).padStart(3, "0");
    n++;
  } while (used.has(ref));
  return ref;
}

/* ---------------- repeat similarity (verbatim ports) ---------------- */

const REP_STOP = new Set(
  "the a an of in for to and or on at by with from is are was were not no this that these those over under within across into out control controls gap gaps deficiency deficiencies weakness weaknesses inadequate inadequacy lack absence ambiguity ambiguities issue issues observed observation observations finding findings risk risks process processes governance people system systems".split(
    /\s+/,
  ),
);
function repTokens(s: string | undefined): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !REP_STOP.has(w));
}
function repBigrams(s: string | undefined): string[] {
  const t = (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const g: string[] = [];
  for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
  return g;
}
function repDice(a: string | undefined, b: string | undefined): number {
  const A = repBigrams(a);
  const B = repBigrams(b);
  if (!A.length || !B.length) return 0;
  const m: Record<string, number> = {};
  A.forEach((g) => (m[g] = (m[g] || 0) + 1));
  let inter = 0;
  B.forEach((g) => {
    if (m[g] > 0) {
      inter++;
      m[g]--;
    }
  });
  return (2 * inter) / (A.length + B.length);
}
export function repSim(
  a: string | undefined,
  b: string | undefined,
): { score: number; shared: number; dice: number } {
  const ta = repTokens(a);
  const tb = repTokens(b);
  if (!ta.length || !tb.length) return { score: 0, shared: 0, dice: 0 };
  const A = new Set(ta);
  const B = new Set(tb);
  let inter = 0;
  A.forEach((x) => {
    if (B.has(x)) inter++;
  });
  const jac = inter / (A.size + B.size - inter);
  const dice = repDice(a, b);
  return { score: 0.65 * jac + 0.35 * dice, shared: inter, dice };
}

export type ExtCluster = { rep: string; items: ExtFinding[] };

export function clusterExt(F: ExtFinding[]): ExtCluster[] {
  const items = F.filter((f) => (f.title || "").trim().length > 6);
  const used = new Array(items.length).fill(false);
  const cl: ExtCluster[] = [];
  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    const g = [items[i]];
    used[i] = true;
    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      const s = repSim(items[i].title, items[j].title);
      if (s.score >= 0.42 || s.dice >= 0.6) {
        g.push(items[j]);
        used[j] = true;
      }
    }
    if (g.length >= 2 || items[i].isRepeat)
      cl.push({
        rep: items[i].title.length > 150 ? items[i].title.slice(0, 149) + "…" : items[i].title,
        items: g,
      });
  }
  return cl.sort((a, b) => b.items.length - a.items.length).slice(0, 8);
}

/** IA coverage cross-reference: fuzzy-match each external finding to internal observations. */
export type ExtCross = { f: ExtFinding; best: ObsWithContext | null; bs: number };
export function extCoverageCross(db: WorkspaceDb): ExtCross[] {
  const obs = allObs(db);
  return (db.extFindings || []).map((f) => {
    let bs = 0;
    let best: ObsWithContext | null = null;
    obs.forEach((o) => {
      const s = repSim(f.title, o.title).score;
      if (s > bs) {
        bs = s;
        best = o;
      }
    });
    return { f, best, bs };
  });
}

/* ---------------- import (CSV + normalization) ---------------- */

export function extNormalize(
  x: Record<string, unknown>,
  src: string,
  sref: string,
): ExtFinding {
  const theme =
    EXT_THEMES.find((t) => t.toLowerCase() === String(x.theme || "").toLowerCase()) || "Other";
  const sev =
    EXT_SEVERITIES.find((s) => s.toLowerCase() === String(x.severity || "").toLowerCase()) ||
    "Medium";
  const source =
    EXT_SOURCES.find((s) => s.toLowerCase() === String(x.source || src || "").toLowerCase()) ||
    (String(x.source || "") || src || "Other");
  const st =
    EXT_STATUSES.find((s) => s.toLowerCase() === String(x.status || "").toLowerCase()) || "Open";
  return {
    id: uid(),
    source,
    sourceRef: String(x.sourceRef || "") || sref || "",
    year: x.year ? String(x.year) : "",
    ref: String(x.ref || ""),
    title: String(x.title || x.finding || "(untitled)"),
    detail: String(x.detail || x.description || ""),
    risk: String(x.risk || x.impact || ""),
    recommendation: String(x.recommendation || ""),
    theme,
    severity: sev,
    owner: String(x.owner || ""),
    targetDate: String(x.targetDate || x.target || ""),
    status: st,
    managementResponse: String(x.managementResponse || x.response || ""),
    isRepeat: !!x.isRepeat,
    repeatOf: String(x.repeatOf || ""),
    closedDateISO: st === "Closed" ? isoNow() : "",
    createdAt: new Date().toISOString(),
  };
}

/** Verbatim port of the legacy CSV parser (quoted fields, doubled quotes, CR/LF). */
export function parseCSV(input: string): string[][] {
  const text = input.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** Port of doImportExtCSV's parse step — returns the findings to add or an error message. */
export function extFindingsFromCsv(
  text: string,
): { ok: true; findings: ExtFinding[] } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "Paste or load CSV first." };
  const rows = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (rows.length < 2)
    return { ok: false, error: "Need a header row plus at least one finding." };
  const H = rows[0].map((h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const M: Record<string, string> = {
    source: "source",
    sourceref: "sourceRef",
    report: "sourceRef",
    year: "year",
    ref: "ref",
    sn: "ref",
    title: "title",
    finding: "title",
    observation: "title",
    detail: "detail",
    description: "detail",
    risk: "risk",
    impact: "risk",
    recommendation: "recommendation",
    theme: "theme",
    category: "theme",
    severity: "severity",
    rating: "severity",
    owner: "owner",
    targetdate: "targetDate",
    duedate: "targetDate",
    status: "status",
    managementresponse: "managementResponse",
    response: "managementResponse",
    isrepeat: "isRepeat",
    repeat: "isRepeat",
    repeatof: "repeatOf",
  };
  const idx: Record<string, number> = {};
  H.forEach((h, i) => {
    if (M[h] != null && idx[M[h]] == null) idx[M[h]] = i;
  });
  if (idx.title == null) return { ok: false, error: "CSV must include a Title column." };
  const findings: ExtFinding[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const g = (k: string) =>
      idx[k] != null ? String(cols[idx[k]] == null ? "" : cols[idx[k]]).trim() : "";
    if (!g("title")) continue;
    const x = {
      source: g("source"),
      sourceRef: g("sourceRef"),
      year: g("year"),
      ref: g("ref"),
      title: g("title"),
      detail: g("detail"),
      risk: g("risk"),
      recommendation: g("recommendation"),
      theme: g("theme"),
      severity: g("severity"),
      owner: g("owner"),
      targetDate: g("targetDate"),
      status: g("status"),
      managementResponse: g("managementResponse"),
      isRepeat: /^(y|yes|true|1)$/i.test(g("isRepeat")),
      repeatOf: g("repeatOf"),
    };
    findings.push(extNormalize(x, g("source"), g("sourceRef")));
  }
  if (!findings.length) return { ok: false, error: "No findings found in the CSV." };
  return { ok: true, findings };
}

/* ---------------- AI insight commentary prompt (verbatim) ---------------- */

export function buildExtInsightPrompt(db: WorkspaceDb): string {
  const F = db.extFindings || [];
  const themeC: Record<string, number> = {};
  F.forEach((f) => {
    const t = f.theme || "Other";
    themeC[t] = (themeC[t] || 0) + 1;
  });
  const themes = Object.entries(themeC)
    .sort((a, b) => b[1] - a[1])
    .map(([t, v]) => t + " (" + v + ")")
    .join(", ");
  const bySrc: Record<string, number> = {};
  F.forEach((f) => (bySrc[f.source || "Other"] = (bySrc[f.source || "Other"] || 0) + 1));
  const src = Object.entries(bySrc)
    .map(([s, v]) => s + " " + v)
    .join("; ");
  const open = F.filter((f) => f.status !== "Closed").length;
  const reps = F.filter((f) => f.isRepeat).length;
  return `Act as Chief Audit Executive for ${db.org}. Draft a concise strategic commentary (2–3 short paragraphs) for the Board Audit Committee on the external and regulatory audit findings. Highlight the recurring areas of concern, any repeat/systemic issues, closure/remediation status, and where these point to internal-control themes requiring management attention. Return plain text only.

Data: ${F.length} findings (${open} open, ${reps} flagged repeat). By theme: ${themes || "n/a"}. By source: ${src || "n/a"}.`;
}

/* ---------------- remediation-chain helpers (ext scope of the obs helpers) ---------------- */

export function uniq(a: (string | undefined)[]): string[] {
  return Array.from(new Set((a || []).filter(Boolean) as string[]));
}

export function extUpdates(f: ExtFinding): ObsUpdate[] {
  f.updates = f.updates || [];
  return f.updates;
}
export function extIsWithdrawn(f: ExtFinding): boolean {
  return !!(f.withdrawn || (f.withdrawal && f.withdrawal.stage === "withdrawn"));
}
export function extWithdrawStage(f: ExtFinding): string {
  return (f.withdrawal && String(f.withdrawal.stage || "")) || "";
}

export { extOverdue };
