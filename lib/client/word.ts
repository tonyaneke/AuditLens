"use client";

// Shared Word-export builders for the audits domain — 1:1 ports of obsToWord, findingsTableWord,
// riskGuideWord, reportWordInner, exportReport/exportAudit/exportTOR from audit-bot.js. All take
// the workspace db explicitly; the org logo rides in as wordDoc's logo parameter (db.logo).

import type { Audit, AuditPlan, Observation, Report, WorkspaceDb } from "@/lib/workspace/types";
import { CRITS, ck, effectiveClose, fmtDate, isoToDate, obsAge } from "@/lib/workspace/selectors";
import { testControl, testResultNotes, testTitle, worstCrit, zc } from "@/lib/workspace/observations";
import { esc, wordDoc } from "./exports";

export function orgLogo(db: WorkspaceDb): string | undefined {
  return typeof db.logo === "string" && db.logo ? db.logo : undefined;
}

export function wbul(text: string | undefined): string {
  const items = (text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
}
export function wpar(v: string | undefined): string {
  return v ? `<div>${esc(v).replace(/\n/g, "<br>")}</div>` : "";
}

export function obsToWord(o: Observation): string {
  const f = (t: string, v: unknown) =>
    v ? `<div class="ttl">${t}</div><div>${esc(v).replace(/\n/g, "<br>")}</div>` : "";
  return `<div class="obs lc-${ck(o.criticality)}">
    <table style="margin:0 0 6pt"><tr><td style="border:none;padding:0;width:70%"><b>${esc(o.ref ? o.ref + " — " : "")}${esc(o.title)}</b></td>
    <td style="border:none;padding:0;text-align:right"><span class="pill ${ck(o.criticality)}">${o.criticality}</span> &nbsp;<span class="meta">${esc(o.status || "Open")}</span></td></tr></table>
    ${o.category ? `<div class="meta">${esc(o.category)}</div>` : ""}
    ${f("Detailed description", o.description)}
    ${f("Criteria / expectation", o.criteria)}
    ${f("Impact / risk", o.risk)}
    ${f("Possible root cause", o.rootCause)}
    ${f("Recommendation", o.recommendation)}
    ${f("Proposed SOP update", o.sopUpdate)}
    ${f("Management response", o.managementResponse)}
    ${o.owner || o.dueDate || o.timeline ? `<div class="meta" style="margin-top:5pt">${[o.owner ? "Owner: " + esc(o.owner) : "", o.timeline ? "Timeline: " + esc(o.timeline) : "", o.dueDate ? "Target: " + esc(o.dueDate) : ""].filter(Boolean).join(" · ")}</div>` : ""}
    ${o.status === "Closed" ? `<div class="meta" style="margin-top:3pt">Closed${o.closedDateISO ? " " + esc(fmtDate(isoToDate(o.closedDateISO))) : ""}${o.verifiedBy ? " · Verified by " + esc(o.verifiedBy) : ""}${o.closureEvidence ? " · Evidence: " + esc(o.closureEvidence) : ""}${o.closureNote ? " · " + esc(o.closureNote) : ""}</div>` : ""}
  </div>`;
}

export function findingsTableWord(obs: Observation[], r: Report): string {
  if (!obs.length) return `<div>No observations recorded.</div>`;
  let h = `<table class="findings"><tr><th style="width:22pt">S/n</th><th>Description</th><th>Impact/Risk</th><th>Root Cause</th><th>Recommendation</th><th>Remediation Action</th></tr>`;
  obs.forEach((o, i) => {
    const ec = effectiveClose(o, r), age = obsAge(o, r);
    const desc = `<b>${o.isRepeat ? "[REPEAT] " : ""}${esc(o.title)}</b>${o.isRepeat && o.repeatOf ? ` <i>(prior: ${esc(o.repeatOf)})</i>` : ""}${o.description ? "<br>" + esc(o.description).replace(/\n/g, "<br>") : ""}${o.criteria ? `<br><br><i>Criteria:</i> ${esc(o.criteria).replace(/\n/g, "<br>")}` : ""}`;
    const impact = `${esc(o.risk || "").replace(/\n/g, "<br>")}<div class="rate">RATING: <span class="pill ${ck(o.criticality)}">${esc(o.criticality).toUpperCase()}</span></div>`;
    const remed =
      `${esc(o.managementResponse || "").replace(/\n/g, "<br>") || "<i>Pending management response</i>"}` +
      `<div class="rate">OWNER: ${esc((o.owner || "—").toUpperCase())}</div>` +
      `<div class="meta">${[o.timeline ? "Timeline: " + esc(o.timeline) : "", ec ? "Expected close: " + fmtDate(ec) : "", age != null ? "Age: " + age + "d" : "", "Status: " + esc(o.status || "Open")].filter(Boolean).join(" · ")}</div>`;
    h += `<tr><td class="sn">${i + 1}</td><td>${desc}</td><td>${impact}</td><td>${esc(o.rootCause || "").replace(/\n/g, "<br>")}</td><td>${esc(o.recommendation || "").replace(/\n/g, "<br>")}</td><td>${remed}</td></tr>`;
  });
  return h + `</table>`;
}

export function riskGuideWord(): string {
  const rows: [string, string, string, string][] = [
    ["Critical Risk", "(Requires immediate remediation)", "Deficiencies that contravene the Corporation's zero risk-tolerance indicators and risk appetite statement. Any auditable unit in breach is automatically assigned an adverse opinion. Where numerous high-risk observations within a unit lead to a negative composite score, that unit is assigned critical risk and an adverse opinion is expressed.", "Critical"],
    ["High Risk", "(Requires immediate remediation)", "Significant vulnerabilities with potentially severe consequences if unaddressed (major control failures, regulatory breaches, critical weaknesses). Require immediate action and close monitoring by executive management and the Board Audit Committee.", "High"],
    ["Moderate Risk", "(Short-term remediation, 1–3 months)", "Notable weaknesses causing inefficiencies and moderate financial or reputational harm if unresolved (e.g. incomplete process documentation, gaps in segregation of duties). Timely corrective actions prevent escalation.", "Moderate"],
    ["Low Risk", "(Medium-term remediation, 4–6 months)", "Minor control weaknesses or process deviations with minimal operational impact (e.g. minor record-keeping errors, outdated procedural documentation). Manageable through routine improvements.", "Low"],
    ["Process Improvement", "(Flexible implementation)", "Opportunities to boost efficiency and best practice without being risks. Recommendations focus on optimising workflows and resource utilisation for better outcomes.", "Improve"],
  ];
  return (
    `<table><tr><th style="width:130pt">Rating</th><th>Definition</th></tr>` +
    rows.map(([t, sub, def, cls]) => `<tr><td><span class="pill ${cls}">${t}</span><div class="meta">${sub}</div></td><td>${def}</td></tr>`).join("") +
    `</table>`
  );
}

export function sopUpdatesWord(obs: Observation[]): string {
  const s = obs.filter((o) => (o.sopUpdate || "").trim());
  if (!s.length) return `<div>No proposed SOP updates recorded.</div>`;
  return `<table><tr><th>#</th><th>Ref</th><th>Observation</th><th>Rating</th><th>Proposed SOP update</th></tr>${s.map((o, i) => `<tr><td>${i + 1}</td><td>${esc(o.ref || "")}</td><td><b>${esc(o.title)}</b></td><td><span class="pill ${ck(o.criticality)}">${o.criticality}</span></td><td>${esc(o.sopUpdate).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`;
}

/* Highlights of Strengths (section 1.2 of the house report format). Two feeds:
   the report's write-in `strengths` bullets, plus every audit-plan test that PASSED —
   a control tested and found working is a strength the report should credit, not silence. */
export function strengthsWord(a: Audit, r: Report): string {
  const passed = (((a.plan || {}) as AuditPlan).tests || []).filter((t) => t.result === "Passed");
  if (!r.strengths && !passed.length) return "";
  const bullets = passed
    .map((t) => {
      const title = testTitle(t) || testControl(t) || "Control tested";
      const detail =
        testResultNotes(t) ||
        (testControl(t) && testControl(t) !== title ? testControl(t) : "") ||
        "Tested and found operating effectively; no exceptions noted.";
      return `<li><b>${esc(title)}:</b> ${esc(detail).replace(/\n/g, "<br>")}</li>`;
    })
    .join("");
  return `<h2>1.2 Highlights of Strengths</h2>
    <div>During the review, we observed achievements and strengths demonstrating management's commitment to sound practices. Notable mentions include:</div>
    ${wbul(r.strengths)}
    ${bullets ? `<ul>${bullets}</ul>` : ""}`;
}

export function reportWordInner(db: WorkspaceDb, a: Audit, r: Report): string {
  const obs = (r.observations || []).slice().sort((x, y) => CRITS.indexOf(x.criticality) - CRITS.indexOf(y.criticality));
  const c = zc();
  obs.forEach((o) => c[o.criticality]++);
  const open = obs.filter((o) => o.status !== "Closed").length;
  const overall = worstCrit(c, obs.length);
  const name = db.signOffName || "Awa Michael", title = db.signOffTitle || "Head, Internal Audit";
  const conf = `<b>Copyright and Confidentiality.</b> All policies, procedures, departmental processes and work instructions of the ${esc(db.org)} are the sole property of the Corporation and are classified as proprietary. They may not be reproduced, copied, loaned or disclosed to any external party without the prior express written approval of the Managing Director/Chief Executive Officer or an expressly delegated authority. Unauthorised use, disclosure or duplication is strictly prohibited.`;
  return `
    <div class="cover">
      <div class="org">${esc(db.org)}</div>
      <div class="t1">${esc(a.name || r.title).toUpperCase()}</div>
      <div class="t2">${esc(r.period ? r.period + " " : "")}INTERNAL AUDIT REPORT</div>
      ${r.reportDate ? `<div class="dt">DATE: ${esc(r.reportDate)}</div>` : ""}
      ${r.refNo ? `<div class="meta">Ref: ${esc(r.refNo)} · Status: ${esc(r.status || "Draft")}</div>` : `<div class="meta">Status: ${esc(r.status || "Draft")}</div>`}
    </div>
    ${r.distribution ? `<h3>Distribution</h3><div>This Internal Audit Report shall be distributed to the following persons/committees:</div>${wbul(r.distribution as string)}` : ""}
    <div class="conf">${conf}</div>
    <div style="page-break-before:always"></div>
    <h1>1. Executive Summary</h1>
    <h2>1.1 Audit Objective and Scope</h2>
    ${wpar(r.objective || r.scope) || "<div class='meta'>Not yet documented.</div>"}
    ${r.outOfScope ? `<h3>Areas Out of Scope</h3>${wbul(r.outOfScope)}` : ""}
    ${strengthsWord(a, r)}
    ${r.areasForImprovement ? `<h2>1.3 Areas for Strategic Improvement</h2>${wbul(r.areasForImprovement)}` : ""}
    <h2>1.4 Internal Audit Opinion</h2>
    ${r.assuranceLevel ? `<div class="note"><b>Audit opinion: ${esc(r.assuranceLevel)}</b> is provided over the ${esc(a.name)} function.</div>` : ""}
    ${wpar(r.auditOpinion)}
    <h3>Summary of Findings</h3>
    <div class="note">This report contains <b>${obs.length}</b> observation(s): ${CRITS.filter((k) => c[k]).map((k) => `<span class="pill ${ck(k)}">${c[k]} ${k}</span>`).join(" ") || "none"}. <b>${open}</b> remain open/in-progress.${obs.filter((o) => o.isRepeat).length ? ` <b>${obs.filter((o) => o.isRepeat).length}</b> repeat finding(s).` : ""} Overall residual risk rating: <span class="pill ${ck(overall)}">${overall}</span>.</div>
    <h2>1.5 Conclusion</h2>
    ${wpar(r.conclusion)}
    <div class="sign">All observations have been discussed with the relevant process owners, and management has agreed action plans with defined implementation timelines.<br><br>Regards,<br><br><b>${esc(name)}</b><br>${esc(title)}</div>
    <div style="page-break-before:always"></div>
    <h1>2. Detailed Report</h1>
    <h2>2.1 Detailed Findings</h2>
    ${findingsTableWord(obs, r)}
    ${r.kind === "Process review report" ? `<h2>2.2 Proposed SOP Updates</h2>${sopUpdatesWord(obs)}<h2>2.3 Risk Classification Guide</h2>` : `<h2>2.2 Risk Classification Guide</h2>`}
    ${riskGuideWord()}`;
}

export function exportReportWord(db: WorkspaceDb, a: Audit, r: Report): void {
  wordDoc("Audit Report - " + r.title.replace(/[^\w \-]/g, ""), reportWordInner(db, a, r), orgLogo(db));
}

export function exportAuditWord(db: WorkspaceDb, a: Audit): void {
  let inner = `<h1>${esc(a.name)}</h1><div class="meta">${esc(db.org)} — Internal Audit · ${esc(a.type === "department" ? "Department audit" : "Process audit")}${a.area ? " · " + esc(a.area) : ""}${a.period ? " · " + esc(a.period) : ""}</div>`;
  const obs = (a.reports || []).flatMap((r) => r.observations || []);
  const c = zc();
  obs.forEach((o) => c[o.criticality]++);
  inner += `<div class="note"><b>${a.reports.length}</b> report(s), <b>${obs.length}</b> observation(s): ${CRITS.filter((k) => c[k]).map((k) => `<span class="pill ${ck(k)}">${c[k]} ${k}</span>`).join(" ") || "none"}.</div>`;
  (a.reports || []).forEach((r) => {
    inner += `<div style="page-break-before:always"></div>` + reportWordInner(db, a, r);
  });
  wordDoc("Audit File - " + a.name.replace(/[^\w \-]/g, ""), inner, orgLogo(db));
}

type Tor = {
  addressee?: string;
  date?: string;
  timing?: string;
  background?: string;
  outOfScope?: string;
  infoRequired?: string;
  reportingTo?: string;
};
export function exportTORWord(db: WorkspaceDb, a: Audit): void {
  const p = (a.plan || {}) as { scope?: string; objectives?: string[]; keyRisks?: string[] };
  const t = (a.tor || {}) as Tor;
  const name = db.signOffName || "Awa Michael", title = db.signOffTitle || "Head, Internal Audit";
  const bl = (arr: string[] | undefined) =>
    arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<div>To be confirmed during planning.</div>";
  const lb = (s: string | undefined) => {
    const i = (s || "").split("\n").map((x) => x.trim()).filter(Boolean);
    return i.length ? `<ul>${i.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  };
  let n = 0;
  const sec = () => ++n + ". ";
  const inner = `<h1>Internal Audit — Terms of Reference</h1>
    <div class="meta">${esc(db.org)} — Internal Audit${t.date ? " · " + esc(fmtDate(isoToDate(t.date))) : ""}</div>
    <table style="margin-top:10px">
      <tr><td style="width:130pt"><b>Audit</b></td><td>${esc(a.name)}</td></tr>
      <tr><td><b>Process / Department</b></td><td>${esc(a.area || "—")} (${esc(a.type === "department" ? "Department audit" : "Process audit")})</td></tr>
      <tr><td><b>Period under review</b></td><td>${esc(a.period || "—")}</td></tr>
      ${t.timing ? `<tr><td><b>Planned timing</b></td><td>${esc(t.timing)}</td></tr>` : ""}
      <tr><td><b>Lead auditor</b></td><td>${esc(a.leadAuditor || name)}</td></tr>
      ${t.addressee ? `<tr><td><b>Addressed to</b></td><td>${esc(t.addressee)}</td></tr>` : ""}
    </table>
    ${t.background ? `<h2>${sec()}Background &amp; Purpose</h2>${wpar(t.background)}` : ""}
    <h2>${sec()}Audit Objective${(p.objectives || []).length === 1 ? "" : "s"}</h2>
    ${(p.objectives || []).length ? bl(p.objectives) : wpar("To assess the adequacy and effectiveness of governance, risk management and internal controls over " + a.name + ".")}
    <h2>${sec()}Scope</h2>
    ${p.scope ? wpar(p.scope) : "<div>To be confirmed during planning.</div>"}
    ${t.outOfScope ? `<h3>Areas out of scope</h3>${lb(t.outOfScope)}` : ""}
    <h2>${sec()}Key Risks to be Assessed</h2>
    ${bl(p.keyRisks)}
    <h2>${sec()}Approach</h2>
    <div>The audit will be conducted in line with the Institute of Internal Auditors (IIA) Standards and the Corporation's internal audit methodology — comprising planning, walkthroughs, control design and operating-effectiveness testing, and discussion of findings with management before the report is finalised.</div>
    ${t.infoRequired ? `<h2>${sec()}Information &amp; Access Required</h2>${wpar(t.infoRequired)}` : ""}
    <h2>${sec()}Reporting</h2>
    <div>Observations will be discussed with the relevant process owners. A draft report will be issued for management responses, and the final report distributed to ${t.reportingTo ? esc(t.reportingTo) : "the relevant executive management and the Board Audit Committee"}.</div>
    <div class="sign" style="margin-top:14px">We would appreciate your cooperation and the availability of your team during the engagement. Please contact us with any questions regarding the scope or timing.<br><br>Regards,<br><br><b>${esc(name)}</b><br>${esc(title)}</div>`;
  wordDoc("Terms of Reference - " + String(a.name).replace(/[^\w \-]/g, ""), inner, orgLogo(db));
}
