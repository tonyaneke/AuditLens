"use client";

// Word export for a process & control effectiveness review (port of exportProc in audit-bot.js).

import { esc, wordDoc } from "@/lib/client/exports";
import { PROC_CATS } from "@/lib/workspace/process";
import type { ProcessReview, WorkspaceDb } from "@/lib/workspace/types";

export function exportProc(db: WorkspaceDb, p: ProcessReview): void {
  const f = p.findings || [];
  let inner = `<h1>Process &amp; Control Effectiveness Review</h1><div class="meta">${esc(db.org)} — Internal Audit · ${esc(p.unit || "")}${p.sopTitle ? " · " + esc(p.sopTitle) : ""}${p.period ? " · " + esc(p.period) : ""}</div>
    <div class="note">Overall process effectiveness rating: <b>${esc(p.overallRating || "—")}</b></div>
    ${p.summary ? `<h2>Summary</h2><div>${esc(p.summary).replace(/\n/g, "<br>")}</div>` : ""}
    <h2>Findings</h2>`;
  if (!f.length) inner += `<div>No findings recorded.</div>`;
  else
    PROC_CATS.forEach(([cat]) => {
      const items = f.filter((x) => x.category === cat);
      if (!items.length) return;
      inner += `<h3>${cat} (${items.length})</h3><table><tr><th>Finding</th><th>Severity</th><th>Detail</th><th>Recommendation</th></tr>${items
        .map(
          (x) =>
            `<tr><td><b>${esc(x.title)}</b></td><td>${esc(cat === "Strength" ? "—" : x.severity || "")}</td><td>${esc(x.detail || "").replace(/\n/g, "<br>")}</td><td>${esc(x.recommendation || "").replace(/\n/g, "<br>")}</td></tr>`,
        )
        .join("")}</table>`;
    });
  if ((p.keyRecommendations || []).length)
    inner += `<h2>Key Recommendations</h2><ul>${p.keyRecommendations!.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
  if (p.proposedSummary || (p.proposedSteps || []).length) {
    inner += `<h2>Proposed Updated Process</h2>${p.proposedSummary ? `<div>${esc(p.proposedSummary).replace(/\n/g, "<br>")}</div>` : ""}`;
    if ((p.proposedSteps || []).length) {
      inner += `<table><tr><th>#</th><th>Actor</th><th>Type</th><th>Action</th><th>Note</th></tr>${p.proposedSteps!
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td>${esc(s.actor || "")}</td><td>${esc(s.type || "")}</td><td>${esc(s.action || "")}</td><td>${esc(s.note || "")}</td></tr>`,
        )
        .join("")}</table><div class="meta">A visual process flowchart is available in the app (Process Review → Download chart).</div>`;
    }
  }
  wordDoc(
    "Process Review - " + String(p.unit || "unit").replace(/[^\w \-]/g, ""),
    inner,
    typeof db.logo === "string" ? db.logo : undefined,
  );
}
