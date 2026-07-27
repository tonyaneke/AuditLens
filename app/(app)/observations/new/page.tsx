"use client";

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import RaiseFlow from "@/components/obs/RaiseFlow";
import type { Observation } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function NewObservationPage() {
  const { db } = useWorkspace();
  const audits = db.audits || [];

  const [auditId, setAuditId] = useState(audits[0]?.id || "");
  const selectedAudit = audits.find((a) => a.id === auditId);
  const reports = selectedAudit?.reports || [];
  const [reportId, setReportId] = useState(reports[0]?.id || "");

  usePageChrome({ title: "Raise Observation" });

  const emptyDraft: Observation = {
    id: "",
    title: "",
    description: "",
    criticality: "Moderate",
    status: "Open",
  };

  return (
    <div className="card" style={{ maxWidth: 600, margin: "0 auto" }}>
      <label>Select Audit Engagement *</label>
      <select
        value={auditId}
        onChange={(e) => {
          const id = e.target.value;
          setAuditId(id);
          const a = audits.find((x) => x.id === id);
          setReportId(a?.reports?.[0]?.id || "");
        }}
        style={{ marginBottom: 16 }}
      >
        <option value="">Select audit...</option>
        {audits.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <label>Select Report *</label>
      <select
        value={reportId}
        onChange={(e) => setReportId(e.target.value)}
        style={{ marginBottom: 20 }}
        disabled={!auditId || !reports.length}
      >
        <option value="">Select report...</option>
        {reports.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title} ({r.refNo || "Draft"})
          </option>
        ))}
      </select>

      {auditId && reportId ? (
        <RaiseFlow auditId={auditId} reportId={reportId} draft={emptyDraft} />
      ) : (
        <div className="hint" style={{ textAlign: "center", padding: 20 }}>
          {!audits.length ? (
            <>
              No audit engagements exist yet. <Link href="/audits/new">Create an audit first</Link>.
            </>
          ) : (
            "Select an audit engagement and report above to proceed."
          )}
        </div>
      )}
    </div>
  );
}
