"use client";

// Word export of a self-assessment — port of exportIASA(). Principle conformance in the
// document is the standard-level rollup (as on screen); maturity/notes come from the record.

import { toast } from "@/components/feedback/ToastHost";
import { esc, wordDoc } from "@/lib/client/exports";
import {
  GIAS,
  MATURITY,
  STD_ACT_STATUS,
  allPrinc,
  conclusionSections,
  iasaStats,
  overallOpinion,
  princItem,
  qaipStats,
  rollupPrinc,
  stdActOverdue,
  stdItem,
} from "@/lib/workspace/iasa";
import type { IaSaRecord, WorkspaceDb } from "@/lib/workspace/types";

/** The conclusion as Word HTML: headed paragraphs when generated, else the old plain text. */
function conclusionHtml(sa: IaSaRecord): string {
  const c = sa.conclusion;
  if (!c) {
    return sa.commentary
      ? `<h2>Overall Conclusion</h2><div>${esc(sa.commentary).replace(/\n/g, "<br>")}</div>`
      : "";
  }
  const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  return (
    `<h2>Overall Conclusion</h2>` +
    conclusionSections(c)
      .map((s) => (s.heading ? `<h3>${esc(s.heading)}</h3>` : "") + `<p>${rich(s.text)}</p>`)
      .join("")
  );
}

export function exportIASA(db: WorkspaceDb, sa: IaSaRecord): void {
  /* The headline is the same rollup the Assessment tab shows. It used to count each principle's
     legacy `conformance` field, which current assessments never set, so the document said "Not
     yet assessed" over a fully rated assessment. */
  const st = iasaStats(sa);
  const overall = overallOpinion(sa);

  let inner = `<h1>Internal Audit Quality Self-Assessment</h1>
    <div class="meta">${esc(db.org)} — Internal Audit · against the IIA Global Internal Audit Standards (2024)${sa.period ? " · " + esc(sa.period) : ""}${sa.assessor ? " · Assessor: " + esc(sa.assessor) : ""}</div>
    <div class="note">Overall conformance: <b>${esc(overall)}</b> · Average maturity: <b>${st.avgMat ? st.avgMat.toFixed(1) + " / 5" : "—"}</b> · Standards: ${st.rated} of ${st.total} rated (${st.cnt["Conforms"]} conform, ${st.cnt["Partially Conforms"]} partially conform, ${st.cnt["Does Not Conform"]} do not conform) · Principles: ${st.prc["Generally Conforms"]} of ${allPrinc().length} generally conform.</div>
    ${conclusionHtml(sa)}
    <h2>Assessment by Principle</h2>`;

  GIAS.forEach((g) => {
    inner +=
      `<h3>Domain ${esc(g.d)}</h3><table><tr><th>#</th><th>Principle</th><th>Conformance</th><th>Maturity</th><th>Notes / evidence</th><th>Improvement action</th></tr>` +
      g.ps
        .map((p) => {
          const it = princItem(sa, p.n);
          const mat = Number(it.maturity) || 0;
          return `<tr><td>${p.n}</td><td><b>${esc(p.t)}</b></td><td>${esc(rollupPrinc(sa, p.n))}</td><td>${mat ? esc(MATURITY[mat]) : "—"}</td><td>${esc(it.notes || "")}</td><td>${esc(it.action || "")}</td></tr>`;
        })
        .join("") +
      `</table>`;
  });

  inner += `<h2>Assessment by Standard</h2>`;
  GIAS.forEach((g) => {
    inner +=
      `<h3>Domain ${esc(g.d)} — ${esc(g.dt)}</h3><table><tr><th>Std</th><th>Standard</th><th>Conformance</th><th>Evidence</th><th>Gap</th><th>Improvement action</th></tr>` +
      g.ps
        .flatMap((p) =>
          p.s.map(([num, t]) => {
            const iu = stdItem(sa, num);
            return `<tr><td><b>${esc(num)}</b></td><td>${esc(t)}</td><td>${esc(iu.conf || "Not rated")}</td><td>${esc(iu.evidence || "")}</td><td>${esc(iu.gap || "")}</td><td>${esc(iu.action || "")}${iu.target ? " · due " + esc(iu.target) : ""}</td></tr>`;
          }),
        )
        .join("") +
      `</table>`;
  });

  wordDoc(
    "IA Self-Assessment" + (sa.period ? " - " + String(sa.period).replace(/[^\w \-]/g, "") : ""),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}

/* QAIP progress report — port of the prototype's exportQAIP(): the Improvement Tracker tab
   as a Board-ready Word document. */
export function exportQAIP(db: WorkspaceDb, sa: IaSaRecord): void {
  const q = qaipStats(sa);
  const qaip = sa.qaip || {};
  if (!q.total) {
    toast("No improvement actions to report yet. Record an improvement action against a standard first.", "error");
    return;
  }
  const rows = q.actions
    .slice()
    .sort(
      (a, b) =>
        Number(stdActOverdue(b)) - Number(stdActOverdue(a)) ||
        STD_ACT_STATUS.indexOf((a.it.status || "Not started") as (typeof STD_ACT_STATUS)[number]) -
          STD_ACT_STATUS.indexOf((b.it.status || "Not started") as (typeof STD_ACT_STATUS)[number]),
    );
  const inner =
    `<h1>Quality Improvement Programme (QAIP) — Progress Report</h1>
    <div class="meta">${esc(db.org)} — Internal Audit · improvement tracking against the Global Internal Audit Standards (2024)${qaip.period ? " · " + esc(qaip.period) : sa.period ? " · " + esc(sa.period) : ""}</div>
    <div class="note"><b>${q.pct}% of improvement actions implemented or closed</b> (${q.done} of ${q.total}). In progress: ${q.cnt["In progress"]} · Not started: ${q.cnt["Not started"]} · Overdue: ${q.overdue}.</div>
    ${qaip.commentary ? `<h2>Commentary</h2><div>${esc(qaip.commentary).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Improvement Actions</h2>
    <table><tr><th>Std</th><th>Standard</th><th>Conformance</th><th>Gap</th><th>Improvement action</th><th>Owner</th><th>Target</th><th>Status</th><th>Completed</th><th>Latest update</th></tr>` +
    rows
      .map(
        (x) =>
          `<tr><td>${esc(x.num)}</td><td>${esc(x.title)}</td><td>${esc(x.c)}</td><td>${esc(x.it.gap || "")}</td><td>${esc(x.it.action || "")}</td><td>${esc(x.it.owner || "")}</td><td>${esc(x.it.target || "")}${stdActOverdue(x) ? " (overdue)" : ""}</td><td>${esc(x.it.status || "Not started")}</td><td>${esc(x.it.done || "")}</td><td>${esc(x.it.progress || "")}</td></tr>`,
      )
      .join("") +
    `</table>`;
  wordDoc(
    "QAIP Progress Report" +
      (qaip.period || sa.period ? " - " + String(qaip.period || sa.period).replace(/[^\w \-]/g, "") : ""),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}
