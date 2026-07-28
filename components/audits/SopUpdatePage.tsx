"use client";

// Proposed SOP Update view (/audits/[audit]/reports/[report]/observations/[obs]/sop) —
// React port of viewSOPUpdate from audit-bot.js.

import { useState } from "react";
import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { toast } from "@/components/feedback/ToastHost";
import RichText from "@/components/ui/RichText";
import { runAiText } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { ck } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function SopUpdatePage({
  auditId,
  reportId,
  obsId,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
}) {
  const { db, mutate } = useWorkspace();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const o = r && (r.observations || []).find((x) => x.id === obsId);

  const [sopText, setSopText] = useState(String(o?.sopUpdate || ""));
  const [loading, setLoading] = useState(false);

  usePageChrome({
    title: "Proposed SOP Update",
    actions: a && r && o ? (
      <div style={{ display: "flex", gap: 8 }}>
        <Link href={`/audits/${a.id}/reports/${r.id}/observations/${o.id}`} className="btn sec sm">
          ← Back to Observation
        </Link>
        <button className="btn sec sm ai-generate-btn" onClick={aiGenerateSop} disabled={loading}>
          {loading ? "Generating..." : "✦ Draft with AI"}
        </button>
        <button className="btn pri sm" onClick={save}>
          Save SOP Update
        </button>
      </div>
    ) : undefined,
  });

  if (!a || !r || !o) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Observation not found</h3>
        <p className="hint">The requested observation could not be found.</p>
        <Link href="/audits" className="btn sec" style={{ marginTop: 16 }}>
          ← Back to Audits List
        </Link>
      </div>
    );
  }

  function save() {
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      const curO = curR && (curR.observations || []).find((x) => x.id === obsId);
      if (curO) {
        curO.sopUpdate = sopText.trim();
      }
    });
    logAudit("sop.updated", "Updated SOP for observation: " + (o?.title || ""));
    toast("Proposed SOP update saved", "success");
  }

  async function aiGenerateSop() {
    setLoading(true);
    try {
      const text = await runAiText(
        `Draft a clear, actionable Standard Operating Procedure (SOP) clause revision to remediate the following audit observation.\n\nObservation Title: ${o?.title || ""}\nDescription: ${String(o?.description || "")}\nRoot Cause: ${String(o?.rootCause || "")}\nRecommendation: ${String(o?.recommendation || "")}\n\nDraft the exact SOP clause text to be inserted or updated:`,
      );
      if (text) {
        setSopText(text.trim());
        toast("Drafted SOP update with AI", "success");
      }
    } catch {
      toast("AI generation failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <span className={`pill ${ck(o.criticality)}`}>{o.criticality}</span>
          <span className="tag">{r.title}</span>
        </div>
        {o.recommendation ? (
          <>
            <div className="ttl">Finding Recommendation</div>
            <div className="txt" style={{ marginBottom: 16 }}>
              <RichText text={o.recommendation} />
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <label style={{ fontSize: 15, fontWeight: 700 }}>Proposed SOP Clause Revision / Procedure Update</label>
        <p className="hint" style={{ marginTop: 2, marginBottom: 12 }}>
          Document the exact procedural change required in the departmental SOP to address the root cause and prevent recurrence.
        </p>
        <textarea
          rows={12}
          placeholder="Enter proposed SOP clause text..."
          value={sopText}
          onChange={(e) => setSopText(e.target.value)}
          style={{ width: "100%", fontFamily: "inherit" }}
        />
      </div>
    </div>
  );
}
