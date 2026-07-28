"use client";

// "Raise Observation" as a modal (legacy modalNewObs/viewNewObs): one-liner + department +
// process/audit-area + target-report picker → AI drafts the observation → RaiseFlow
// review/assign wizard takes over.

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { generateObsDraft } from "@/lib/client/obs-ai";
import { DEPARTMENTS } from "@/lib/workspace/process";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

// Modal-only wizard — loads on first open.
const RaiseFlow = dynamic(() => import("@/components/obs/RaiseFlow"), { loading: () => null });

export default function NewObsDialog() {
  const { db } = useWorkspace();
  const modal = useModal();
  const audits = db.audits || [];
  const hasReports = audits.some((a) => (a.reports || []).length > 0);

  const [ol, setOl] = useState("");
  const [area, setArea] = useState("");
  const [ctx, setCtx] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState("");

  const defaultTarget = (() => {
    for (const a of audits) if ((a.reports || []).length) return `${a.id}|${a.reports[0].id}`;
    return "";
  })();

  async function generate() {
    if (!ol.trim()) {
      setErr("Enter your one-liner first.");
      return;
    }
    const v = target || defaultTarget;
    const [aid, rid] = v.split("|");
    if (!aid || !rid) {
      setErr("Choose a target report.");
      return;
    }
    setErr("");
    try {
      const draft = await generateObsDraft(db, ol.trim(), area, ctx.trim());
      modal.close();
      modal.open(<RaiseFlow auditId={aid} reportId={rid} draft={draft} />, { wide: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  return (
    <ModalFrame
      title="New Observation"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          {hasReports ? (
            <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
              Generate observation
            </BusyButton>
          ) : null}
        </>
      }
    >
      <label>Your one-liner observation</label>
      <input
        type="text"
        value={ol}
        onChange={(e) => setOl(e.target.value)}
        placeholder="e.g. Loan disbursements approved without evidence of credit committee sign-off"
      />
      <div className="f2">
        <div>
          <label>Department</label>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">— select department —</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {area && !DEPARTMENTS.includes(area) ? <option value={area}>{area}</option> : null}
          </select>
        </div>
        <div>
          <label>Process / audit area</label>
          <input
            type="text"
            value={ctx}
            onChange={(e) => setCtx(e.target.value)}
            placeholder="e.g. Consumer loan origination"
          />
        </div>
      </div>

      {hasReports ? (
        <>
          <label>Target report</label>
          <select value={target || defaultTarget} onChange={(e) => setTarget(e.target.value)}>
            {audits
              .filter((a) => (a.reports || []).length)
              .map((a) => (
                <optgroup key={a.id} label={a.name}>
                  {(a.reports || []).map((r) => (
                    <option key={r.id} value={`${a.id}|${r.id}`}>
                      {a.name} → {r.title}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </>
      ) : (
        <div className="hint">
          Create an audit and a report first (
          <Link href="/audits" onClick={modal.close}>
            Audits &amp; Reports
          </Link>{" "}
          → New Audit).
        </div>
      )}

      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}
