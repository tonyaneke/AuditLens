// Process & control effectiveness reviews — helpers ported 1:1 from public/audit-bot.js
// (procList, PROC_* constants, mapProcAnalysis, procStepHex, wrapText, flowchartSVG).
// Everything takes the workspace db explicitly; nothing reads a global.

import { uid } from "./selectors";
import type { ProcFinding, ProcStep, ProcessReview, WorkspaceDb } from "./types";

/* ---------------- constants (verbatim from audit-bot.js) ---------------- */

export const PROC_RATINGS = ["Strong", "Adequate", "Needs improvement", "Weak"];
export const PROC_RATING_HEX: Record<string, string> = {
  Strong: "#2e7d32",
  Adequate: "#c9a300",
  "Needs improvement": "#e8590c",
  Weak: "#b00020",
};
export const PROC_CATS: readonly (readonly [string, string])[] = [
  ["Control gap", "#b00020"],
  ["Process gap", "#e8590c"],
  ["Redundancy", "#6b3fa0"],
  ["Efficiency opportunity", "#1f7a8c"],
  ["Strength", "#2e7d32"],
];
export const PROC_SEV = ["High", "Medium", "Low"];
export const PROC_SEV_HEX: Record<string, string> = {
  High: "#b00020",
  Medium: "#c9a300",
  Low: "#2e7d32",
};
export const PROC_STEP_TYPES = ["start", "step", "control", "decision", "end"];

// Canonical organisation departments (legacy DEPARTMENTS — pre-fills the unit picker).
export const DEPARTMENTS = [
  "Strategy Department",
  "Credit Operations",
  "Audit Department",
  "Finance Department",
  "Legal Department",
  "People & Culture Department",
  "Risk Management",
  "Procurement Department",
  "Operations Department",
  "Administration Department",
  "Office of the Managing Director",
];

/* ---------------- accessors ---------------- */

/** Read-only accessor. Use ensureProcList() inside mutate() when pushing/removing reviews. */
export function procList(db: WorkspaceDb): ProcessReview[] {
  return db.processReviews || [];
}
export function ensureProcList(db: WorkspaceDb): ProcessReview[] {
  db.processReviews = db.processReviews || [];
  return db.processReviews;
}

/** Findings per category, in PROC_CATS order (legacy counts computation). */
export function procCatCounts(findings: ProcFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  PROC_CATS.forEach(([c]) => (counts[c] = findings.filter((x) => x.category === c).length));
  return counts;
}

/* ---------------- AI analysis mapping (legacy mapProcAnalysis) ---------------- */

type RawProcFinding = {
  category?: string;
  title?: string;
  detail?: string;
  recommendation?: string;
  severity?: string;
};
export type RawProcAnalysis = {
  overallRating?: string;
  findings?: RawProcFinding[];
  summary?: string;
  keyRecommendations?: unknown[];
};

export function mapProcAnalysis(d: RawProcAnalysis): {
  rating: string;
  findings: ProcFinding[];
  summary: string;
  keyRecommendations: string[];
} {
  const rating =
    PROC_RATINGS.find((r) => r.toLowerCase() === String(d.overallRating || "").toLowerCase()) ||
    d.overallRating ||
    "";
  const findings: ProcFinding[] = (Array.isArray(d.findings) ? d.findings : []).map((x) => ({
    id: uid(),
    category: (PROC_CATS.find(
      (c) => c[0].toLowerCase() === String(x.category || "").toLowerCase(),
    ) || ["Process gap"])[0],
    title: x.title || "(untitled)",
    detail: x.detail || "",
    recommendation: x.recommendation || "",
    severity:
      PROC_SEV.find((s) => s.toLowerCase() === String(x.severity || "").toLowerCase()) || "Medium",
  }));
  return {
    rating,
    findings,
    summary: d.summary || "",
    keyRecommendations: Array.isArray(d.keyRecommendations)
      ? d.keyRecommendations.map(String)
      : [],
  };
}

