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
import { headUsers, loadDirectory } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import {
  ACTION_STATUS,
  fraudActionsView,
  fraudResidualBand,
  fraudRollupStatus,
  myFraudActionsFor,
  myFraudRisks,
  pushNotification,
  resolveFraudAction,
  rollupFraud,
} from "@/lib/workspace/portal";
import { BAND_HEX, fmtDateTime } from "@/lib/workspace/selectors";
import type { FraudRisk } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/* Legacy headUsers(): the notification fan-out targets every Head of Audit account.
 *
 * QA-7 — this used to call fetch("/api/directory") directly, bypassing the module cache and
 * in-flight dedupe in lib/client/directory.ts, so the whole roster was re-downloaded on every
 * send. loadDirectory() populates that shared cache once; headUsers() reads it synchronously
 * and, unlike the old local filter, correctly includes admins (who act as Head of Audit). */
async function fetchHeadUsers() {
  await loadDirectory();
  return headUsers();
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

  // Only the actions this owner is responsible for: all of a risk's actions when the risk
  // itself is theirs, otherwise just the individually-assigned ones.
  const acts = risks.flatMap((f) => myFraudActionsFor(f, user.id).map((a) => ({ f, a })));
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
        const A = myFraudActionsFor(f, user.id);
        const done = A.filter((a) => a.status === "Implemented").length;
        const pct = A.length ? Math.round((done / A.length) * 100) : 0;
        return (
          <div className="card anim-fade-in mft-card" key={f.id}>
            <div className="mft-head">
              <span className="mft-scheme">{f.scheme}</span>
              <TintPill hex={BAND_HEX[res]} bold>{res} residual</TintPill>
              {f.category ? <span className="tag">{f.category}</span> : null}
              <div className="spacer" />
              {A.length ? (
                <div className="mft-progress">
                  <div className="mft-track">
                    <div className="mft-fill" style={{ width: pct + "%" }} />
                  </div>
                  <span className="mft-progress-label">
                    {done}/{A.length} implemented
                  </span>
                </div>
              ) : (
                <span className="hint">{fraudRollupStatus(f)}</span>
              )}
            </div>
            {f.description ? (
              <div className="hint" style={{ margin: "6px 0 2px", maxWidth: 760 }}>
                {String(f.description).slice(0, 220)}
                {String(f.description).length > 220 ? "…" : ""}
              </div>
            ) : null}
            {A.length ? (
              <div style={{ marginTop: 8 }}>
                {A.map((a) => {
                  const last = (a.ownerUpdates || [])[0];
                  return (
                    <div className="mft-action-row" key={a.id}>
                      <div className="mft-action-main">
                        <div className="mft-action-text">{a.text}</div>
                        <div className="mft-action-tags">
                          <span className="tag">{a.type || "Preventive"}</span>
                          {a.targetDate ? (
                            <span className="hint">🎯 Target: {a.targetDate}</span>
                          ) : null}
                        </div>
                        {last ? (
                          <div className="mft-update">
                            {last.text}
                            <div className="mft-update-meta">
                              {last.byName || ""} · {fmtDateTime(last.at)}
                            </div>
                          </div>
                        ) : (
                          <div className="mft-update" style={{ color: "#94a3b8" }}>
                            No progress update posted yet — use <b>+ Post update</b> to report
                            implementation progress.
                          </div>
                        )}
                      </div>
                      <div className="mft-action-side">
                        <select
                          className="field-select field-select-sm"
                          value={a.status || "Planned"}
                          onChange={(e) => void setStatus(f.id, a.id, e.target.value)}
                        >
                          {ACTION_STATUS.map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                        <button className="btn sm" type="button" onClick={() => openUpdate(f, a.id)}>
                          + Post update
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
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
