"use client";

// Word exports for the fraud risk assessment — ports of exportFraud/fraudHeatWord/
// exportFraudPlan/exportFraudUpdate in audit-bot.js.

import { toast } from "@/components/feedback/ToastHost";
import { esc, stamp, wordDoc } from "@/lib/client/exports";
import { bandRank, fraudEnriched, type FraudView } from "@/lib/workspace/fraud";
import {
  BAND_HEX,
  BANDS,
  fraudBand,
  fraudList,
  looseDate,
  today0,
} from "@/lib/workspace/selectors";
import type { FraudAction, FraudRisk, WorkspaceDb } from "@/lib/workspace/types";

// Non-mutating equivalent of migrateFraudActions() for export time (the pages run the real
// migration on mount, so this only matters for never-opened legacy data).
function effActions(f: FraudRisk): FraudAction[] {
  if (f.actions) return f.actions;
  return f.preventionAction
    ? [
        {
          id: "",
          text: f.preventionAction,
          type: "Preventive",
          owner: f.owner || "",
          targetDate: "",
          status: f.status === "Mitigated" ? "Implemented" : "Planned",
        },
      ]
    : [];
}

export function exportFraud(db: WorkspaceDb): void {
  const en = fraudEnriched(db);
  if (!en.length) {
    toast("No fraud risks to export.");
    return;
  }
  const inner = `<h1>Fraud Risk Assessment</h1><div class="meta">${esc(db.org)} — Internal Audit · Annual fraud risk assessment · ${en.length} risk(s)</div>
    <div class="note">Conducted in line with the ACFE Fraud Tree and COSO fraud risk management principles. Inherent risk = likelihood × impact (1–5 scale); residual risk reflects the strength of existing anti-fraud controls.</div>
    <h2>Fraud Risk Register</h2>
    <table><tr><th>Scheme</th><th>Category</th><th>Process</th><th>L</th><th>I</th><th>Inherent</th><th>Controls (strength)</th><th>Residual</th><th>Owner</th><th>Status</th></tr>
    ${en.map((f) => `<tr><td><b>${esc(f.scheme)}</b>${f.description ? `<br><span class="meta">${esc(f.description)}</span>` : ""}</td><td>${esc(f.category)}</td><td>${esc(f.process || "—")}</td><td>${f.likelihood}</td><td>${f.impact}</td><td>${f.inh}</td><td>${esc(f.existingControls || "—")} (${esc(f.controlStrength || "—")})</td><td>${f.res}</td><td>${esc(f.owner || "—")}</td><td>${esc(f.status || "Identified")}</td></tr>`).join("")}
    </table>
    <h2>Heat Map — Inherent Likelihood × Impact</h2>${fraudHeatWord(en)}`;
  wordDoc(
    "Fraud Risk Assessment " + stamp(),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}

function fraudHeatWord(en: FraudView[]): string {
  const grid: Record<string, number> = {};
  en.forEach((f) => {
    const k = f.likelihood + "-" + f.impact;
    grid[k] = (grid[k] || 0) + 1;
  });
  let h = `<table><tr><td style="border:none"></td>${[1, 2, 3, 4, 5].map((l) => `<th>L${l}</th>`).join("")}</tr>`;
  for (let imp = 5; imp >= 1; imp--) {
    h += `<tr><th>I${imp}</th>`;
    for (let lk = 1; lk <= 5; lk++) {
      const band = fraudBand(imp * lk);
      const n = grid[lk + "-" + imp] || 0;
      h += `<td style="background:${BAND_HEX[band]};color:#fff;text-align:center;font-weight:bold">${n || ""}</td>`;
    }
    h += `</tr>`;
  }
  return h + `</table>`;
}

export function exportFraudPlan(db: WorkspaceDb): void {
  if (!fraudList(db).length) {
    toast("No fraud risks — build the assessment first.");
    return;
  }
  const en = fraudEnriched(db).sort((a, b) => bandRank(b.res) - bandRank(a.res));
  const totA = en.reduce((s, f) => s + effActions(f).length, 0);
  const implA = en.reduce(
    (s, f) => s + effActions(f).filter((a) => a.status === "Implemented").length,
    0,
  );
  const inner = `<h1>Fraud Prevention Plan</h1><div class="meta">${esc(db.org)} — Internal Audit · derived from the annual Fraud Risk Assessment</div>
    ${db.fraudPlanNarrative ? `<h2>Overview</h2><div>${esc(db.fraudPlanNarrative).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="note">${totA} prevention action(s) across ${en.length} fraud risk(s); ${implA} implemented. Actions are prioritised by residual risk.</div>
    <h2>Prevention &amp; Response Actions</h2>
    <table><tr><th>Residual</th><th>Fraud risk</th><th>Category</th><th>Prevention / response action</th><th>Type</th><th>Owner</th><th>Target</th><th>Status</th></tr>
    ${en
      .flatMap((f) => {
        const acts: FraudAction[] = effActions(f).length
          ? effActions(f)
          : [{ id: "", text: "(no action defined yet)", type: "", owner: f.owner || "", targetDate: "", status: "" }];
        return acts.map(
          (a, i) =>
            `<tr><td>${i === 0 ? f.res : ""}</td><td>${i === 0 ? "<b>" + esc(f.scheme) + "</b>" : ""}</td><td>${i === 0 ? esc(f.category) : ""}</td><td>${esc(a.text)}</td><td>${esc(a.type || "")}</td><td>${esc(a.owner || "—")}</td><td>${esc(a.targetDate || "")}</td><td>${esc(a.status || "")}</td></tr>`,
        );
      })
      .join("")}
    </table>`;
  wordDoc(
    "Fraud Prevention Plan " + stamp(),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}

export function exportFraudUpdate(db: WorkspaceDb): void {
  if (!fraudList(db).length) {
    toast("No fraud risks/plan to report on.");
    return;
  }
  const u = db.fraudUpdate || {};
  const en = fraudEnriched(db).sort((a, b) => bandRank(b.res) - bandRank(a.res));
  const allA = en.flatMap((f) => effActions(f).map((a) => ({ a, f })));
  const tot = allA.length;
  const impl = allA.filter((x) => x.a.status === "Implemented").length;
  const prog = allA.filter((x) => x.a.status === "In Progress").length;
  const plan = allA.filter((x) => x.a.status === "Planned").length;
  const today = today0();
  const overdue = allA.filter((x) => {
    const d = looseDate(x.a.targetDate);
    return x.a.status !== "Implemented" && d && d < today;
  }).length;
  const pct = tot ? Math.round((impl / tot) * 100) : 0;
  const resCount: Record<string, number> = {};
  BANDS.forEach((b) => (resCount[b] = 0));
  en.forEach((f) => resCount[f.res]++);
  const bandCls = (b: string) =>
    b === "Extreme" || b === "High" ? "Critical" : b === "Medium" ? "Moderate" : "Low";
  const inner = `<h1>Fraud Prevention Plan — Quarterly Implementation Update</h1>
    <div class="meta">${esc(db.org)} — Internal Audit · Report to the Board Audit Committee${u.period ? " · " + esc(u.period) : ""}</div>
    <div class="note">Implementation progress: <b>${impl}/${tot}</b> action(s) implemented (<b>${pct}%</b>) · ${prog} in progress · ${plan} planned · <b>${overdue}</b> overdue. Residual exposure: ${[...BANDS].reverse().map((b) => `<span class="pill ${bandCls(b)}">${resCount[b]} ${b}</span>`).join(" ")}.</div>
    ${u.commentary ? `<h2>Executive Commentary</h2><div>${esc(u.commentary).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Implementation Status by Fraud Risk</h2>
    <table><tr><th>Residual</th><th>Fraud risk</th><th>Prevention / response action</th><th>Owner</th><th>Target</th><th>Status</th><th>Progress update</th></tr>
    ${en
      .flatMap((f) => {
        const acts: FraudAction[] = effActions(f).length
          ? effActions(f)
          : [{ id: "", text: "(no action defined yet)", owner: "", targetDate: "", status: "", update: "" }];
        return acts.map((a, i) => {
          const d = looseDate(a.targetDate);
          const od = a.status !== "Implemented" && d && d < today;
          return `<tr><td>${i === 0 ? f.res : ""}</td><td>${i === 0 ? "<b>" + esc(f.scheme) + "</b>" : ""}</td><td>${esc(a.text)}</td><td>${esc(a.owner || "—")}</td><td>${esc(a.targetDate || "")}${od ? " (overdue)" : ""}</td><td>${esc(a.status || "")}</td><td>${esc(a.update || "")}</td></tr>`;
        });
      })
      .join("")}
    </table>`;
  wordDoc(
    "Fraud Prevention Plan Update" + (u.period ? " - " + String(u.period).replace(/[^\w \-]/g, "") : ""),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}
