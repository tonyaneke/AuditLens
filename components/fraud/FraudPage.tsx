"use client";

// Fraud Risk Assessment — React port of viewFraud (KPIs, heat map, ACFE category card,
// fraud risk register, Fraud Prevention Plan section) plus its topbar actions and the
// one-time actions migration the legacy view ran on render.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty, Kpi, RowOpen } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { effectiveRole } from "@/lib/permissions";
import { urlForView } from "@/lib/routes";
import {
  actStatusClass,
  bandRank,
  fraudActions,
  fraudEnriched,
  fraudMigrationNeeded,
  migrateFraudActions,
  rollupFraud,
  type FraudView,
} from "@/lib/workspace/fraud";
import { BAND_HEX, BANDS, fraudBand, fraudList, hx2rgba } from "@/lib/workspace/selectors";
import { FRAUD_CATS } from "@/lib/workspace/fraud";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  FraudActionDialog,
  FraudDialog,
  FraudDownloadDialog,
  FraudPlanDialog,
  FraudUpdateDialog,
  GenerateFraudRisksDialog,
} from "./lazy";

const TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

function BandPill({ band }: { band: string }) {
  return (
    <span className="pill" style={{ background: hx2rgba(BAND_HEX[band], 0.16), color: BAND_HEX[band] }}>
      {band}
    </span>
  );
}

