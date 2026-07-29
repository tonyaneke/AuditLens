"use client";

// The "Assessment" tab — port of iasaAssessment(): KPI strip, the 52 standards grouped by
// domain & principle, the principle rollup table, and the overall-conclusion card.

import { useModal } from "@/components/modals/ModalProvider";
import { CommitTextarea, RowOpen } from "@/components/ui";
import {
  CONF_HEX,
  GIAS,
  MATURITY,
  STD_CONF,
  allPrinc,
  ensureIaSaList,
  eqaDue,
  iasaStats,
  opTone,
  overallOpinion,
  princItem,
  princMaturity,
  rollupPrinc,
  stdItem,
} from "@/lib/workspace/iasa";
import type { IaSaRecord } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import IasaKpi from "./IasaKpi";
import { CommentaryDialog, PrincipleDialog, StandardDialog } from "./dialogs";

export default function AssessmentPanel({ rec }: { rec: IaSaRecord }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const st = iasaStats(rec);
  const op = overallOpinion(rec);
  const eq = eqaDue(rec, db);

  function edit(fn: (r: IaSaRecord) => void) {
    mutate((d) => {
      const r = ensureIaSaList(d).find((x) => x.id === rec.id);
      if (r) fn(r);
    });
  }

  return (
    <>
      <div className="dash-kpis iasa-kpis anim-fade-in">
        <IasaKpi tone={opTone(op)} label="Overall opinion" value={op} sub="Function-level rollup" />
        <IasaKpi
          tone="good"
          label="Standards conform"
          value={st.cnt["Conforms"] + "/" + st.total}
          sub={st.rated + " of 52 rated"}
        />
        <IasaKpi
          tone="accent"
          label="Principles GC"
          value={st.prc["Generally Conforms"] + "/15"}
          sub="Generally conform"
        />
        <IasaKpi
          tone="base"
          label="Avg maturity"
          value={st.avgMat ? st.avgMat.toFixed(1) + " / 5" : "—"}
          sub="Across principles"
        />
        <IasaKpi tone={eq.tone} label="External QA" value={eq.txt} sub={eq.sub} />
      </div>

      <div className="seclabel anim-fade-in" style={{ margin: "18px 0 10px", fontSize: 15 }}>
        Assessment by Standard
      </div>

      {GIAS.map((g) => (
        <div className="card iasa-domain-card anim-fade-in" key={g.d}>
          <div className="iasa-domain-head">
            <span className="iasa-domain-num">Domain {g.d}</span>
            <span className="iasa-domain-title">{g.dt}</span>
          </div>
          {g.ps.map((p) => {
            const roll = rollupPrinc(rec, p.n);
            const rc = CONF_HEX[roll] || "#94a3b8";
            return (
              <div className="iasa-principle" key={p.n}>
                <div className="iasa-principle-head">
                  <div className="iasa-principle-title">
                    <span className="iasa-principle-num">P{p.n}</span>
                    <span>{p.t}</span>
                  </div>
                  <span className="pill iasa-roll-pill" style={{ background: rc + "22", color: rc }}>
                    {roll}
                  </span>
                </div>
                <table className="iasa-std-table">
                  <thead>
                    <tr>
                      <th scope="col" className="iasa-std-num">Std</th>
                      <th scope="col">Standard</th>
                      <th scope="col" className="iasa-std-conf">Conformance</th>
                      <th scope="col">Evidence / gap / action</th>
                      <th scope="col" className="iasa-std-act"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.s.map(([num, title]) => {
                      const iu = stdItem(rec, num);
                      const c = iu.conf || "Not rated";
                      const ch = CONF_HEX[c] || "#94a3b8";
                      return (
                        <tr
                          className="tracker-row"
                          key={num}
                          title="Open standard"
                          onClick={() => modal.open(<StandardDialog rec={rec} num={num} />)}
                        >
                          <td className="iasa-std-num">
                            <RowOpen
                              onOpen={() => modal.open(<StandardDialog rec={rec} num={num} />)}
                              label={`Open standard ${num}: ${title}`}
                            >
                              <b>{num}</b>
                            </RowOpen>
                          </td>
                          <td>{title}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <select
                              className="field-select field-select-sm iasa-conf-select"
                              style={{ color: ch }}
                              value={c}
                              onChange={(e) => {
                                const v = e.target.value;
                                edit((r) => {
                                  r.std[num] = { ...(r.std[num] || {}), conf: v };
                                });
                              }}
                            >
                              {STD_CONF.map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          </td>
                          <td className="iasa-std-evidence">
                            {iu.evidence ? iu.evidence : c === "Not rated" ? "—" : ""}
                            {iu.gap ? <div className="iasa-gap">△ {iu.gap}</div> : null}
                            {iu.action ? <div className="iasa-action">↳ {iu.action}</div> : null}
                          </td>
                          <td className="iasa-std-act" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="btn-icon-action"
                              type="button"
                              title="Edit standard"
                              onClick={() => modal.open(<StandardDialog rec={rec} num={num} />)}
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
            );
          })}
        </div>
      ))}

      <div className="seclabel anim-fade-in" style={{ margin: "18px 0 10px", fontSize: 15 }}>
        Assessment by Principle
      </div>
      <div className="card anim-fade-in">
        <table className="iasa-std-table">
          <thead>
            <tr>
              <th scope="col" className="iasa-std-num">#</th>
              <th scope="col">Principle</th>
              <th scope="col">Domain</th>
              <th scope="col" className="iasa-std-conf">Conformance (rollup)</th>
              <th scope="col">Maturity</th>
              <th scope="col" className="iasa-std-act"></th>
            </tr>
          </thead>
          <tbody>
            {allPrinc().map((p) => {
              const roll = rollupPrinc(rec, p.n);
              const rc = CONF_HEX[roll] || "#94a3b8";
              const it = princItem(rec, p.n);
              return (
                <tr
                  className="tracker-row"
                  key={p.n}
                  title="Open principle"
                  onClick={() => modal.open(<PrincipleDialog rec={rec} pn={p.n} />)}
                >
                  <td className="iasa-std-num">
                    <RowOpen
                      onOpen={() => modal.open(<PrincipleDialog rec={rec} pn={p.n} />)}
                      label={`Open principle ${p.n}: ${p.t}`}
                    >
                      <b>P{p.n}</b>
                    </RowOpen>
                  </td>
                  <td>
                    <b>{p.t}</b>
                    {it.notes ? (
                      <div className="hint" style={{ marginTop: 3 }}>
                        {it.notes}
                      </div>
                    ) : null}
                    {it.action ? <div className="iasa-action">↳ {it.action}</div> : null}
                  </td>
                  <td className="hint">
                    {p.d} · {p.dt}
                  </td>
                  <td>
                    <span className="pill iasa-roll-pill" style={{ background: rc + "22", color: rc }}>
                      {roll}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className="field-select field-select-sm"
                      value={princMaturity(rec, p.n)}
                      onChange={(e) => {
                        const v = +e.target.value || 0;
                        edit((r) => {
                          r.items[p.n] = { ...(r.items[p.n] || {}), maturity: v };
                        });
                      }}
                    >
                      {MATURITY.map((m, i) => (
                        <option key={m} value={i}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="iasa-std-act" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-icon-action"
                      type="button"
                      title="Principle commentary"
                      onClick={() => modal.open(<PrincipleDialog rec={rec} pn={p.n} />)}
                    >
                      ✎
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 8 }}>
          Principle conformance rolls up automatically from the standard-level ratings above.
        </div>
      </div>

      <div className="card iasa-conclusion anim-fade-in">
        <div className="row">
          <div className="seclabel" style={{ margin: 0 }}>
            Overall conclusion
          </div>
          <div className="spacer" />
          <button
            className="btn ghost sm ai-generate-btn"
            type="button"
            onClick={() => modal.open(<CommentaryDialog rec={rec} />)}
          >
            Generate conclusion
          </button>
        </div>
        <CommitTextarea
          className="iasa-conclusion-input"
          placeholder="EQA opinion statement…"
          value={rec.commentary || ""}
          onCommit={(v) => edit((r) => void (r.commentary = v))}
        />
      </div>
    </>
  );
}
