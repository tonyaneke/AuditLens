"use client";

// External-findings exports — ports of exportAllExtFindingsCsv and downloadExtTemplate from
// public/audit-bot.js. Byte-compatible with the legacy CSVs (same quoting, BOM, CRLF, names).

import { toast } from "@/components/feedback/ToastHost";
import { dl } from "@/lib/client/exports";
import { fmtDate, fmtDateTime, isoToDate } from "@/lib/workspace/selectors";
import type { WorkspaceDb } from "@/lib/workspace/types";

/** Legacy csvEsc — quotes only when the value needs it (unlike lib/client/exports.csvEsc). */
function csvEsc(v: unknown): string {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvString(headers: string[], rows: unknown[][]): string {
  return (
    [headers.map(csvEsc).join(",")].concat(rows.map((r) => r.map(csvEsc).join(","))).join("\r\n") +
    "\r\n"
  );
}
function nowStamp(): string {
  try {
    return new Date().toISOString().slice(0, 10);
  } catch {
    return "export";
  }
}

/** Full export of every external / regulatory finding with all detail fields — opens in Excel. */
export function exportAllExtFindingsCsv(db: WorkspaceDb): void {
  const F = db.extFindings || [];
  if (!F.length) {
    toast("No external findings to export.");
    return;
  }
  const headers = ["Source","Source ref","Year","Ref","Finding","Theme","Severity","Detail","Risk / Impact","Recommendation","Management response","Owner","Expected close (target)","Actual close date","Status","Repeat","Repeat of","Created"];
  const rows = F.slice()
    .sort(
      (a, b) =>
        String(b.year || "").localeCompare(String(a.year || "")) ||
        String(a.source || "").localeCompare(String(b.source || "")),
    )
    .map((f) => [
      f.source || "",
      f.sourceRef || "",
      f.year || "",
      f.ref || "",
      f.title || "",
      f.theme || "",
      f.severity || "",
      f.detail || "",
      f.risk || "",
      f.recommendation || "",
      f.managementResponse || "",
      f.owner || "",
      f.targetDate || "",
      f.closedDateISO ? fmtDate(isoToDate(f.closedDateISO)) : "",
      f.status || "Open",
      f.isRepeat ? "Yes" : "No",
      f.repeatOf || "",
      f.createdAt ? fmtDateTime(f.createdAt) : "",
    ]);
  dl(
    "﻿" + csvString(headers, rows),
    "AuditLens-external-findings-" + nowStamp() + ".csv",
    "text/csv;charset=utf-8",
  );
}

/** CSV template for the import dialog (port of downloadExtTemplate). */
export function downloadExtTemplate(): void {
  const headers = ["Source","SourceRef","Year","Ref","Title","Detail","Risk","Recommendation","Theme","Severity","Owner","TargetDate","Status","ManagementResponse","IsRepeat","RepeatOf"];
  const ex = [
    "Statutory / External Audit",
    "2024 Statutory Management Letter",
    "2024",
    "3.2",
    "Weak IT access controls over the loan management system",
    "Privileged access not periodically reviewed; leavers retained access.",
    "Unauthorised access and data integrity risk.",
    "Implement quarterly user-access reviews and prompt de-provisioning of leavers.",
    "Access & IT security",
    "High",
    "Head, IT",
    "30 Sep 2026",
    "Open",
    "No",
    "",
  ];
  dl(
    headers.join(",") + "\n" + ex.map(csvEsc).join(",") + "\n",
    "external-findings-template.csv",
    "text/csv",
  );
}