/* ---------------- flowchart (legacy procStepHex/wrapText/flowchartSVG) ---------------- */

export function procStepHex(t: string | undefined): string {
  return (
    (
      {
        start: "#2e7d32",
        end: "#475569",
        step: "#1d6fb8",
        control: "#b00020",
        decision: "#c9a300",
      } as Record<string, string>
    )[t || ""] || "#1d6fb8"
  );
}

function escHtml(s: unknown): string {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

export function wrapText(s: unknown, max: number): string[] {
  const words = String(s == null ? "" : s)
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  words.forEach((w) => {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur ? cur + " " : "") + w;
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** SVG markup string — rendered inline (dangerouslySetInnerHTML) and downloaded as .svg. */
export function flowchartSVG(steps: ProcStep[] | undefined): string {
  if (!steps || !steps.length) return `<div class="hint">No steps to chart.</div>`;
  const W = 720,
    nodeW = 540,
    nodeX = (W - nodeW) / 2,
    lineH = 16,
    headH = 18,
    vPad = 12,
    gap = 34,
    top = 18;
  const tlabel: Record<string, string> = {
    start: "Start",
    end: "End",
    step: "Step",
    control: "Control",
    decision: "Decision",
  };
  const tbg: Record<string, string> = {
    start: "#eaf5eb",
    end: "#eef2f7",
    step: "#eaf2fb",
    control: "#fdecef",
    decision: "#fdf6e3",
  };
  let y = top;
  const nodes: { s: ProcStep; x: number; y: number; w: number; h: number; lines: string[] }[] = [];
  steps.forEach((s) => {
    const lines = wrapText(s.action, 68);
    const h = headH + vPad * 2 + lines.length * lineH;
    nodes.push({ s, x: nodeX, y, w: nodeW, h, lines });
    y += h + gap;
  });
  const totalH = Math.max(y - gap + 18, 60);
  let svg = `<svg viewBox="0 0 ${W} ${totalH}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI,Arial,sans-serif" style="max-width:780px">`;
  svg += `<defs><marker id="fcArr" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8"/></marker></defs>`;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i],
      b = nodes[i + 1],
      x = W / 2;
    svg += `<line x1="${x}" y1="${a.y + a.h}" x2="${x}" y2="${b.y - 2}" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#fcArr)"/>`;
    if (a.s.type === "decision" && a.s.note) {
      svg += `<text x="${x + 9}" y="${(a.y + a.h + b.y) / 2 + 3}" font-size="10.5" fill="#94772a">${escHtml(a.s.note)}</text>`;
    }
  }
  nodes.forEach((n) => {
    const c = procStepHex(n.s.type);
    const bg = tbg[n.s.type || ""] || "#eaf2fb";
    const rnd = n.s.type === "start" || n.s.type === "end";
    const r = rnd ? Math.min(n.h / 2, 22) : 12;
    svg += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${r}" ry="${r}" fill="${bg}" stroke="${c}" stroke-width="1.5"/>`;
    if (!rnd) svg += `<rect x="${n.x}" y="${n.y}" width="5" height="${n.h}" fill="${c}"/>`;
    svg += `<text x="${n.x + 16}" y="${n.y + 14}" font-size="10" font-weight="bold" fill="${c}" letter-spacing="0.4">${escHtml((n.s.actor || tlabel[n.s.type || ""] || "").toUpperCase())}</text>`;
    svg += `<text x="${n.x + n.w - 12}" y="${n.y + 14}" font-size="9" fill="${c}" text-anchor="end" opacity="0.85">${tlabel[n.s.type || ""] || "Step"}</text>`;
    n.lines.forEach((ln, li) => {
      svg += `<text x="${n.x + 16}" y="${n.y + headH + vPad + li * lineH}" font-size="12.5" fill="#1c2733">${escHtml(ln)}</text>`;
    });
  });
  return svg + `</svg>`;
}
