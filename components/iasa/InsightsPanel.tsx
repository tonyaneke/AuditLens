"use client";

// The "Insights" tab — port of iasaInsights(): conformance heat map, distribution & maturity
// bars, priority non-conformances, the remediation roadmap and EQA readiness.

import { Empty } from "@/components/ui";
import {
  CONF_HEX,
  GIAS,
  STD_ACT_HEX,
  allStandards,
  eqaDue,
  iasaStats,
  opTone,
  overallOpinion,
  princMaturity,
  stdConf,
  stdItem,
} from "@/lib/workspace/iasa";
import { hx2rgba } from "@/lib/workspace/selectors";
import type { IaSaRecord } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import IasaKpi from "./IasaKpi";

const CMAP: [string, string][] = [
  ["Conforms", "#2e7d32"],
  ["Partially Conforms", "#c9a300"],
  ["Does Not Conform", "#b00020"],
  ["Not rated", "#94a3b8"],
];
const COL_LABEL: Record<string, string> = {
  "Does Not Conform": "Does Not",
  "Partially Conforms": "Partial",
};

export default function InsightsPanel({ rec }: { rec: IaSaRecord }) {
  const { db } = useWorkspace();
  const st = iasaStats(rec);
  const op = overallOpinion(rec);
  const eq = eqaDue(rec, db);
  const stds = allStandards();

  if (!st.rated) {
    return (
      <div className="card">
        <Empty big="⚖">
          No standards rated yet. Rate the 52 standards on the <b>Assessment</b> tab.
        </Empty>
      </div>
    );
  }

  const gaps = stds
    .filter((s) => ["Partially Conforms", "Does Not Conform"].includes(stdConf(rec, s.num)))
    .map((s) => ({ ...s, c: stdConf(rec, s.num), it: stdItem(rec, s.num) }))
    .sort((a, b) => (a.c === "Does Not Conform" ? 0 : 1) - (b.c === "Does Not Conform" ? 0 : 1));
  const actions = stds
    .map((s) => ({ ...s, it: stdItem(rec, s.num), c: stdConf(rec, s.num) }))
    .filter((s) => s.it.action);

  return (
    <>
      <div className="dash-kpis iasa-kpis anim-fade-in">
        <IasaKpi tone={opTone(op)} label="Overall opinion" value={op} sub="Per IIA rollup" />
        <IasaKpi tone="bad" label="Non-conformities" value={st.cnt["Does Not Conform"]} sub="Standards DNC" />
        <IasaKpi tone="mid" label="Partial conformance" value={st.cnt["Partially Conforms"]} sub="Standards PC" />
        <IasaKpi tone="base" label="Improvement actions" value={actions.length} sub="In the roadmap" />
        <IasaKpi tone={eq.tone} label="External QA" value={eq.txt} sub={eq.sub} />
      </div>

      <div className="dash2">
        <div className="card">
          <div className="seclabel">Conformance heat map — domain × rating</div>
          <p className="hint" style={{ marginTop: -6 }}>
            Count of standards at each conformance level; intensity = concentration. Dense
            red/amber rows are your focus domains.
          </p>
          <table className="hm">
            <thead>
              <tr>
                <th scope="col" className="axis">Domain</th>
                {CMAP.map(([k]) => (
                  <th scope="col" key={k}>{COL_LABEL[k] || k}</th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {GIAS.map((g) => {
                const cells: Record<string, number> = {
                  Conforms: 0,
                  "Partially Conforms": 0,
                  "Does Not Conform": 0,
                  "Not rated": 0,
                };
                let tot = 0;
                g.ps.forEach((p) =>
                  p.s.forEach(([num]) => {
                    cells[stdConf(rec, num)]++;
                    tot++;
                  }),
                );
                return (
                  <tr key={g.d}>
                    <td className="axis">
                      {g.d} · {g.dt}
                    </td>
                    {CMAP.map(([k, hex]) => {
                      const n = cells[k];
                      const bg = n ? hx2rgba(hex, 0.16 + 0.8 * (n / Math.max(1, tot))) : "#f7f9fb";
                      return (
                        <td
                          key={k}
                          className="cell"
                          style={{ background: bg, color: n && n / tot > 0.5 ? "#fff" : "#1c2733" }}
                        >
                          {n || ""}
                        </td>
                      );
                    })}
                    <td className="cell" style={{ background: "#f1f5f9" }}>
                      <b>{tot}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="seclabel">Standards conformance distribution</div>
          {CMAP.map(([k, hex]) => {
            const v = k === "Not rated" ? st.total - st.rated : st.cnt[k] || 0;
            return (
              <div className="rcrow" key={k}>
                <div className="nm">{k}</div>
                <div className="track">
                  <div className="fill" style={{ width: `${(v / st.total) * 100}%`, background: hex }} />
                </div>
                <div className="vv">{v}</div>
              </div>
            );
          })}
          <div className="seclabel" style={{ marginTop: 14 }}>
            Maturity by domain (avg / 5)
          </div>
          {GIAS.map((g) => {
            const vals = g.ps.map((p) => princMaturity(rec, p.n)).filter((v) => v >= 1);
            const av = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
            return (
              <div className="rcrow" key={g.d}>
                <div className="nm">
                  {g.d} · {g.dt}
                </div>
                <div className="track">
                  <div className="fill" style={{ width: `${(av / 5) * 100}%` }} />
                </div>
                <div className="vv">{av ? av.toFixed(1) : "—"}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="seclabel">
          Priority non-conformances (Does Not Conform → Partially Conforms)
        </div>
        {gaps.length ? (
          gaps.map((x) => (
            <div
              className="obs-block"
              key={x.num}
              style={{
                padding: "11px 13px",
                marginBottom: 10,
                background: hx2rgba(CONF_HEX[x.c], 0.1),
                borderColor: hx2rgba(CONF_HEX[x.c], 0.35),
              }}
            >
              <div className="row" style={{ alignItems: "flex-start" }}>
                <b style={{ flex: 1 }}>
                  {x.num} · {x.title}
                </b>
                <span
                  className="pill"
                  style={{ background: CONF_HEX[x.c] + "22", color: CONF_HEX[x.c], fontWeight: 700 }}
                >
                  {x.c}
                </span>
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                Principle {x.pn} · {x.pt} — Domain {x.d}
              </div>
              {x.it.gap ? (
                <div style={{ marginTop: 6, fontSize: 12.5 }}>
                  <b>Gap:</b> {x.it.gap}
                </div>
              ) : null}
              {x.it.action ? (
                <div style={{ marginTop: 4, fontSize: 12.5 }}>
                  <b>Action:</b> {x.it.action}
                  {x.it.owner ? <> · <i>{x.it.owner}</i></> : null}
                  {x.it.target ? <> · due {x.it.target}</> : null}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="hint">
            No partial or non-conforming standards — all rated standards conform.
          </div>
        )}
      </div>

      <div className="card">
        <div className="seclabel">Remediation roadmap</div>
        <p className="hint" style={{ marginTop: -6 }}>
          Improvement actions and their status. Track them through to completion on the{" "}
          <b>Improvement Tracker</b> tab.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: 48 }}>Std</th>
              <th scope="col">Standard</th>
              <th scope="col" style={{ width: 150 }}>Conformance</th>
              <th scope="col">Action</th>
              <th scope="col">Owner</th>
              <th scope="col">Target</th>
              <th scope="col" style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {actions.length ? (
              actions.map((x) => (
                <tr key={x.num}>
                  <td>
                    <b>{x.num}</b>
                  </td>
                  <td>{x.title}</td>
                  <td style={{ color: CONF_HEX[x.c], fontWeight: 600 }}>{x.c}</td>
                  <td>{x.it.action}</td>
                  <td>{x.it.owner || "—"}</td>
                  <td>{x.it.target || "—"}</td>
                  <td style={{ color: STD_ACT_HEX[x.it.status || "Not started"], fontWeight: 600 }}>
                    {x.it.status || "Not started"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="hint">
                  No improvement actions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="seclabel">External Quality Assessment readiness — NCCG 3-year rule</div>
        <p className="hint" style={{ marginTop: -6 }}>
          The Nigerian Code of Corporate Governance (NCCG) requires an external assessment at least
          once every three years by a qualified, independent assessor (stricter than IIA Standard
          8.4&rsquo;s five-year minimum), alongside ongoing internal quality assessment (Std 12.1)
          and periodic self-assessment.
        </p>
        <div className="row" style={{ gap: 26, flexWrap: "wrap" }}>
          <div>
            <div className="hint">Last external assessment</div>
            <b style={{ fontSize: 15 }}>{rec.lastEQA ? rec.lastEQA : "Not on record"}</b>
          </div>
          <div>
            <div className="hint">Status</div>
            <b
              style={{
                fontSize: 15,
                color: eq.tone === "bad" ? "#b00020" : eq.tone === "mid" ? "#c9a300" : "#2e7d32",
              }}
            >
              {eq.txt}
            </b>
          </div>
          <div>
            <div className="hint">Detail</div>
            <b style={{ fontSize: 15 }}>{eq.sub}</b>
          </div>
        </div>
      </div>
    </>
  );
}
