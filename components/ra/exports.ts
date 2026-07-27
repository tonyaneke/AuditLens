"use client";

// Word exports for the audit risk assessment / annual plan (ports of exportRA and
// exportAuditPlan in audit-bot.js).

import { toast } from "@/components/feedback/ToastHost";
import { esc, wordDoc } from "@/lib/client/exports";
import {
  engStatusText,
  planYear,
  RA_FACTORS,
  raRanked,
  unitOccDone,
  unitOccTotal,
} from "@/lib/workspace/ra";
import type { WorkspaceDb } from "@/lib/workspace/types";

export function exportRA(db: WorkspaceDb): void {
  const en = raRanked(db);
  if (!en.length) {
    toast("No auditable units to export.");
    return;
  }
  const py = planYear(db);
  const inner = `<h1>Annual Audit Risk Assessment</h1><div class="meta">${esc(db.org)} — Internal Audit · Plan year ${esc(py)} · ${en.length} auditable unit(s)</div>
    <div class="note">Risk-based audit planning (IIA Standard 2010). Each auditable unit scored 1–5 on weighted risk factors (${RA_FACTORS.map(([, l, w]) => esc(l) + " " + Math.round(w * 100) + "%").join("; ")}). Composite rating sets audit frequency: Critical/High = annual, Medium = 2-yearly, Low = 3-yearly.</div>
    <h2>Risk-Ranked Audit Universe</h2>
    <table><tr><th>#</th><th>Auditable unit</th><th>Category</th><th>Score</th><th>Rating</th><th>Last audited</th><th>Frequency</th><th>Due ${esc(py)}</th></tr>
    ${en
      .map(
        (e, i) =>
          `<tr><td>${i + 1}</td><td><b>${esc(e.name)}</b>${e.owner ? `<br><span class="meta">${esc(e.owner)}</span>` : ""}</td><td>${esc(e.category || "—")}</td><td>${e.score.toFixed(2)}</td><td>${e.band}</td><td>${esc(e.lastAudited || "—")}</td><td>${esc(e.freq)}</td><td>${e.due ? "Yes" : "—"}</td></tr>`,
      )
      .join("")}
    </table>`;
  wordDoc("Audit Risk Assessment " + py, inner, typeof db.logo === "string" ? db.logo : undefined);
}

export function exportAuditPlan(db: WorkspaceDb): void {
  const all = raRanked(db);
  if (!all.length) {
    toast("No auditable units — run the risk assessment first.");
    return;
  }
  const en = all.filter((e) => e.incl);
  const py = planYear(db);
  const totalOcc = en.reduce((s, e) => s + unitOccTotal(e), 0);
  const doneOcc = en.reduce((s, e) => s + unitOccDone(e), 0);
  const pctPlan = totalOcc ? Math.round((doneOcc / totalOcc) * 100) : 0;
  const inner = `<h1>Annual Audit Plan — ${esc(py)}</h1><div class="meta">${esc(db.org)} — Internal Audit · ${en.length} planned engagement(s)</div>
    <div class="note">Derived from the annual audit risk assessment. Engagements are selected on the basis of risk rating and the audit-frequency cycle. <b>Plan delivery: ${doneOcc} of ${totalOcc} quarter-reviews completed (${pctPlan}%).</b></div>
    <table><tr><th>#</th><th>Auditable unit</th><th>Category</th><th>Rating</th><th>Frequency</th><th>Planned timing</th><th>Status</th><th>Rationale</th></tr>
    ${en
      .map(
        (e, i) =>
          `<tr><td>${i + 1}</td><td><b>${esc(e.name)}</b></td><td>${esc(e.category || "—")}</td><td>${e.band}</td><td>${esc(e.freq)}</td><td>${esc(e.plannedPeriod || "")}</td><td>${esc(engStatusText(e))}</td><td>${esc(e.rationale || (e.due ? "Due per cycle" : e.band + " risk"))}</td></tr>`,
      )
      .join("")}
    </table>`;
  wordDoc("Annual Audit Plan " + py, inner, typeof db.logo === "string" ? db.logo : undefined);
}
