"use client";

// Dialogs for the fraud risk assessment — ports of modalFraud/fraudStep1Next/openFraudStep2/
// generateNewFraudActions/fraudFinishAdd/saveFraud (the two-step Add flow + Edit), modalFraudAction/
// saveFraudAction, modalFraudPrompt/generateFraudRisks/doImportFraud, modalFraudPlan,
// modalFraudUpdate/generateFraudUpdateCommentary and modalFraudDownload in audit-bot.js.

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { aiGenerate, parseAiJson, runAiJson, runAiText } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { directory, loadDirectory } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { notifyBoth } from "@/lib/workspace/observations";
import {
  ACTION_STATUS,
  ACTION_TYPES,
  CTRL_STRENGTH,
  DEPARTMENTS,
  FRAUD_CATS,
  FRAUD_STATUS,
  IMP_LABEL,
  LIKE_LABEL,
  deptByHead,
  ownerDepartments,
  ownerEmailFor,
  residualFor,
  rollupFraud,
} from "@/lib/workspace/fraud";
import {
  BAND_HEX,
  BANDS,
  fraudList,
  fraudResidual,
  hx2rgba,
  isoNow,
  uid,
} from "@/lib/workspace/selectors";
import type { FraudRisk, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { exportFraud, exportFraudPlan, exportFraudUpdate } from "./exports";

function ResidualPill({ band, bold }: { band: string; bold?: boolean }) {
  return (
    <span
      className="pill"
      style={{
        background: hx2rgba(BAND_HEX[band], 0.16),
        color: BAND_HEX[band],
        fontWeight: bold ? 700 : undefined,
      }}
    >
      {band}
    </span>
  );
}

/* ---------------- department select (legacy deptOptionsHTML) ---------------- */

function DeptSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canonical = DEPARTMENTS as readonly string[];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select department —</option>
      {canonical.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {/* Preserve a pre-existing value that isn't in the canonical list so editing never drops it. */}
      {value && !canonical.includes(value) ? <option value={value}>{value}</option> : null}
    </select>
  );
}

/* ================= add (2-step) / edit fraud risk — modalFraud ================= */

type FraudForm = {
  year: string;
  process: string;
  category: string;
  scheme: string;
  description: string;
  likelihood: number;
  impact: number;
  existingControls: string;
  controlStrength: string;
  residualOverride: string;
  ownerUserId: string;
  status: string;
};

function formFor(f: FraudRisk | undefined): FraudForm {
  return {
    year: f ? f.year || "" : String(new Date().getFullYear()),
    process: f?.process || "",
    category: f?.category || "Asset Misappropriation",
    scheme: f?.scheme || "",
    description: f?.description || "",
    likelihood: f?.likelihood || 3,
    impact: f?.impact || 3,
    existingControls: f?.existingControls || "",
    controlStrength: f?.controlStrength || "Moderate",
    residualOverride: f?.residualOverride || "",
    ownerUserId: f?.ownerUserId || "",
    status: f?.status || "Identified",
  };
}

type ActionDraft = { text: string; type: string; targetDate: string; status: string };

function buildNewFraudActionsPrompt(db: WorkspaceDb, f: FraudForm, res: string): string {
  const yr = new Date().getFullYear();
  return `Act as a fraud risk specialist for ${db.org}. Today's date is ${isoNow()} — any target dates you propose MUST be in the future (${yr} or later; never a past year). A fraud risk has just been assessed:
Scheme: ${f.scheme}
Category: ${f.category} · Department: ${f.process || "(unspecified)"}
Description: ${f.description || "(none)"}
Existing anti-fraud controls: ${f.existingControls || "(none noted)"}
Likelihood: ${f.likelihood}/5 (${LIKE_LABEL[f.likelihood]}) · Impact: ${f.impact}/5 (${IMP_LABEL[f.impact]})
Control strength: ${f.controlStrength} · Residual risk: ${res}

Based on the residual risk and existing control strength, decide whether ADDITIONAL preventive/response actions are needed. If the residual risk is Low and controls are already strong, it is acceptable to conclude that no further action is needed. Otherwise propose as many actions as the risk genuinely warrants (typically 2–4; more for High/Extreme residual) — a mix of preventive and detective controls, each specific and actionable.

Return ONLY a JSON object:
{"needed": true or false, "rationale": "one sentence explaining the decision", "actions": [ { "text": "specific action", "type": "Preventive | Detective | Corrective", "targetDate": "e.g. Q4 2026", "status": "Planned" } ]}
Use an empty actions array when needed is false.`;
}

