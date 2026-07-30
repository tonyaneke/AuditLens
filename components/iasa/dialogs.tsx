"use client";

// Self-assessment dialogs — ports of modalStd/saveStd, modalPrinc/savePrinc and
// modalIASACommentary/generateIASACommentary.

import { useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiText } from "@/lib/client/ai";
import {
  MATURITY,
  STD_ACT_STATUS,
  STD_CONF,
  allPrinc,
  allStandards,
  applyStdStatus,
  ensureIaSaList,
  findPrinc,
  princItem,
  rollupPrinc,
  stdItem,
} from "@/lib/workspace/iasa";
import type { IaSaRecord, WorkspaceDb } from "@/lib/workspace/types";
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

function buildCommentaryPrompt(db: WorkspaceDb, rec: IaSaRecord): string {
  const lines = allPrinc()
    .map((p) => {
      const it = princItem(rec, p.n);
      return `P${p.n} ${p.t}: ${it.conformance || "Not rated"}, maturity ${it.maturity || "—"}`;
    })
    .join("\n");
  return `Act as an internal audit quality assessor for ${db.org}. Based on the self-assessment results below against the IIA Global Internal Audit Standards (2024), draft a concise overall conclusion (3–4 short paragraphs) covering: the overall conformance statement, the function's maturity, key strengths, priority improvement areas, and whether an external quality assessment (EQA) is due. Return plain text only (no JSON).

Results:
${lines}`;
}

export function CommentaryDialog({ rec }: { rec: IaSaRecord }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [err, setErr] = useState("");

  async function generate() {
    setErr("");
    let text: string;
    try {
      text = await runAiText(buildCommentaryPrompt(db, rec));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    mutate((d) => {
      const r = recordIn(d, rec.id);
      if (r) r.commentary = text.trim();
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
        Drafts the EQA-style opinion statement from the ratings and maturity recorded on this
        assessment.
      </p>
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}
