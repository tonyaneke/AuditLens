"use client";

/* The "Improvement Tracker" tab — port of the prototype's iasaTracker() (QAIP tracker).
   Every standard with an improvement action recorded on the Assessment tab appears here to be
   tracked to completion: status, owner, target, latest progress — the evidence the function can
   show the Board Audit Committee that conformance gaps are actively being closed (IIA Std 12.1). */

import { useModal } from "@/components/modals/ModalProvider";
import { CommitInput, CommitTextarea } from "@/components/ui";
import {
  CONF_HEX,
  STD_ACT_HEX,
  STD_ACT_STATUS,
  applyStdStatus,
  ensureIaSaList,
  qaipStats,
  stdActOverdue,
} from "@/lib/workspace/iasa";
import type { IaSaRecord } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import IasaKpi from "./IasaKpi";
import { StandardDialog } from "./dialogs";
import { exportQAIP } from "./exports";

function clip(x: string | undefined, n: number): string {
  const s = String(x || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function TrackerPanel({ rec }: { rec: IaSaRecord }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const q = qaipStats(rec);
  const qaip = rec.qaip || {};

  function edit(fn: (r: IaSaRecord) => void) {
    mutate((d) => {
      const r = ensureIaSaList(d).find((x) => x.id === rec.id);
      if (r) fn(r);
    });
  }
  function setStatus(num: string, v: string) {
    edit((r) => {
      r.std[num] = r.std[num] || {};
      applyStdStatus(r.std[num], v);
    });
  }

  const header = (
    <div className="row" style={{ marginBottom: 12, gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <label style={{ margin: 0, fontWeight: 600, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
        Reporting period{" "}
        <CommitInput
          style={{ width: 150, padding: "6px 8px", fontWeight: 400 }}
          value={String(qaip.period || "")}
          placeholder="e.g. Q3 2026"
          onCommit={(v) => edit((r) => void (r.qaip = { ...(r.qaip || {}), period: v }))}
        />
      </label>
      <div className="spacer" style={{ flex: 1 }} />
      <button className="btn sec sm" type="button" onClick={() => exportQAIP(db, rec)}>
        ⤓ QAIP progress report (Word)
      </button>
    </div>
  );

  if (!q.total) {
    return (
      <>
        <div className="note anim-fade-in">
          The <b>Quality Improvement Programme (QAIP) tracker</b> monitors every improvement action
          arising from the self-assessment — status, owner, target and progress — so the function can{" "}
          <b>evidence that conformance gaps are actively being closed</b> (IIA Standard 12.1).
        </div>
        {header}
        <div className="card">
          <div className="empty">
            <div className="big">↗</div>
            No improvement actions to track yet. On the <b>Assessment</b> tab, open any standard rated{" "}
            <i>Partially</i> or <i>Does Not Conform</i> and record an <b>improvement action</b> — it
            appears here to track through to completion.
          </div>
        </div>
      </>
    );
  }

  const inprog = q.cnt["In progress"];
  const notstart = q.cnt["Not started"];
  const rows = q.actions
    .slice()
    .sort(
      (a, b) =>
        Number(stdActOverdue(b)) - Number(stdActOverdue(a)) ||
        STD_ACT_STATUS.indexOf((a.it.status || "Not started") as (typeof STD_ACT_STATUS)[number]) -
          STD_ACT_STATUS.indexOf((b.it.status || "Not started") as (typeof STD_ACT_STATUS)[number]),
    );

  return (
    <>
      <div className="note anim-fade-in">
        The <b>Quality Improvement Programme (QAIP) tracker</b> monitors every improvement action
        arising from the self-assessment — status, owner, target and progress — so the function can{" "}
        <b>evidence that conformance gaps are actively being closed</b> (IIA Standard 12.1). Update
        status inline below or open a standard to record progress.
      </div>
      {header}

      <div className="dash-kpis anim-fade-in" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <IasaKpi tone="base" label="Improvement actions" value={q.total} sub="From the assessment" />
        <IasaKpi tone="good" label="Implemented / closed" value={q.done} sub={q.pct + "% complete"} />
        <IasaKpi tone="mid" label="In progress" value={inprog} sub="Under way" />
        <IasaKpi tone="base" label="Not started" value={notstart} sub="Awaiting action" />
        <IasaKpi tone={q.overdue ? "bad" : "good"} label="Overdue" value={q.overdue} sub="Past target date" />
      </div>

      <div className="card anim-fade-in">
        <div className="seclabel">Overall QAIP progress</div>
        <div className="row" style={{ gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 120 }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: "#2e7d32" }}>{q.pct}%</div>
            <div className="hint">
              {q.done} of {q.total} implemented/closed
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="miniheat" style={{ height: 16 }}>
              {q.cnt["Closed"] ? <div style={{ width: (q.cnt["Closed"] / q.total) * 100 + "%", background: "#0d5a47" }} /> : null}
              {q.cnt["Implemented"] ? <div style={{ width: (q.cnt["Implemented"] / q.total) * 100 + "%", background: "#2e7d32" }} /> : null}
              {inprog ? <div style={{ width: (inprog / q.total) * 100 + "%", background: "#c9a300" }} /> : null}
              {notstart ? <div style={{ width: (notstart / q.total) * 100 + "%", background: "#cbd5e1" }} /> : null}
            </div>
            <div className="row" style={{ gap: 16, marginTop: 8, fontSize: 12, flexWrap: "wrap" }}>
              <span><b style={{ color: "#0d5a47" }}>{q.cnt["Closed"]}</b> closed</span>
              <span><b style={{ color: "#2e7d32" }}>{q.cnt["Implemented"]}</b> implemented</span>
              <span><b style={{ color: "#c9a300" }}>{inprog}</b> in progress</span>
              <span><b style={{ color: "#64748b" }}>{notstart}</b> not started</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card anim-fade-in">
        <div className="seclabel">Improvement actions — status &amp; progress</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col" style={{ width: 44 }}>Std</th>
                <th scope="col">Standard &amp; gap</th>
                <th scope="col">Improvement action</th>
                <th scope="col">Owner</th>
                <th scope="col">Target</th>
                <th scope="col" style={{ width: 130 }}>Status</th>
                <th scope="col">Latest update</th>
                <th scope="col" style={{ width: 52 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const stt = x.it.status || "Not started";
                const oc = stdActOverdue(x);
                return (
                  <tr key={x.num}>
                    <td><b>{x.num}</b></td>
                    <td>
                      <b>{x.title}</b>
                      <div className="hint" style={{ color: CONF_HEX[x.c] }}>
                        {x.c}
                        {x.it.gap ? " · " + clip(x.it.gap, 64) : ""}
                      </div>
                    </td>
                    <td>{x.it.action}</td>
                    <td>{x.it.owner || "—"}</td>
                    <td>
                      {x.it.target || "—"}
                      {oc ? <> <span className="pill c-Critical">overdue</span></> : null}
                    </td>
                    <td>
                      <select
                        className="field-select field-select-sm"
                        style={{ color: STD_ACT_HEX[stt], fontWeight: 600 }}
                        value={stt}
                        onChange={(e) => setStatus(x.num, e.target.value)}
                        aria-label={`Status for standard ${x.num}`}
                      >
                        {STD_ACT_STATUS.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      {x.it.done ? <div className="hint">done {x.it.done}</div> : null}
                    </td>
                    <td className="hint">{x.it.progress ? clip(x.it.progress, 90) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-icon-action"
                        title="Edit standard & progress"
                        aria-label={`Edit standard ${x.num}`}
                        onClick={() => modal.open(<StandardDialog rec={rec} num={x.num} />)}
                      >
                        ✎
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card anim-fade-in">
        <div className="seclabel">QAIP commentary (for the Board Audit Committee)</div>
        <CommitTextarea
          style={{ minHeight: 90, marginTop: 8 }}
          placeholder="Summary of quality-improvement progress this period — what has closed, what is in train, and any slippage..."
          value={String(qaip.commentary || "")}
          onCommit={(v) => edit((r) => void (r.qaip = { ...(r.qaip || {}), commentary: v }))}
        />
      </div>
    </>
  );
}
