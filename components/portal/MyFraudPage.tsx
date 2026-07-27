"use client";

// Action-Owner portal — Fraud Risk Control Tracker. React port of viewMyFraud(),
// myFraudSetStatus(), modalMyFraudUpdate() and saveMyFraudUpdate() in audit-bot.js.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { Empty, Kpi, TintPill } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { emailNotify } from "@/lib/client/notify";
import {
  ACTION_STATUS,
  fraudActionsView,
  fraudResidualBand,
  fraudRollupStatus,
  myFraudRisks,
  pushNotification,
  resolveFraudAction,
  rollupFraud,
} from "@/lib/workspace/portal";
import { BAND_HEX, fmtDateTime } from "@/lib/workspace/selectors";
import type { FraudRisk } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type DirUser = { id: string; name?: string; email?: string; role?: string };

// Legacy headUsers(): the notification fan-out targets every Head of Audit account.
async function fetchHeadUsers(): Promise<DirUser[]> {
  try {
    const res = await fetch("/api/directory");
    if (!res.ok) return [];
    const json = await res.json();
    return ((json.users || []) as DirUser[]).filter((u) => u.role === "head_of_audit");
  } catch {
    return [];
  }
}

export default function MyFraudPage() {
  usePageChrome({ title: "Fraud Risk Control Tracker" });
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();

  const risks = myFraudRisks(db, user.id);

  if (!risks.length) {
    return (
      <div className="card">
        <Empty big="⚠">
          No fraud risks assigned to you yet.
          <br />
          <br />
          When Internal Audit assigns a fraud risk to your department, its prevention actions
          appear here for you to implement and report progress on.
        </Empty>
      </div>
    );
  }

  const acts = risks.flatMap((f) => fraudActionsView(f).map((a) => ({ f, a })));
  const impl = acts.filter((x) => x.a.status === "Implemented").length;
  const unmit = acts.length - impl;
  const hiRes = risks.filter((f) => {
    const res = fraudResidualBand(f);
    return res === "Extreme" || res === "High";
  }).length;

  // Port of myFraudSetStatus(): apply the status immediately, then fan out the in-app
  // notification to the heads (directory fetched outside mutate — never read db across an await).
  async function setStatus(fid: string, aid: string, v: string) {
    let scheme = "";
    let applied = false;
    mutate((d) => {
      const f = (d.fraudRisks || []).find((x) => x.id === fid);
      const a = f ? resolveFraudAction(f, aid) : undefined;
      if (!f || !a) return;
      a.status = v;
      rollupFraud(f);
      scheme = f.scheme;
      applied = true;
    });
    if (!applied) return;
    logAudit("fraud.action_status_updated", "Fraud action status → " + v + " (" + scheme + ")", {
      fraudRiskId: fid,
      actionId: aid,
    });
    const heads = await fetchHeadUsers();
    if (heads.length) {
      mutate((d) => {
        heads.forEach((h) =>
          pushNotification(d, h.id, "fraud_update", `Fraud control ${v.toLowerCase()}: ${scheme}`, "fraud"),
        );
      });
    }
    toast("Status updated — Internal Audit has been notified.", "success");
  }

  function openUpdate(f: FraudRisk, aid: string) {
    modal.open(<MyFraudUpdateDialog fraudId={f.id} actionId={aid} />);
  }

  return (
    <>
      <div className="dash-kpis anim-fade-in" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <Kpi tone={hiRes ? "bad" : "good"} label="Extreme / High" value={hiRes} sub="residual fraud risks" />
        <Kpi tone="base" label="Total risks" value={risks.length} sub="assigned to you" />
        <Kpi tone={unmit ? "warn" : "good"} label="Unmitigated actions" value={unmit} sub="not yet implemented" />
        <Kpi
          tone={acts.length && impl === acts.length ? "good" : "accent"}
          label="Implemented"
          value={impl}
          sub={"of " + acts.length + " prevention actions"}
        />
      </div>
      {risks.map((f) => {
        const res = fraudResidualBand(f);
        const A = fraudActionsView(f);
        return (
          <div className="card anim-fade-in" key={f.id}>
            <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="seclabel" style={{ margin: 0 }}>{f.scheme}</div>
              <TintPill hex={BAND_HEX[res]} bold>{res} residual</TintPill>
              {f.category ? <span className="tag">{f.category}</span> : null}
              <div className="spacer" />
              <span className="hint">{fraudRollupStatus(f)}</span>
            </div>
            {A.length ? (
              <table style={{ marginTop: 10 }}>
                <thead>
                  <tr>
                    <th>Prevention / response action</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th style={{ width: 150 }}>Status</th>
                    <th>Latest update</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {A.map((a) => {
                    const last = (a.ownerUpdates || [])[0];
                    return (
                      <tr key={a.id}>
                        <td>{a.text}</td>
                        <td><span className="tag">{a.type || "—"}</span></td>
                        <td>{a.targetDate || "—"}</td>
                        <td>
                          <select
                            className="field-select field-select-sm"
                            value={a.status || "Planned"}
                            onChange={(e) => void setStatus(f.id, a.id, e.target.value)}
                          >
                            {ACTION_STATUS.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="hint">
                          {last ? (
                            <>
                              {last.text}
                              <div style={{ marginTop: 2 }}>
                                {last.byName || ""} · {fmtDateTime(last.at)}
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="ra-actions-cell">
                          <button className="btn sec sm" type="button" onClick={() => openUpdate(f, a.id)}>
                            + Update
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="hint" style={{ marginTop: 8 }}>
                No prevention actions defined for this risk yet.
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- implementation-update dialog (modalMyFraudUpdate) ---------------- */

function MyFraudUpdateDialog({ fraudId, actionId }: { fraudId: string; actionId: string }) {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();

  const f = (db.fraudRisks || []).find((x) => x.id === fraudId);
  const a = f ? fraudActionsView(f).find((x) => x.id === actionId) : undefined;

  const [status, setStatus] = useState<string>(a?.status || "Planned");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  if (!f || !a) return null;

  async function post() {
    const t = text.trim();
    if (!t) {
      setErr("Describe the implementation progress before posting.");
      return;
    }
    setErr("");
    const heads = await fetchHeadUsers();
    let scheme = "";
    let actionText = "";
    let finalStatus = "";
    let applied = false;
    mutate((d) => {
      const rf = (d.fraudRisks || []).find((x) => x.id === fraudId);
      const ra = rf ? resolveFraudAction(rf, actionId) : undefined;
      if (!rf || !ra) return;
      ra.status = status || ra.status;
      ra.ownerUpdates = ra.ownerUpdates || [];
      ra.ownerUpdates.unshift({
        at: new Date().toISOString(),
        by: user.id || "",
        byName: user.name || "",
        text: t,
        status: ra.status,
      });
      ra.update = t; // surfaces on the Fraud Prevention Plan table for Internal Audit
      rollupFraud(rf);
      scheme = rf.scheme;
      actionText = ra.text;
      finalStatus = String(ra.status || "");
      heads.forEach((h) =>
        pushNotification(d, h.id, "fraud_update", `Fraud control update: ${rf.scheme}`, "fraud"),
      );
      applied = true;
    });
    if (!applied) {
      modal.close();
      return;
    }
    logAudit("fraud.action_update", "Implementation update on fraud action (" + scheme + ")", {
      fraudRiskId: fraudId,
      actionId,
    });
    heads.forEach((h) => {
      if (h.email)
        emailNotify(
          [h.email],
          "AuditLens — fraud control update",
          `${user.name || "The action owner"} posted an implementation update on the fraud risk "${scheme}".\n\nAction: ${actionText}\nStatus: ${finalStatus}\n\nUpdate: ${t}\n\nSign in to AuditLens to review.`,
        );
    });
    modal.close();
    toast("Update posted — Internal Audit has been notified.", "success");
  }

  return (
    <ModalFrame
      title="Implementation update"
      footer={
        <>
          <button className="btn sec" type="button" onClick={() => modal.close()}>
            Cancel
          </button>
          <BusyButton className="btn" onClick={post}>
            Post update
          </BusyButton>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>{a.text}</b>
        <div className="hint" style={{ marginTop: 4 }}>Fraud risk: {f.scheme}</div>
      </div>
      <label>Status</label>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        {ACTION_STATUS.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <label>What has been done / current progress *</label>
      <textarea
        style={{ minHeight: 110 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Describe concretely what has been implemented, current progress, and what remains…"
      />
      <div style={{ marginTop: 8 }}>
        {err ? <div className="ai-err">{err}</div> : null}
      </div>
    </ModalFrame>
  );
}
