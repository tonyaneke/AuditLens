"use client";

// Quarterly report to the Board Audit Committee — React port of modalCaeReport /
// exportCaeReport, with the Fraud Prevention Plan details appended in the fraud section.

import { useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiText } from "@/lib/client/ai";
import { esc, stamp, wordDoc } from "@/lib/client/exports";
import {
  allObs,
  ck,
  CRITS,
  daysToClose,
  effectiveClose,
  fmtDate,
  fraudBand,
  fraudList,
  fraudResidual,
  isOverdueObs,
  residualBand,
  zeroCrit,
} from "@/lib/workspace/selectors";
import {
  engStatusText,
  RA_BANDS,
  raBand,
  raComposite,
  raDue,
  raInPlan,
  unitOccDone,
  unitOccTotal,
  universe,
} from "@/lib/workspace/ra";
import type { WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

function buildCaePrompt(db: WorkspaceDb, period: string): string {
  const obs = allObs(db);
  const c = zeroCrit();
  obs.forEach((o) => c[o.criticality]++);
  const open = obs.filter((o) => o.status !== "Closed").length;
  const en = universe(db)
    .map((e) => {
      const score = raComposite(e.factors);
      const band = e.ratingOverride || raBand(score);
      const due = raDue(db, e, band);
      return { ...e, incl: raInPlan(e, band, due) };
    })
    .filter((e) => e.incl);
  const pc = en.filter((e) => e.engStatus === "Completed").length;
  const F = fraudList(db);
  const fA = F.flatMap((f) => f.actions || []);
  const fI = fA.filter((a) => a.status === "Implemented").length;
  const ratingMix =
    CRITS.map((k) => c[k] + " " + k).filter((x) => !x.startsWith("0 ")).join(", ") || "none";
  return `Act as the Chief Audit Executive for ${db.org}. Draft a concise executive commentary (3–5 short paragraphs) for the quarterly Internal Audit report to the Board Audit Committee for ${period || "the period"}. Summarise: audit plan delivery, key observations and themes, remediation status (open / overdue), notable repeat findings, and fraud risk management progress. Return plain text only (no JSON).

Key data:
- Annual audit plan: ${pc} of ${en.length} engagements completed.
- Observations: ${obs.length} total (${ratingMix}); ${open} open.
- Fraud prevention plan: ${fI} of ${fA.length} actions implemented.`;
}

export function exportCaeReport(db: WorkspaceDb): void {
  const u = db.caeReport || {};
  const obs = allObs(db);
  const c = zeroCrit();
  obs.forEach((o) => c[o.criticality]++);
  const open = obs.filter((o) => o.status !== "Closed").length;
  const closed = obs.length - open;
  const remRate = obs.length ? Math.round((closed / obs.length) * 100) : 0;
  const overdue = obs.filter((o) => isOverdueObs(o, o._r)).length;
  const reps = obs.filter((o) => o.isRepeat).length;
  const en = universe(db).map((e) => {
    const score = raComposite(e.factors);
    const band = e.ratingOverride || raBand(score);
    const due = raDue(db, e, band);
    return { ...e, band, incl: raInPlan(e, band, due) };
  });
  const plan = en
    .filter((e) => e.incl)
    .sort((a, b) => RA_BANDS.indexOf(b.band as (typeof RA_BANDS)[number]) - RA_BANDS.indexOf(a.band as (typeof RA_BANDS)[number]));
  const pTotOcc = plan.reduce((s, e) => s + unitOccTotal(e), 0);
  const pDoneOcc = plan.reduce((s, e) => s + unitOccDone(e), 0);
  const pUnitsDone = plan.filter((e) => unitOccDone(e) >= unitOccTotal(e)).length;
  const pUnitsProg = plan.filter((e) => {
    const d = unitOccDone(e);
    return d > 0 && d < unitOccTotal(e);
  }).length;
  const pPct = pTotOcc ? Math.round((pDoneOcc / pTotOcc) * 100) : 0;
  const F = fraudList(db);
  const fA = F.flatMap((f) => f.actions || []);
  const fImpl = fA.filter((a) => a.status === "Implemented").length;
  const fHighX = F.map((f) =>
    f.residualOverride || residualBand(fraudBand(f.likelihood * f.impact), f.controlStrength),
  ).filter((b) => b === "Extreme" || b === "High").length;
  const watch = obs
    .filter((o) => o.status !== "Closed")
    .map((o) => ({ o, d: daysToClose(o, o._r) }))
    .filter((x) => x.d != null && x.d <= 14)
    .sort((a, b) => (a.d as number) - (b.d as number));

  let inner = `<h1>Internal Audit — Quarterly Report to the Board Audit Committee</h1>
    <div class="meta">${esc(db.org)} — Internal Audit${u.period ? " · " + esc(u.period) : ""}</div>
    ${u.commentary ? `<h2>Executive Commentary</h2><div>${esc(u.commentary).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>1. Annual Audit Plan Progress</h2>
    <div class="note"><b>${pDoneOcc} of ${pTotOcc} quarter-reviews completed (${pPct}%)</b> across ${plan.length} engagement(s) — ${pUnitsDone} fully complete, ${pUnitsProg} in progress.</div>
    ${plan.length ? `<table><tr><th>Auditable unit</th><th>Rating</th><th>Timing</th><th>Status</th></tr>${plan.map((e) => `<tr><td>${esc(e.name)}</td><td>${e.band}</td><td>${esc(e.plannedPeriod || "")}</td><td>${esc(engStatusText(e))}</td></tr>`).join("")}</table>` : `<div>No engagements selected into the plan.</div>`}
    <h2>2. Audit Observations</h2>
    <div class="note">${obs.length} observation(s): ${CRITS.filter((k) => c[k]).map((k) => `<span class="pill ${ck(k)}">${c[k]} ${k}</span>`).join(" ") || "none"}. ${open} open · ${closed} closed (remediation rate <b>${remRate}%</b>) · ${overdue} overdue · ${watch.length} due within 2 weeks · ${reps} repeat finding(s).</div>
    <h2>3. Overdue &amp; Watchlist (due within 2 weeks)</h2>
    ${watch.length ? `<table><tr><th>Criticality</th><th>Observation</th><th>Audit</th><th>Owner</th><th>Expected close</th></tr>${watch.slice(0, 25).map(({ o, d }) => { const ec = effectiveClose(o, o._r); return `<tr><td><span class="pill ${ck(o.criticality)}">${o.criticality}</span></td><td>${esc(o.title)}</td><td>${esc(o._a.name)}</td><td>${esc(o.owner || "—")}</td><td>${ec ? esc(fmtDate(ec)) : "—"}${(d as number) < 0 ? " (overdue)" : ""}</td></tr>`; }).join("")}</table>` : `<div>No overdue or near-due open items.</div>`}
    <h2>4. Fraud Risk Management</h2>
    <div class="note">${F.length} fraud risk(s); <b>${fHighX}</b> at Extreme/High residual exposure. Prevention plan: ${fImpl} of ${fA.length} action(s) implemented (${fA.length ? Math.round((fImpl / fA.length) * 100) : 0}%).</div>`;

  // Fraud Prevention Plan details — every risk with its prevention/response actions.
  const withActions = F.filter((f) => (f.actions || []).length);
  if (F.length) {
    inner += `<h3>Fraud Prevention Plan — actions by risk</h3>`;
    if (withActions.length) {
      withActions.forEach((f) => {
        const res = fraudResidual(f);
        inner += `<div class="note" style="margin-top:8pt"><b>${esc(f.scheme)}</b> · ${esc(f.category || "—")} · residual <b>${esc(res)}</b> · ${esc(f.status || "Identified")}${f.owner ? " · owner: " + esc(f.owner) : ""}</div>
        <table><tr><th>Prevention / response action</th><th>Type</th><th>Target</th><th>Status</th><th>Latest update</th></tr>
        ${(f.actions || [])
          .map((a) => {
            const last = (a.ownerUpdates || [])[0];
            return `<tr><td>${esc(a.text)}</td><td>${esc(a.type || "—")}</td><td>${esc(a.targetDate || "—")}</td><td>${esc(a.status || "Planned")}</td><td>${esc(last ? last.text : a.update || "—")}</td></tr>`;
          })
          .join("")}</table>`;
      });
    } else {
      inner += `<div>No prevention actions captured yet.</div>`;
    }
  }

  wordDoc(
    "IA Quarterly BAC Report" + (u.period ? " - " + String(u.period).replace(/[^\w \-]/g, "") : " " + stamp()),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}

export default function CaeReportDialog() {
  const { db, mutate, saveNow } = useWorkspace();
  const modal = useModal();
  const [period, setPeriod] = useState(db.caeReport?.period || "");
  const [commentary, setCommentary] = useState(db.caeReport?.commentary || "");

  const persist = () =>
    mutate((d) => {
      d.caeReport = { period, commentary };
    });

  return (
    <ModalFrame
      title="Quarterly report to the Board Audit Committee"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              persist();
              modal.close();
            }}
          >
            Save
          </button>
          <BusyButton
            className="btn dark"
            busyLabel="Exporting…"
            onClick={async () => {
              persist();
              await saveNow();
              exportCaeReport(db);
            }}
          >
            ⤓ Export report (Word)
          </BusyButton>
        </>
      }
    >
      <p className="hint">
        Set the period and an executive commentary, then export the whole-of-function quarterly
        pack (plan progress, observations, remediation, fraud incl. the prevention plan).
      </p>
      <div className="f2">
        <div>
          <label>Reporting period</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Q2 2026" />
        </div>
        <div>
          <label>&nbsp;</label>
          <BusyButton
            className="btn sec ai-generate-btn"
            style={{ width: "100%" }}
            busyLabel="Generating…"
            onClick={async () => {
              try {
                const text = await runAiText(buildCaePrompt(db, period));
                if (text) setCommentary(text.trim());
              } catch {
                /* surfaced via overlay */
              }
            }}
          >
            Generate commentary
          </BusyButton>
        </div>
      </div>
      <label>Executive commentary to the BAC</label>
      <textarea
        style={{ minHeight: 150 }}
        value={commentary}
        onChange={(e) => setCommentary(e.target.value)}
      />
    </ModalFrame>
  );
}