export function FraudDialog({ fraudId }: { fraudId?: string }) {
  const { db, mutate, saveNow } = useWorkspace();
  const modal = useModal();
  const isEdit = !!fraudId;
  const existing = fraudId ? fraudList(db).find((x) => x.id === fraudId) : undefined;
  const [f, setF] = useState<FraudForm>(() => formFor(existing));
  const [step, setStep] = useState(1);
  const [acts, setActs] = useState<ActionDraft[]>([]);
  const [rationale, setRationale] = useState("");
  const [generating, setGenerating] = useState(false);
  const genSeq = useRef(0);

  const owners = ownerDepartments(db);
  const statusLocked = !!(existing?.actions && existing.actions.length);

  function set<K extends keyof FraudForm>(k: K, v: FraudForm[K]) {
    setF((cur) => ({ ...cur, [k]: v }));
  }

  /* ---- step 2: AI-proposed preventive actions (generateNewFraudActions) ---- */
  async function generate(form: FraudForm) {
    const seq = ++genSeq.current;
    setGenerating(true);
    const yr = new Date().getFullYear();
    const res = residualFor(form.likelihood, form.impact, form.controlStrength, form.residualOverride);
    try {
      const d = parseAiJson<{ needed?: boolean; rationale?: string; actions?: unknown }>(
        await aiGenerate(buildNewFraudActionsPrompt(db, form, res), "json"),
      );
      if (seq !== genSeq.current) return;
      // Never accept a target year in the past — bump stale years to the current one.
      const fixYear = (s: unknown) =>
        String(s || "").replace(/\b(20\d{2})\b/g, (m) => (+m < yr ? String(yr) : m));
      setRationale(d.rationale || "");
      const raw = d.needed === false ? [] : Array.isArray(d.actions) ? d.actions : [];
      setActs(
        raw.map((x) => {
          const a = (x || {}) as { text?: string; type?: string; targetDate?: unknown; status?: string };
          return {
            text: a.text || "",
            type: (ACTION_TYPES as readonly string[]).includes(a.type || "") ? a.type! : "Preventive",
            targetDate: fixYear(a.targetDate),
            status: (ACTION_STATUS as readonly string[]).includes(a.status || "") ? a.status! : "Planned",
          };
        }),
      );
    } catch {
      if (seq !== genSeq.current) return;
      setRationale("");
      setActs([]);
      toast("Could not auto-propose actions — add them manually or retry.", "error");
    }
    if (seq === genSeq.current) setGenerating(false);
  }

  function step1Next() {
    if (!f.scheme.trim()) {
      toast("Scheme title required", "error");
      return;
    }
    setStep(2);
    void generate(f);
  }

  /* ---- finish add (fraudFinishAdd) ---- */
  async function finishAdd() {
    const cleanActs = acts.filter((a) => a.text.trim());
    const dept = deptByHead(db, f.ownerUserId);
    const ownerName = f.ownerUserId && dept ? dept.headName || "" : "";
    const obj: FraudRisk = {
      id: uid(),
      year: f.year,
      process: f.process,
      category: f.category,
      scheme: f.scheme.trim(),
      description: f.description,
      likelihood: f.likelihood,
      impact: f.impact,
      existingControls: f.existingControls,
      controlStrength: f.controlStrength,
      residualOverride: f.residualOverride,
      owner: ownerName,
      ownerUserId: f.ownerUserId || "",
      departmentId: f.ownerUserId && dept ? dept.id : "",
      status: "Identified",
      createdAt: new Date().toISOString(),
      actions: cleanActs.map((a) => ({
        id: uid(),
        text: a.text,
        type: a.type,
        owner: "",
        targetDate: a.targetDate,
        status: a.status,
      })),
    };
    rollupFraud(obj);
    const email = ownerEmailFor(db, obj.ownerUserId);
    mutate((d) => {
      d.fraudRisks = d.fraudRisks || [];
      d.fraudRisks.push(obj);
      // Alert the assigned owner immediately (in-app + email), same as an Edit-time assignment.
      if (obj.ownerUserId) {
        d.notifications = d.notifications || [];
        d.notifications.push({
          id: uid(),
          userId: obj.ownerUserId,
          kind: "assigned",
          text: "Fraud risk assigned to you: " + obj.scheme,
          link: "myfraud",
          obsId: "",
          read: false,
          at: new Date().toISOString(),
        });
      }
    });
    logAudit(
      "fraud.risk_created",
      "Added fraud risk: " + obj.scheme + " (" + cleanActs.length + " preventive action(s))",
      { fraudRiskId: obj.id },
    );
    if (obj.ownerUserId && email) {
      emailNotify(
        [email],
        "AuditLens — fraud risk assigned",
        `You have been assigned as owner of the fraud risk "${obj.scheme}" (${cleanActs.length} preventive action(s)). Sign in to AuditLens — Fraud Risk Control Tracker — to review and report implementation progress.`,
      );
    }
    await saveNow();
    modal.close();
    modal.success(
      obj.ownerUserId ? (
        <>
          Fraud alert sent — the fraud risk was added and {obj.owner || "the action owner"} has
          been alerted by email.
        </>
      ) : (
        "Fraud alert sent — the fraud risk and its preventive actions are now in the register (unassigned). Assign an action owner from Edit when ready."
      ),
      "Fraud alert sent",
    );
  }

  /* ---- edit save (saveFraud) ---- */
  function saveEdit() {
    const scheme = f.scheme.trim();
    if (!scheme) {
      toast("Scheme title required");
      return;
    }
    const prev = (fraudId && fraudList(db).find((x) => x.id === fraudId)) || ({} as FraudRisk);
    const prevOwnerUserId = prev.ownerUserId || "";
    // Resolve the assigned action owner from the department model (headUserId → head name).
    const ownerId = f.ownerUserId;
    const dept = deptByHead(db, ownerId);
    let ownerUserId = "";
    let ownerName = "";
    let departmentId = "";
    if (ownerId) {
      ownerUserId = ownerId;
      ownerName = dept ? dept.headName || "" : "";
      departmentId = dept ? dept.id : "";
    } else if (!prev.ownerUserId) {
      // preserve a legacy free-text owner
      ownerName = prev.owner || "";
      departmentId = prev.departmentId || "";
    }
    const data = {
      year: f.year,
      process: f.process,
      category: f.category,
      scheme,
      description: f.description,
      likelihood: +f.likelihood || 3,
      impact: +f.impact || 3,
      existingControls: f.existingControls,
      controlStrength: f.controlStrength,
      residualOverride: f.residualOverride,
      ownerUserId,
      owner: ownerName,
      departmentId,
      status: f.status,
    };
    const newlyAssigned = !!ownerUserId && ownerUserId !== prevOwnerUserId;
    const email = newlyAssigned ? ownerEmailFor(db, ownerUserId) : "";
    mutate((d) => {
      d.fraudRisks = d.fraudRisks || [];
      let obj = fraudId ? d.fraudRisks.find((x) => x.id === fraudId) : undefined;
      if (obj) Object.assign(obj, data);
      else {
        obj = { id: uid(), ...data, createdAt: new Date().toISOString() };
        d.fraudRisks.push(obj);
      }
      rollupFraud(obj);
      // Notify the owner on a new assignment (in-app + email).
      if (newlyAssigned) {
        d.notifications = d.notifications || [];
        d.notifications.push({
          id: uid(),
          userId: ownerUserId,
          kind: "assigned",
          text: "Fraud risk assigned to you: " + scheme,
          link: "dashboard",
          obsId: "",
          read: false,
          at: new Date().toISOString(),
        });
      }
    });
    if (newlyAssigned && email) {
      emailNotify(
        [email],
        "AuditLens — fraud risk assigned",
        `You have been assigned as owner of the fraud risk "${scheme}". Sign in to AuditLens for details, or contact Internal Audit.`,
      );
    }
    modal.close();
  }

  /* ---- step 2 body ---- */
  if (!isEdit && step === 2) {
    const res = residualFor(f.likelihood, f.impact, f.controlStrength, f.residualOverride);
    return (
      <ModalFrame
        title="Add fraud risk — step 2 of 2: preventive actions"
        footer={
          <>
            <button className="btn sec" type="button" onClick={() => setStep(1)}>
              ← Back
            </button>
            <BusyButton className="btn" busyLabel="Adding…" disabled={generating} onClick={finishAdd}>
              Add fraud
            </BusyButton>
          </>
        }
      >
        <div className="note" style={{ marginBottom: 10 }}>
          <b>{f.scheme}</b> · residual <ResidualPill band={res} bold />{" "}
          <span className="hint">
            (likelihood {f.likelihood} × impact {f.impact}, {f.controlStrength || "—"} controls)
          </span>
        </div>
        {generating ? (
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 4px" }}>
            <span className="btn-spin" aria-hidden="true" /> Analysing likelihood, impact and
            control strength — proposing preventive actions…
          </div>
        ) : (
          <>
            {rationale ? (
              <div className="hint" style={{ marginBottom: 10 }}>
                ✦ {rationale}
              </div>
            ) : null}
            {acts.length ? (
              acts.map((a, i) => (
                <div className="obs-block" key={i} style={{ padding: "10px 12px", marginBottom: 10 }}>
                  <label>Prevention / response action</label>
                  <textarea
                    style={{ minHeight: 48 }}
                    value={a.text}
                    onChange={(e) =>
                      setActs((cur) => cur.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                    }
                  />
                  <div className="f3" style={{ marginTop: 6 }}>
                    <div>
                      <label>Control type</label>
                      <select
                        value={a.type}
                        onChange={(e) =>
                          setActs((cur) => cur.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))
                        }
                      >
                        {ACTION_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>Target date</label>
                      <input
                        value={a.targetDate}
                        placeholder="e.g. Q4 2026"
                        onChange={(e) =>
                          setActs((cur) =>
                            cur.map((x, j) => (j === i ? { ...x, targetDate: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label>Status</label>
                      <select
                        value={a.status}
                        onChange={(e) =>
                          setActs((cur) => cur.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))
                        }
                      >
                        {ACTION_STATUS.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <div className="spacer" />
                    <button
                      className="btn ghost sm danger"
                      type="button"
                      onClick={() => setActs((cur) => cur.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="note" style={{ marginBottom: 10 }}>
                <b>No preventive action needed.</b>
                <div className="hint" style={{ marginTop: 4 }}>
                  {rationale || "The residual risk is acceptably low given existing controls."} You
                  can still add actions manually below.
                </div>
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn sec sm"
                type="button"
                onClick={() =>
                  setActs((cur) => [
                    ...cur.filter((a) => a.text),
                    { text: "", type: "Preventive", targetDate: "", status: "Planned" },
                  ])
                }
              >
                ＋ Add action
              </button>
              <button
                className="btn ghost sm ai-generate-btn"
                type="button"
                onClick={() => void generate(f)}
              >
                ↻ Regenerate with AI
              </button>
            </div>
          </>
        )}
      </ModalFrame>
    );
  }

  /* ---- step 1 / edit form ---- */
  return (
    <ModalFrame
      title={isEdit ? "Edit fraud risk" : "Add fraud risk — step 1 of 2: risk details"}
      footer={
        isEdit ? (
          <>
            <button className="btn sec" type="button" onClick={modal.close}>
              Cancel
            </button>
            <button className="btn" type="button" onClick={saveEdit}>
              Save changes
            </button>
          </>
        ) : (
          <>
            <button className="btn sec" type="button" onClick={modal.close}>
              Cancel
            </button>
            <button className="btn ai-generate-btn" type="button" onClick={step1Next}>
              Next: Preventive actions →
            </button>
          </>
        )
      }
    >
      <div className="f3">
        <div>
          <label>Year</label>
          <input value={f.year} onChange={(e) => set("year", e.target.value)} />
        </div>
        <div>
          <label>Scheme category (ACFE)</label>
          <select value={f.category} onChange={(e) => set("category", e.target.value)}>
            {FRAUD_CATS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Department</label>
          <DeptSelect value={f.process} onChange={(v) => set("process", v)} />
        </div>
      </div>
      <label>Fraud scheme / risk title *</label>
      <input
        value={f.scheme}
        onChange={(e) => set("scheme", e.target.value)}
        placeholder="e.g. Collusive / ghost borrowers"
      />
      <label>Description (how the fraud could occur)</label>
      <textarea value={f.description} onChange={(e) => set("description", e.target.value)} />
      <div className="f3">
        <div>
          <label>Likelihood (1–5)</label>
          <select value={f.likelihood} onChange={(e) => set("likelihood", +e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} — {LIKE_LABEL[n]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Impact (1–5)</label>
          <select value={f.impact} onChange={(e) => set("impact", +e.target.value)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} — {IMP_LABEL[n]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Control strength</label>
          <select value={f.controlStrength} onChange={(e) => set("controlStrength", e.target.value)}>
            {CTRL_STRENGTH.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <label>Existing anti-fraud controls</label>
      <textarea value={f.existingControls} onChange={(e) => set("existingControls", e.target.value)} />
      <div className="f3" style={{ marginTop: 8 }}>
        <div>
          <label>
            Residual rating <span className="hint">(blank = auto)</span>
          </label>
          <select value={f.residualOverride} onChange={(e) => set("residualOverride", e.target.value)}>
            <option value="">Auto</option>
            {BANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label>
            Owner{" "}
            <span className="hint">{isEdit ? "(action owner)" : "(optional — notified by email)"}</span>
          </label>
          <select value={f.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
            <option value="">— select action owner —</option>
            {owners.map((d) => (
              <option key={d.id} value={d.headUserId}>
                {d.headName} · {d.name}
              </option>
            ))}
          </select>
          {!existing?.ownerUserId && existing?.owner ? (
            <div className="hint" style={{ marginTop: 3 }}>
              Currently: {existing.owner}
            </div>
          ) : null}
        </div>
        {isEdit ? (
          <div>
            <label>
              Overall status <span className="hint">(auto from actions)</span>
            </label>
            <select
              value={f.status}
              disabled={statusLocked}
              onChange={(e) => set("status", e.target.value)}
            >
              {FRAUD_STATUS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {isEdit ? null : (
        <div className="hint" style={{ marginTop: 6 }}>
          Next, preventive actions are proposed from your likelihood, impact and control-strength
          ratings. If you assign an owner, they are alerted by email once the risk is added.
        </div>
      )}
    </ModalFrame>
  );
}

/* ================= add / edit prevention action — modalFraudAction ================= */

export function FraudActionDialog({ riskId, actionId }: { riskId: string; actionId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const f = fraudList(db).find((x) => x.id === riskId);
  const existing = actionId ? f?.actions?.find((a) => a.id === actionId) : undefined;
  const [a, setA] = useState(() => ({
    text: existing?.text || "",
    type: existing?.type || "Preventive",
    owner: existing ? existing.owner || "" : f?.owner || "",
    ownerUserId: String(existing?.ownerUserId || (existing ? "" : f?.ownerUserId || "")),
    targetDate: existing?.targetDate || "",
    status: existing?.status || "Planned",
    update: existing?.update || "",
  }));
  const [dirVersion, setDirVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    loadDirectory().then(() => {
      if (!cancelled) setTimeout(() => setDirVersion((v) => v + 1), 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  void dirVersion;
  if (!f) return null;
  const res = fraudResidual(f);

  // Assignable owners = department heads with an active login (same rule as the raise flow);
  // a legacy free-text owner that matches no head stays selectable so old rows don't break.
  const dir = directory();
  const ownerDepts = (db.departments || [])
    .filter((d) => d.headUserId)
    .filter((d) => {
      const u = dir.find((x) => x.id === d.headUserId);
      return !u || u.active !== false || d.headUserId === a.ownerUserId;
    });
  const freeTextOwner =
    a.owner && !ownerDepts.some((d) => d.headName === a.owner) ? a.owner : "";

  function pickOwner(v: string) {
    if (v.startsWith("uid:")) {
      const id = v.slice(4);
      const dept = ownerDepts.find((d) => d.headUserId === id);
      setA((c) => ({ ...c, ownerUserId: id, owner: dept?.headName || "" }));
    } else {
      setA((c) => ({ ...c, ownerUserId: "", owner: v === "__free" ? freeTextOwner : "" }));
    }
  }

  function save() {
    const text = a.text.trim();
    if (!text) {
      toast("Action description required");
      return;
    }
    const prevOwnerId = String(existing?.ownerUserId || "");
    const assignedNew = !!a.ownerUserId && a.ownerUserId !== prevOwnerId;
    mutate((d) => {
      const r = (d.fraudRisks || []).find((x) => x.id === riskId);
      if (!r) return;
      r.actions = r.actions || [];
      const data = {
        text,
        type: a.type,
        owner: a.owner,
        ownerUserId: a.ownerUserId,
        targetDate: a.targetDate,
        status: a.status,
        update: a.update,
      };
      if (actionId) {
        const cur = r.actions.find((x) => x.id === actionId);
        if (cur) Object.assign(cur, data);
      } else {
        r.actions.push({ id: uid(), ...data });
      }
      rollupFraud(r);
      if (assignedNew) {
        notifyBoth(
          d,
          a.ownerUserId,
          "assigned",
          "Fraud prevention action assigned to you: " + text.slice(0, 120),
          "myfraud",
          "AuditLens — fraud prevention action assigned",
          `A fraud prevention action on the risk "${r.scheme}" has been assigned to you:\n\n"${text}"\n\nSign in to AuditLens (Fraud Risk Control Tracker) to post progress updates.`,
        );
      }
    });
    if (assignedNew)
      logAudit("fraud.action_assigned", "Assigned fraud prevention action owner: " + (a.owner || ""), {
        fraudRiskId: riskId,
        actionId: actionId || "",
      });
    modal.close();
    if (assignedNew) toast("Action saved. The owner has been notified.", "success");
  }

  return (
    <ModalFrame
      title={actionId ? "Edit prevention action" : "Add prevention action"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 12 }}>
        For fraud risk: <b>{f.scheme}</b> · residual <ResidualPill band={res} />
      </div>
      <label>Prevention / response action *</label>
      <textarea value={a.text} onChange={(e) => setA((c) => ({ ...c, text: e.target.value }))} />
      <div className="f3">
        <div>
          <label>Control type</label>
          <select value={a.type} onChange={(e) => setA((c) => ({ ...c, type: e.target.value }))}>
            {ACTION_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Owner {existing?.ownerUserId ? <span className="hint">(reassign)</span> : null}</label>
          <select
            value={a.ownerUserId ? "uid:" + a.ownerUserId : freeTextOwner ? "__free" : ""}
            onChange={(e) => pickOwner(e.target.value)}
          >
            <option value="">— select owner —</option>
            {ownerDepts.map((d) => (
              <option key={d.id} value={"uid:" + d.headUserId}>
                {d.headName} · {d.name}
              </option>
            ))}
            {freeTextOwner ? <option value="__free">{freeTextOwner} (unlinked)</option> : null}
          </select>
        </div>
        <div>
          <label>Target date</label>
          <input
            value={a.targetDate}
            placeholder="e.g. Q3 2026"
            onChange={(e) => setA((c) => ({ ...c, targetDate: e.target.value }))}
          />
        </div>
      </div>
      <label>Status</label>
      <select value={a.status} onChange={(e) => setA((c) => ({ ...c, status: e.target.value }))}>
        {ACTION_STATUS.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <label>
        Progress update{" "}
        <span className="hint">(latest status note — appears in the quarterly BAC update)</span>
      </label>
      <textarea value={a.update} onChange={(e) => setA((c) => ({ ...c, update: e.target.value }))} />
    </ModalFrame>
  );
}

/* ================= AI: generate fraud risks — modalFraudPrompt ================= */

function buildFraudPrompt(db: WorkspaceDb, proc: string, ctx: string): string {
  return `Act as a fraud risk assessment specialist for ${db.org}, following the ACFE Fraud Tree and COSO fraud risk management principles. For the process/department below, identify the key fraud risks (schemes) and assess each.

Process / Department: ${proc || "(not specified)"}
Context: ${ctx || "(none)"}

Rate inherent likelihood and impact on a 1–5 scale (1 lowest, 5 highest), assess the strength of existing anti-fraud controls, and recommend a prevention/response action. Return ONLY a JSON array (no commentary):
[
  {
    "scheme": "concise fraud scheme/risk title",
    "category": "Asset Misappropriation | Corruption | Financial Statement Fraud | Other",
    "process": "${proc || ""}",
    "description": "how the fraud could occur (the scenario)",
    "likelihood": 3,
    "impact": 4,
    "existingControls": "current anti-fraud controls, if any",
    "controlStrength": "Strong | Moderate | Weak | None",
    "preventionAction": "specific fraud prevention / response action",
    "owner": "role best placed to own the response"
  }
]
Cover the most relevant schemes for this area (for lending e.g. collusive/ghost borrowers, kickbacks on approvals, diversion of disbursements, collateral manipulation, override of credit limits, financial-statement manipulation).`;
}

type RawFraud = {
  year?: unknown;
  process?: string;
  category?: string;
  scheme?: string;
  title?: string;
  description?: string;
  likelihood?: unknown;
  impact?: unknown;
  existingControls?: string;
  controls?: string;
  controlStrength?: string;
  preventionAction?: string;
  prevention?: string;
  owner?: string;
};

export function GenerateFraudRisksDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [proc, setProc] = useState("");
  const [ctx, setCtx] = useState("");
  const [err, setErr] = useState("");

  async function generate() {
    setErr("");
    let data: unknown;
    try {
      data = await runAiJson(buildFraudPrompt(db, proc, ctx));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const arr = (Array.isArray(data) ? data : [data]) as RawFraud[];
    const rows: FraudRisk[] = [];
    arr.forEach((x) => {
      if (!x || typeof x !== "object") return;
      const cat =
        FRAUD_CATS.find((c) => c.toLowerCase() === String(x.category || "").toLowerCase()) || "Other";
      const cs =
        CTRL_STRENGTH.find((c) => c.toLowerCase() === String(x.controlStrength || "").toLowerCase()) ||
        "Moderate";
      rows.push({
        id: uid(),
        year: String(x.year || new Date().getFullYear()),
        process: x.process || "",
        category: cat,
        scheme: x.scheme || x.title || "(untitled)",
        description: x.description || "",
        likelihood: Math.min(5, Math.max(1, Math.round(Number(x.likelihood) || 3))),
        impact: Math.min(5, Math.max(1, Math.round(Number(x.impact) || 3))),
        existingControls: x.existingControls || x.controls || "",
        controlStrength: cs,
        residualOverride: "",
        preventionAction: x.preventionAction || x.prevention || "",
        owner: x.owner || "",
        status: "Identified",
        createdAt: new Date().toISOString(),
      });
    });
    if (!rows.length) {
      setErr("No fraud risks found in that JSON.");
      return;
    }
    mutate((d) => {
      d.fraudRisks = d.fraudRisks || [];
      d.fraudRisks.push(...rows);
    });
    modal.close();
  }

  return (
    <ModalFrame
      title="Generate fraud risks"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate fraud risks
          </BusyButton>
        </>
      }
    >
      <label>Department</label>
      <DeptSelect value={proc} onChange={setProc} />
      <label>Context (optional)</label>
      <textarea
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
        placeholder="e.g. manual disbursement approvals; PFIs onboarded without bureau checks"
      />
      {err ? (
        <div className="ai-err" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ================= plan overview — modalFraudPlan ================= */

export function FraudPlanDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [plan, setPlan] = useState(db.fraudPlanNarrative || "");
  return (
    <ModalFrame
      title="Fraud Prevention Plan — overview"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              mutate((d) => {
                d.fraudPlanNarrative = plan.trim();
              });
              modal.close();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <textarea style={{ minHeight: 220 }} value={plan} onChange={(e) => setPlan(e.target.value)} />
    </ModalFrame>
  );
}

/* ================= quarterly BAC update — modalFraudUpdate ================= */

function buildFraudUpdatePrompt(db: WorkspaceDb, period: string): string {
  const lines = fraudList(db)
    .map((f) => {
      const res = fraudResidual(f);
      const acts = f.actions || [];
      const done = acts.filter((a) => a.status === "Implemented").length;
      return (
        `- [${res}] ${f.scheme}: ${done}/${acts.length} actions implemented` +
        (acts.length
          ? "; " + acts.map((a) => `${a.text} (${a.status}${a.update ? ": " + a.update : ""})`).join("; ")
          : "")
      );
    })
    .join("\n");
  return `Act as a fraud risk specialist for ${db.org}. Draft a concise executive commentary (3–4 short paragraphs) for the Board Audit Committee on the implementation status of the Fraud Prevention Plan for ${period || "the reporting period"}. Cover overall progress, key actions completed, items in progress or behind schedule, residual exposure, and next steps. Return plain text only (no JSON).

Plan status:
${lines || "(no fraud risks/actions captured)"}`;
}

export function FraudUpdateDialog() {
  const { db, mutate, saveNow } = useWorkspace();
  const modal = useModal();
  const u = db.fraudUpdate || {};
  const hasRisks = fraudList(db).length > 0;
  const [period, setPeriod] = useState(u.period || "");
  const [comm, setComm] = useState(u.commentary || "");
  const [err, setErr] = useState("");

  if (!hasRisks) {
    return (
      <ModalFrame
        title="Quarterly update"
        footer={
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
        }
      >
        <p>No fraud risks/plan captured yet. Build the assessment and prevention actions first.</p>
      </ModalFrame>
    );
  }

  const persist = () =>
    mutate((d) => {
      d.fraudUpdate = { period, commentary: comm };
    });

  return (
    <ModalFrame
      title="Quarterly fraud prevention plan update (Board Audit Committee)"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
          <button className="btn" type="button" onClick={persist}>
            Save
          </button>
          <BusyButton
            className="btn dark"
            busyLabel="Exporting…"
            onClick={async () => {
              persist();
              await saveNow();
              exportFraudUpdate(db);
            }}
          >
            ⤓ Export update (Word)
          </BusyButton>
        </>
      }
    >
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
              setErr("");
              try {
                const text = await runAiText(buildFraudUpdatePrompt(db, period));
                if (text) setComm(text.trim());
              } catch (e) {
                setErr(e instanceof Error ? e.message : "AI request failed.");
              }
            }}
          >
            Generate commentary
          </BusyButton>
        </div>
      </div>
      <label>Executive commentary to the BAC</label>
      <textarea style={{ minHeight: 140 }} value={comm} onChange={(e) => setComm(e.target.value)} />
      {err ? (
        <div className="ai-err" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ================= download picker — modalFraudDownload ================= */

export function FraudDownloadDialog() {
  const { db } = useWorkspace();
  const modal = useModal();
  return (
    <ModalFrame
      title="Download"
      footer={
        <button className="btn sec" type="button" onClick={modal.close}>
          Cancel
        </button>
      }
    >
      <p className="hint">Choose a Word export:</p>
      <div className="download-choices">
        <button
          className="btn"
          type="button"
          onClick={() => {
            modal.close();
            exportFraud(db);
          }}
        >
          Fraud assessment
        </button>
        <button
          className="btn sec"
          type="button"
          onClick={() => {
            modal.close();
            exportFraudPlan(db);
          }}
        >
          Prevention plan
        </button>
      </div>
    </ModalFrame>
  );
}
