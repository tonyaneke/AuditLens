"use client";

// Word exports for the audit-planning domain — 1:1 ports of exportPlan, exportExceptions and
// exportSopUpdates from public/audit-bot.js. Kept beside (not inside) lib/client/word.ts so the
// existing export surface stays unchanged.

import type { Audit, AuditTest, Report, WorkspaceDb } from "@/lib/workspace/types";
import { CRITS, ck } from "@/lib/workspace/selectors";
import { testControl, testIsException, testResultNotes, testTitle } from "@/lib/workspace/observations";
import { esc, wordDoc } from "./exports";
import { obsToWord, orgLogo } from "./word";
import { toast } from "@/components/feedback/ToastHost";

type Plan = { scope?: string; objectives?: string[]; keyRisks?: string[]; tests?: AuditTest[] };

/** Port of exportPlan(aid) — Audit Planning Memo (Word). */
export function exportPlanWord(db: WorkspaceDb, a: Audit): void {
  const p = (a.plan || {}) as Plan;
  let inner = `<h1>Audit Planning Memo — ${esc(a.name)}</h1>
    <div class="meta">${esc(db.org)} — Internal Audit · ${esc(a.type === "department" ? "Department audit" : "Process audit")}${a.area ? " · " + esc(a.area) : ""}${a.period ? " · " + esc(a.period) : ""}</div>`;
  if (p.scope) inner += `<h2>Scope</h2><div>${esc(p.scope).replace(/\n/g, "<br>")}</div>`;
  if ((p.objectives || []).length)
    inner += `<h2>Audit Objectives</h2><ul>${(p.objectives || []).map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`;
  if ((p.keyRisks || []).length)
    inner += `<h2>Key Risks</h2><ul>${(p.keyRisks || []).map((o) => `<li>${esc(o)}</li>`).join("")}</ul>`;
  const tests = p.tests || [];
  inner += `<h2>Test Programme</h2>`;
  if (tests.length) {
    inner += `<table><tr><th>Ref</th><th>Test</th><th>Objective</th><th>Procedure</th><th>Control tested</th><th>Population / sample</th></tr>`;
    inner += tests
      .map(
        (t) =>
          `<tr><td>${esc(t.ref || "")}</td><td><b>${esc(testTitle(t))}</b></td><td>${esc(t.objective || "").replace(/\n/g, "<br>")}</td><td>${esc(t.procedure || "").replace(/\n/g, "<br>")}</td><td>${esc(testControl(t))}</td><td>${esc(t.population || "")}${t.sampleBasis ? " · " + esc(t.sampleBasis) : ""}</td></tr>`,
      )
      .join("");
    inner += `</table>`;
  } else inner += `<div>No tests defined.</div>`;
  wordDoc("Audit Planning Memo - " + a.name.replace(/[^\w \-]/g, ""), inner, orgLogo(db));
}

/** Port of exportExceptions(aid) — fieldwork exceptions report (Word). */
export function exportExceptionsWord(db: WorkspaceDb, a: Audit): void {
  const tests = (((a.plan || {}) as Plan).tests || []).filter(testIsException);
  let inner = `<h1>Exceptions Report — ${esc(a.name)}</h1>
    <div class="meta">${esc(db.org)} — Internal Audit${a.area ? " · " + esc(a.area) : ""}${a.period ? " · " + esc(a.period) : ""}</div>
    <div class="note"><b>${tests.length}</b> test(s) with exceptions identified during fieldwork.</div>`;
  if (!tests.length) {
    inner += `<div>No exceptions recorded.</div>`;
    wordDoc("Exceptions Report - " + a.name.replace(/[^\w \-]/g, ""), inner, orgLogo(db));
    return;
  }
  inner += `<h2>Summary of exceptions</h2><table><tr><th>Test</th><th>Result</th><th>What was found</th><th>Evidence</th><th>Observation raised</th></tr>`;
  const linked: import("@/lib/workspace/types").Observation[] = [];
  tests.forEach((t) => {
    const obs = (a.reports || []).flatMap((r) => r.observations || []).filter((o) => o.sourceTest === t.id);
    obs.forEach((o) => linked.push(o));
    inner += `<tr><td><b>${esc(t.ref || "")}</b> ${esc(testTitle(t))}</td><td><span class="pill ${t.result === "Exception" ? "Critical" : "Moderate"}">${t.result}</span></td>
      <td>${esc(testResultNotes(t)).replace(/\n/g, "<br>")}</td><td>${esc(t.evidenceRef || "—")}</td>
      <td>${obs.length ? obs.map((o) => esc((o.ref ? o.ref + " — " : "") + o.title) + " <span class='pill " + ck(o.criticality) + "'>" + o.criticality + "</span>").join("<br>") : "<i>not yet raised</i>"}</td></tr>`;
  });
  inner += `</table>`;
  if (linked.length) {
    inner += `<h2>Detailed exceptions / observations</h2>` + linked.map((o) => obsToWord(o)).join("");
  }
  wordDoc("Exceptions Report - " + a.name.replace(/[^\w \-]/g, ""), inner, orgLogo(db));
}

/** Port of exportSopUpdates(aid,rid) — consolidated proposed SOP change-list (Word). */
export function exportSopUpdatesWord(db: WorkspaceDb, r: Report): void {
  const sopObs = (r.observations || [])
    .filter((o) => (o.sopUpdate || "").trim())
    .slice()
    .sort((x, y) => CRITS.indexOf(x.criticality) - CRITS.indexOf(y.criticality));
  if (!sopObs.length) {
    toast("No proposed SOP updates in this report.");
    return;
  }
  const inner = `<h1>Proposed SOP Updates</h1><div class="meta">${esc(db.org)} — Internal Audit${r.refNo ? " · Ref: " + esc(r.refNo) : ""} · ${esc(r.title)}${r.period ? " · " + esc(r.period) : ""}</div>
    <div class="note">Consolidated procedure revisions arising from the observations in this report — ${sopObs.length} proposed update(s), ordered by rating.</div>
    <table><tr><th>#</th><th>Ref</th><th>Observation</th><th>Rating</th><th>Proposed SOP update</th></tr>
    ${sopObs.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.ref || "")}</td><td><b>${esc(o.title)}</b></td><td><span class="pill ${ck(o.criticality)}">${o.criticality}</span></td><td>${esc(o.sopUpdate).replace(/\n/g, "<br>")}</td></tr>`).join("")}
    </table>`;
  wordDoc("Proposed SOP Updates - " + r.title.replace(/[^\w \-]/g, ""), inner, orgLogo(db));
}