/* ---- heat map (port of fraudHeatHTML) ---- */
function FraudHeatMap({ grid }: { grid: Record<string, number> }) {
  return (
    <>
      <table className="fhm">
        <tbody>
          {[5, 4, 3, 2, 1].map((imp) => (
            <tr key={imp}>
              <td className="ax">{imp}</td>
              {[1, 2, 3, 4, 5].map((lk) => {
                const band = fraudBand(imp * lk);
                const n = grid[lk + "-" + imp] || 0;
                return (
                  <td
                    key={lk}
                    style={{ background: BAND_HEX[band], color: band === "Medium" ? "#3a2f00" : "#fff" }}
                  >
                    {n || ""}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="ax"></td>
            {[1, 2, 3, 4, 5].map((l) => (
              <td key={l} className="ax">
                {l}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>
        Y = Impact (1 Insignificant → 5 Severe) · X = Likelihood (1 Rare → 5 Almost certain).
        Numbers = fraud risks at that inherent rating.
        <div style={{ marginTop: 6 }}>
          {[...BANDS].reverse().map((b) => (
            <span key={b}>
              <span className="pill" style={{ background: hx2rgba(BAND_HEX[b], 0.18), color: BAND_HEX[b] }}>
                {b}
              </span>{" "}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---- ACFE category bars (port of fraudCatHTML) ---- */
function FraudCatBars({ byCat }: { byCat: Record<string, number> }) {
  const rows = FRAUD_CATS.filter((c) => byCat[c]).map((c) => [c, byCat[c]] as const);
  if (!rows.length) return <div className="hint">No risks categorized yet.</div>;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <>
      {rows.map(([c, n]) => (
        <div className="acfe-row" key={c}>
          <div className="acfe-nm">{c}</div>
          <div className="acfe-track">
            <div className="acfe-fill" style={{ width: (n / max) * 100 + "%" }} />
          </div>
          <div className="acfe-val">{n}</div>
        </div>
      ))}
    </>
  );
}

export default function FraudPage() {
  const { db, mutate, version } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const isStaff = effectiveRole(user) !== "head_of_audit";
  const [planExpanded, setPlanExpanded] = useState(false);

  // Legacy requireHead(): the add/generate/edit/delete controls are visible but refuse to act
  // for anyone but the Head of Audit.
  function headOnly(open: () => void) {
    if (isStaff) {
      toast("Only the Head of Audit can perform this action.", "error");
      return;
    }
    open();
  }

  const F = fraudList(db);

  // Legacy viewFraud() ran migrateFraudActions() on every render; here it is a one-shot
  // mutation whenever a risk still lacks its actions list or its rollup status is stale.
  useEffect(() => {
    if (F.length && fraudMigrationNeeded(db)) mutate((d) => migrateFraudActions(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, F.length]);

  usePageChrome(
    {
      title: "Fraud Risk Assessment",
      actions: (
        <>
          <button
            className="btn btn-download"
            type="button"
            onClick={() => modal.open(<FraudDownloadDialog />)}
          >
            <span className="dl-icon" aria-hidden="true">
              ⤓
            </span>{" "}
            Download
          </button>
          {isStaff ? null : (
            <>
              <button
                className="btn sm dark ai-generate-btn"
                type="button"
                onClick={() => modal.open(<GenerateFraudRisksDialog />)}
              >
                Generate fraud risks
              </button>
              <button className="btn sm" type="button" onClick={() => modal.open(<FraudDialog />)}>
                + Add fraud risk
              </button>
            </>
          )}
        </>
      ),
    },
    [isStaff],
  );

  function delFraud(id: string) {
    headOnly(() => {
      void modal.confirm({
        message: "Delete this fraud risk?",
        danger: true,
        confirmLabel: "Delete",
        busyLabel: "Deleting…",
        onConfirm: () => {
          const f = fraudList(db).find((x) => x.id === id);
          mutate((d) => {
            d.fraudRisks = (d.fraudRisks || []).filter((x) => x.id !== id);
          });
          const t = f?.title;
          const n = f?.name;
          logAudit(
            "fraud.risk_deleted",
            "Deleted fraud risk: " +
              ((typeof t === "string" && t) || (typeof n === "string" && n) || ""),
            { fraudRiskId: id },
          );
        },
      });
    });
  }

  function delFraudAction(rid: string, aid: string) {
    mutate((d) => {
      const f = (d.fraudRisks || []).find((x) => x.id === rid);
      if (!f) return;
      f.actions = (f.actions || []).filter((x) => x.id !== aid);
      rollupFraud(f);
    });
  }

  if (!F.length) {
    return (
      <div className="card">
        <Empty big="⚠">
          No fraud risks captured yet.
          <br />
          <br />
          <button
            className="btn dark ai-generate-btn"
            type="button"
            onClick={() => headOnly(() => modal.open(<GenerateFraudRisksDialog />))}
          >
            Generate fraud risks
          </button>
          &nbsp;{" "}
          <button className="btn" type="button" onClick={() => headOnly(() => modal.open(<FraudDialog />))}>
            + Add fraud risk manually
          </button>
        </Empty>
      </div>
    );
  }

  const plan = db.fraudPlanNarrative || "";
  const en = fraudEnriched(db);
  const byBand: Record<string, number> = {};
  BANDS.forEach((b) => (byBand[b] = 0));
  en.forEach((f) => byBand[f.res]++);
  const byCat: Record<string, number> = {};
  en.forEach((f) => (byCat[f.category || ""] = (byCat[f.category || ""] || 0) + 1));
  const grid: Record<string, number> = {};
  en.forEach((f) => {
    const k = f.likelihood + "-" + f.impact;
    grid[k] = (grid[k] || 0) + 1;
  });
  const allActs = en.flatMap((f) => fraudActions(f));
  const implN = allActs.filter((a) => a.status === "Implemented").length;
  const planRanked = en.slice().sort((a, b) => bandRank(b.res) - bandRank(a.res));

  return (
    <>
      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        <Kpi tone="warn" label="Extreme / High" value={byBand.Extreme + byBand.High} sub="residual fraud exposure" />
        <Kpi tone="base" label="Total risks" value={F.length} sub="in the register" />
        <Kpi tone="good" label="Mitigated" value={en.filter((f) => f.status === "Mitigated").length} sub="response complete" />
        <Kpi tone="accent" label="Open actions" value={en.filter((f) => f.status !== "Mitigated").length} sub="in prevention plan" />
      </div>

      <div className="dash2">
        <div className="card">
          <div className="seclabel">Fraud risk heat map — likelihood × impact (inherent)</div>
          <FraudHeatMap grid={grid} />
        </div>
        <div className="card acfe-card">
          <div className="seclabel">By scheme category (ACFE)</div>
          <FraudCatBars byCat={byCat} />
          <div className="seclabel" style={{ marginTop: 20 }}>
            Residual exposure
          </div>
          <div className="acfe-residual">
            {[...BANDS].reverse().map((b) => (
              <div className="acfe-res-item" key={b}>
                <span className="dot" style={{ background: BAND_HEX[b] }} />
                <span className="acfe-res-label">{b}</span>
                <span className="acfe-res-val">{byBand[b]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="seclabel">Fraud risk register</div>
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th scope="col">Scheme</th>
              <th scope="col">Category</th>
              <th scope="col">Process</th>
              <th scope="col">L×I</th>
              <th scope="col">Inherent</th>
              <th scope="col">Controls</th>
              <th scope="col">Residual</th>
              <th scope="col">Owner</th>
              <th scope="col">Status</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {en.map((f) => (
              <tr
                className="tracker-row"
                key={f.id}
                title="Open fraud risk"
                onClick={() => router.push(urlForView("fraudrisk", { fraud: f.id }))}
              >
                <td>
                  <RowOpen
                    onOpen={() => router.push(urlForView("fraudrisk", { fraud: f.id }))}
                    label={`Open fraud risk: ${f.scheme}`}
                  >
                    <b>{f.scheme}</b>
                  </RowOpen>
                  {f.year ? <div className="hint">{f.year}</div> : null}
                </td>
                <td>{f.category}</td>
                <td>{f.process || "—"}</td>
                <td style={{ textAlign: "center" }}>
                  {f.likelihood}×{f.impact}={f.score}
                </td>
                <td>
                  <BandPill band={f.inh} />
                </td>
                <td>{f.controlStrength || "—"}</td>
                <td>
                  <BandPill band={f.res} />
                </td>
                <td>{f.owner || "—"}</td>
                <td>{f.status || "Identified"}</td>
                <td className="ra-actions-cell" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn-icon-action"
                    type="button"
                    title="Edit"
                    onClick={() => headOnly(() => modal.open(<FraudDialog fraudId={f.id} />))}
                  >
                    ✎
                  </button>
                  <button
                    className="btn-icon-action danger"
                    type="button"
                    title="Delete"
                    onClick={() => delFraud(f.id)}
                  >
                    {TRASH}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="seclabel" style={{ margin: 0 }}>
            Fraud Prevention Plan
          </div>
          <div className="spacer" />
          <span className="hint">
            {allActs.length ? implN + "/" + allActs.length + " actions implemented" : "no actions yet"}
          </span>
          <button className="btn ghost sm" type="button" onClick={() => modal.open(<FraudUpdateDialog />)}>
            📅 Quarterly update
          </button>
          <button className="btn ghost sm" type="button" onClick={() => modal.open(<FraudPlanDialog />)}>
            Edit overview
          </button>
        </div>
        <div className="hint" style={{ margin: "4px 0 10px" }}>
          Each fraud risk from the assessment is listed below by residual priority. Add the
          prevention/response actions that will mitigate it — together they are your fraud
          prevention plan.
        </div>
        {plan ? (
          <>
            <div
              className="txt"
              style={{
                whiteSpace: "pre-wrap",
                margin: "8px 0 4px",
                padding: "10px 12px",
                background: "#f8fafc",
                border: "1px solid var(--line)",
                borderRadius: 8,
                ...(planExpanded
                  ? {}
                  : {
                      maxHeight: 96,
                      overflow: "hidden",
                      position: "relative" as const,
                      WebkitMaskImage: "linear-gradient(#000 60%,transparent)",
                    }),
              }}
            >
              {plan}
            </div>
            {plan.length > 260 ? (
              <button
                className="btn ghost sm"
                type="button"
                style={{ marginBottom: 8 }}
                onClick={() => setPlanExpanded((v) => !v)}
              >
                {planExpanded ? "▲ Show less" : "▼ Read more"}
              </button>
            ) : null}
          </>
        ) : (
          <div className="hint" style={{ margin: "8px 0" }}>
            No plan overview yet.
          </div>
        )}
        {planRanked.map((f: FraudView) => {
          const acts = fraudActions(f);
          return (
            <div className="fraud-plan-card" key={f.id}>
              <div className="fraud-plan-head">
                <BandPill band={f.res} />
                <b>{f.scheme}</b>
                <span className="hint">
                  {f.category}
                  {f.process ? " · " + f.process : ""}
                </span>
                <div className="spacer" />
                <button
                  className="btn sec sm"
                  type="button"
                  onClick={() => modal.open(<FraudActionDialog riskId={f.id} />)}
                >
                  + Add action
                </button>
              </div>
              {acts.length ? (
                <table style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th scope="col">Prevention / response action</th>
                      <th scope="col">Type</th>
                      <th scope="col">Owner</th>
                      <th scope="col">Target</th>
                      <th scope="col">Status</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {acts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {a.text}
                          {a.update ? <div className="hint">Update: {a.update}</div> : null}
                        </td>
                        <td>{a.type || "—"}</td>
                        <td>{a.owner || "—"}</td>
                        <td>{a.targetDate || "—"}</td>
                        <td>
                          <span className={actStatusClass(a.status)}>{a.status || "Planned"}</span>
                        </td>
                        <td className="ra-actions-cell">
                          <button
                            className="btn-icon-action"
                            type="button"
                            title="Edit"
                            onClick={() => modal.open(<FraudActionDialog riskId={f.id} actionId={a.id} />)}
                          >
                            ✎
                          </button>
                          <button
                            className="btn-icon-action danger"
                            type="button"
                            title="Delete"
                            onClick={() => delFraudAction(f.id, a.id)}
                          >
                            {TRASH}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="hint" style={{ marginTop: 6 }}>
                  No prevention actions yet — click <b>+ Add action</b>, or use <b>✦ Draft actions</b>{" "}
                  above.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
