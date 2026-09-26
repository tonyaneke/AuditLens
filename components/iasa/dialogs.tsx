"use client";

// Self-assessment dialogs — ports of modalStd/saveStd, modalPrinc/savePrinc and
// modalIASACommentary/generateIASACommentary.

import { useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiJson } from "@/lib/client/ai";
import {
  MATURITY,
  STD_ACT_STATUS,
  STD_CONF,
  allPrinc,
  allStandards,
  applyStdStatus,
  conclusionBasis,
  conclusionToText,
  ensureIaSaList,
  eqaDue,
  findPrinc,
  iasaStats,
  overallOpinion,
  princItem,
  princMaturity,
  rollupPrinc,
  stdItem,
} from "@/lib/workspace/iasa";
import type { IaSaConclusion, IaSaRecord, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/** Locate the record being edited inside a mutate() callback. */
function recordIn(d: WorkspaceDb, id: string): IaSaRecord | undefined {
  return ensureIaSaList(d).find((x) => x.id === id);
}

export function StandardDialog({ rec, num }: { rec: IaSaRecord; num: string }) {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const s = allStandards().find((x) => x.num === num);
  const it = stdItem(rec, num);
  const [conf, setConf] = useState(it.conf || "Not rated");
  const [evidence, setEvidence] = useState(it.evidence || "");
  const [gap, setGap] = useState(it.gap || "");
  const [action, setAction] = useState(it.action || "");
  const [owner, setOwner] = useState(it.owner || "");
  const [target, setTarget] = useState(it.target || "");
  const [status, setStatus] = useState(it.status || "Not started");
  const [done, setDone] = useState(it.done || "");
  const [progress, setProgress] = useState(it.progress || "");
  if (!s) return null;

  function save() {
    mutate((d) => {
      const r = recordIn(d, rec.id);
      if (!r) return;
      const next = { conf, evidence, gap, action, owner, target, progress };
      applyStdStatus(next, status, done);
      r.std[num] = next;
    });
    modal.close();
  }

  return (
    <ModalFrame
      title={`Standard ${num} — ${s.title}`}
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
      <div className="hint" style={{ marginBottom: 8 }}>
        Principle {s.pn} · {s.pt} — Domain {s.d} · {s.dt}
      </div>
      <label>Conformance</label>
      <select value={conf} onChange={(e) => setConf(e.target.value)}>
        {STD_CONF.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <label>Evidence of conformance</label>
      <textarea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="Policies, procedures, working papers or practices demonstrating conformance with this standard..."
      />
      <label>Gap / non-conformance</label>
      <textarea
        value={gap}
        onChange={(e) => setGap(e.target.value)}
        placeholder="What is missing or only partially met against this standard's requirements..."
      />
      <label>Improvement action</label>
      <textarea
        value={action}
        onChange={(e) => setAction(e.target.value)}
        placeholder="Action to close the gap..."
      />
      <div className="f2">
        <div>
          <label>Action owner</label>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div>
          <label>Target date</label>
          <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
        <div className="hint" style={{ marginBottom: 6 }}>Improvement tracking (QAIP)</div>
        <div className="f2">
          <div>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STD_ACT_STATUS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Completion date</label>
            <input type="date" value={done} onChange={(e) => setDone(e.target.value)} />
          </div>
        </div>
        <label>Progress update</label>
        <textarea
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
          placeholder="Latest progress on this improvement action (dated notes build the audit trail)..."
        />
      </div>
    </ModalFrame>
  );
}

export function PrincipleDialog({ rec, pn }: { rec: IaSaRecord; pn: number }) {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const p = findPrinc(pn);
  const it = princItem(rec, pn);
  const [maturity, setMaturity] = useState(Number(it.maturity) || 0);
  const [notes, setNotes] = useState(it.notes || "");
  const [action, setAction] = useState(it.action || "");
  if (!p) return null;

  function save() {
    mutate((d) => {
      const r = recordIn(d, rec.id);
      if (!r) return;
      r.items[pn] = { ...(r.items[pn] || {}), maturity, notes, action };
    });
    modal.close();
  }

  return (
    <ModalFrame
      title={`Principle ${pn} — ${p.t}`}
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
      <div className="hint" style={{ marginBottom: 8 }}>
        Domain {p.d} · {p.dt} — rolled-up conformance <b>{rollupPrinc(rec, pn)}</b> (derived from{" "}
        {p.s.length} standards). Rate individual standards on the assessment table.
      </div>
      <label>Maturity (1–5)</label>
      <select value={maturity} onChange={(e) => setMaturity(+e.target.value)}>
        {MATURITY.map((m, i) => (
          <option key={m} value={i}>
            {m}
          </option>
        ))}
      </select>
      <label>Principle-level commentary</label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label>Key improvement action</label>
      <textarea value={action} onChange={(e) => setAction(e.target.value)} />
    </ModalFrame>
  );
}

/* The conclusion has to be drawn from what the team actually recorded. This prompt used to send
   only each principle's legacy `conformance` field — superseded by the rollup from standard-level
   ratings, so it read "Not rated" on every current assessment — plus maturity, and nothing else:
   no standard ratings, evidence, gaps, actions or EQA history. The AI was writing a conclusion
   for an assessment it had never been shown. It now gets the same figures the Assessment tab
   displays, and every note entered against every standard and principle. */
function buildCommentaryPrompt(db: WorkspaceDb, rec: IaSaRecord): string {
  const st = iasaStats(rec);
  const eq = eqaDue(rec, db);
  const detail = allPrinc()
    .map((p) => {
      const it = princItem(rec, p.n);
      const mat = princMaturity(rec, p.n);
      const out = [
        `P${p.n} ${p.t} (Domain ${p.d} · ${p.dt}) — conformance: ${rollupPrinc(rec, p.n)}; maturity: ${mat ? MATURITY[mat] : "not rated"}`,
      ];
      if (it.notes) out.push(`  Principle commentary: ${it.notes}`);
      if (it.action) out.push(`  Key improvement action: ${it.action}`);
      for (const [num, title] of p.s) {
        const s = stdItem(rec, num);
        const parts = [`  Std ${num} ${title}: ${s.conf || "Not rated"}`];
        if (s.evidence) parts.push(`evidence: ${s.evidence}`);
        if (s.gap) parts.push(`gap: ${s.gap}`);
        if (s.action) parts.push(`improvement action: ${s.action} (status: ${s.status || "Not started"})`);
        out.push(parts.join(" | "));
      }
      return out.join("\n");
    })
    .join("\n\n");

  return `Act as an internal audit quality assessor for ${db.org || "the organisation"}. Draft the overall conclusion of the Internal Audit function's self-assessment against the IIA Global Internal Audit Standards (2024)${rec.period ? " for " + rec.period : ""}.

Ground every statement in the recorded results below. Draw strengths from the evidence recorded and priorities from the gaps and improvement actions recorded, and do not invent evidence, ratings or facts that are not shown. State the overall opinion exactly as given. If standards are still "Not rated", say the assessment is incomplete and qualify the conclusion accordingly.

Write it as flowing prose — one paragraph per field, no lists or bullet points — and return ONLY a JSON object (no commentary, no markdown fences) with these four string fields:
{
  "overview": "The overall conformance statement: the overall opinion, how many standards conform / partially conform / do not conform, how many principles generally conform, and what the average maturity says about the function (3–4 sentences).",
  "strengths": "The key strengths, drawn from the evidence recorded (3–5 sentences).",
  "priorities": "The priority improvement areas, most serious first — every standard rated Does Not Conform must be named — with the improvement actions recorded (3–6 sentences).",
  "eqa": "Whether an external quality assessment is due and when (1–3 sentences)."
}
Cite the standards and principles each point rests on inline, e.g. "(Std 7.1, 7.2)" or "(Principle 11, Std 11.4)". In each paragraph you may wrap one or two key phrases in **double asterisks** for emphasis; use no other formatting.

IA function context: ${String(rec.aiContext || "not provided")}

Summary:
- Overall opinion: ${overallOpinion(rec)}
- Standards rated: ${st.rated} of ${st.total} — Conforms ${st.cnt["Conforms"]}, Partially Conforms ${st.cnt["Partially Conforms"]}, Does Not Conform ${st.cnt["Does Not Conform"]}
- Principles (rolled up from their standards): ${st.prc["Generally Conforms"]} Generally Conform, ${st.prc["Partially Conforms"]} Partially Conform, ${st.prc["Does Not Conform"]} Do Not Conform, ${allPrinc().length - st.pRated} not rated
- Average maturity: ${st.avgMat ? st.avgMat.toFixed(1) + " / 5" : "not rated"}
- External quality assessment: last EQA ${rec.lastEQA || "not on record"}; ${eq.txt} (${eq.sub})

Recorded results by principle and standard:
${detail}`;
}

/* The AI's JSON, made safe to store: four trimmed strings. Null when there is nothing usable. */
function normConclusion(raw: unknown, basis: IaSaConclusion["basis"]): IaSaConclusion | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const c: IaSaConclusion = {
    generatedAt: new Date().toISOString(),
    basis,
    overview: str(o.overview),
    strengths: str(o.strengths),
    priorities: str(o.priorities),
    eqa: str(o.eqa),
  };
  return c.overview || c.strengths || c.priorities ? c : null;
}

export function CommentaryDialog({ rec }: { rec: IaSaRecord }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [err, setErr] = useState("");

  async function generate() {
    setErr("");
    // Read the record from the live workspace, not the copy captured when the dialog opened.
    const live = (db.iaSAList || []).find((x) => x.id === rec.id) || rec;
    const basis = conclusionBasis(live);
    let conclusion: IaSaConclusion | null;
    try {
      conclusion = normConclusion(await runAiJson(buildCommentaryPrompt(db, live)), basis);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    if (!conclusion) {
      setErr("The AI returned no usable conclusion. Please try again.");
      return;
    }
    const c = conclusion;
    mutate((d) => {
      const r = recordIn(d, rec.id);
      if (!r) return;
      r.conclusion = c;
      r.commentary = conclusionToText(c);
    });
    modal.close();
  }

  return (
    <ModalFrame
      title="Generate overall conclusion"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate conclusion
          </BusyButton>
        </>
      }
    >
      <p className="hint" style={{ margin: 0 }}>
        The AI drafts the EQA-style conclusion — the overall position, key strengths, priority
        improvement areas and the EQA position — from the ratings, evidence, gaps, improvement
        actions and maturity recorded on this assessment. It replaces the current conclusion.
      </p>
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}
