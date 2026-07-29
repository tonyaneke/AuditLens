"use client";

// Audit Risk Assessment — React port of viewAuditRA (risk-ranked universe + annual plan) and
// its toolbar/top actions, including the plan-year rollover that the legacy view ran on render.

import { useEffect } from "react";
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
  ensureUniverse,
  needsRollover,
  planYear,
  planYearsList,
  RA_HEX,
  raDueYear,
  raRanked,
  rolloverPlan,
  unitOccDone,
  unitOccTotal,
  universe,
  type RaUnitView,
} from "@/lib/workspace/ra";
import { hx2rgba } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import AuditLinks from "./AuditLinks";
import EngagementStatusPill from "./EngagementStatusPill";
import {
  GeneratePlanDialog,
  GenerateUniverseDialog,
  NewPlanDialog,
  RaDownloadDialog,
  RaUnitDialog,
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
    <span className="pill" style={{ background: hx2rgba(RA_HEX[band], 0.16), color: RA_HEX[band] }}>
      {band}
    </span>
  );
}

export default function RiskAssessmentPage() {
  const { db, mutate, version } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const isStaff = effectiveRole(user) !== "head_of_audit";

  // Legacy requireHead(): the universe/plan editors are visible to everyone (the edit and delete
  // icons sit in the table for all roles) but refuse to open for anyone but the Head of Audit.
  function headOnly(open: () => void) {
    if (isStaff) {
      toast("Only the Head of Audit can perform this action.", "error");
      return;
    }
    open();
  }

  const U = universe(db);
  const py = planYear(db);

  // Legacy viewAuditRA() called rolloverPlan() on every render; here it is a one-shot mutation
  // whenever the workspace actually has engagements left behind in an earlier plan year.
  useEffect(() => {
    if (U.length && needsRollover(db)) mutate((d) => void rolloverPlan(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, U.length]);

  usePageChrome(
    {
      title: "Audit Risk Assessment",
      actions: isStaff ? (
        <button
          className="btn-icon-action"
          type="button"
          title="Download"
          onClick={() => modal.open(<RaDownloadDialog />)}
        >
          ⤓
        </button>
      ) : U.length ? (
        <>
          <button
            className="btn-icon-action"
            type="button"
            title="Download"
            onClick={() => modal.open(<RaDownloadDialog />)}
          >
            ⤓
          </button>
          <button className="btn sm" type="button" onClick={() => headOnly(() => modal.open(<NewPlanDialog />))}>
            + New audit plan
          </button>
        </>
      ) : (
        <button
          className="btn sm dark ai-generate-btn"
          type="button"
          onClick={() => headOnly(() => modal.open(<GenerateUniverseDialog />))}
        >
          Generate audit universe
        </button>
      ),
    },
    [isStaff, U.length],
  );

  function delUnit(e: RaUnitView) {
    void modal.confirm({
      message: "Delete this auditable unit?",
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.auditUniverse = ensureUniverse(d).filter((x) => x.id !== e.id);
        });
        logAudit("plan.unit_deleted", "Deleted auditable unit: " + (e.name || ""), { unitId: e.id });
      },
    });
  }

  if (!U.length) {
    return (
      <div className="card">
        <Empty big="◈">
          No auditable units yet.
          <br />
          <br />
          <button
            className="btn dark ai-generate-btn"
            type="button"
            onClick={() => headOnly(() => modal.open(<GenerateUniverseDialog />))}
          >
            Generate audit universe
          </button>
          &nbsp;{" "}
          <button className="btn" type="button" onClick={() => headOnly(() => modal.open(<RaUnitDialog />))}>
            + Add auditable unit
          </button>
        </Empty>
      </div>
    );
  }

  const en = raRanked(db);
  const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  en.forEach((e) => (counts[e.band] = (counts[e.band] || 0) + 1));
  const dueN = en.filter((e) => e.due).length;
  const planned = en.filter((e) => e.incl);
  const totalOcc = planned.reduce((s, e) => s + unitOccTotal(e), 0);
  const doneOcc = planned.reduce((s, e) => s + unitOccDone(e), 0);
  const pctPlan = totalOcc ? Math.round((doneOcc / totalOcc) * 100) : 0;
  const planHasContent = planned.some((e) => (e.plannedPeriod || "").trim() || (e.rationale || "").trim());

  return (
    <>
      <div className="ra-toolbar">
        <div className="filter-group">
          <span className="filter-label">Plan year</span>
          <select
            className="field-select field-select-sm"
            value={py}
            onChange={(e) => {
              const v = e.target.value;
              mutate((d) => {
                d.planYear = v;
              });
            }}
          >
            {planYearsList(db).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dash-kpis" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <Kpi tone="warn" label="High / Critical" value={counts.High + counts.Critical} sub="units by risk rating" />
        <Kpi tone="base" label="Auditable units" value={U.length} sub="in the universe" />
        <Kpi tone="accent" label={"Due in " + py} value={dueN} sub="by frequency cycle" />
        <Kpi tone="base" label={"In " + py + " plan"} value={planned.length} sub="selected for the year" />
        <Kpi tone="good" label="Plan delivered" value={pctPlan + "%"} sub={doneOcc + " of " + totalOcc + " reviews done"} />
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "center", gap: 10, marginBottom: 2 }}>
          <div className="seclabel" style={{ margin: 0 }}>
            Risk-ranked audit universe
          </div>
          <div className="spacer" />
          {isStaff ? null : (
            <button className="btn sm" type="button" onClick={() => headOnly(() => modal.open(<RaUnitDialog />))}>
              + Add unit
            </button>
          )}
        </div>
        <table className="ra-universe-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th scope="col">Auditable unit</th>
              <th scope="col">Category</th>
              <th scope="col">Risk score</th>
              <th scope="col">Rating</th>
              <th scope="col">Last audited</th>
              <th scope="col">Frequency</th>
              <th scope="col">Due</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {en.map((e) => (
              <tr key={e.id}>
                <td>
                  <b>{e.name}</b>
                  {e.owner ? <div className="hint">{e.owner}</div> : null}
                </td>
                <td>{e.category || "—"}</td>
                <td style={{ textAlign: "center" }}>{e.score.toFixed(2)}</td>
                <td>
                  <BandPill band={e.band} />
                </td>
                <td style={{ textAlign: "center" }}>{e.lastAudited || "—"}</td>
                <td>{e.freq}</td>
                <td style={{ textAlign: "center" }}>
                  {e.due ? (
                    <span className="due-date" title={`Due by end of ${raDueYear(db, e, e.band)}`}>
                      Dec {raDueYear(db, e, e.band)}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td className="ra-actions-cell">
                  <button
                    className="btn-icon-action"
                    type="button"
                    title="Edit"
                    onClick={() => headOnly(() => modal.open(<RaUnitDialog unitId={e.id} />))}
                  >
                    ✎
                  </button>
                  <button
                    className="btn-icon-action danger"
                    type="button"
                    title="Delete"
                    onClick={() => headOnly(() => delUnit(e))}
                  >
                    {TRASH}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 8 }}>
          Risk score = weighted average of factors (1–5). Frequency: Critical/High = annual · Medium
          = 2 yrs · Low = 3 yrs. “Due” = last audited + cycle ≤ plan year (or never audited).
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <div className="seclabel" style={{ margin: 0 }}>
            Annual Audit Plan — {py}
          </div>
          <div className="spacer" />
          <span className="hint">
            {planned.length} engagement(s) · {doneOcc}/{totalOcc} quarter-reviews done ({pctPlan}%)
          </span>
          {isStaff ? null : (
            <button
              className="btn sm dark ai-generate-btn"
              type="button"
              onClick={() => headOnly(() => modal.open(<GeneratePlanDialog />))}
            >
              {planHasContent ? "Regenerate" : "Generate"} plan (AI)
            </button>
          )}
        </div>
        {planned.length ? (
          <>
            <div className="hint" style={{ margin: "2px 0 8px" }}>
              Click a row to open the full engagement — details, linked audits and status.
            </div>
            <table className="ra-plan-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th scope="col" className="ra-plan-num-col">#</th>
                  <th scope="col">Auditable unit</th>
                  <th scope="col" className="ra-rating-col">Rating</th>
                  <th scope="col" className="ra-timing-col">Timing</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="ra-link-col">Linked audit</th>
                </tr>
              </thead>
              <tbody>
                {planned.map((e, i) => (
                  <tr
                    className="ra-plan-row"
                    key={e.id}
                    title="Open engagement"
                    onClick={() => router.push(urlForView("raunit", { unit: e.id }))}
                  >
                    <td className="ra-plan-num-col">{i + 1}</td>
                    <td>
                      <RowOpen
                        onOpen={() => router.push(urlForView("raunit", { unit: e.id }))}
                        label={`Open engagement: ${e.name}`}
                      >
                        <b>{e.name}</b>
                      </RowOpen>
                      <div className="hint">
                        {e.freq}
                        {e.carryOverFrom ? (
                          <>
                            {" · "}
                            <span className="ra-carry">carried over from {String(e.carryOverFrom)}</span>
                          </>
                        ) : null}
                      </div>
                    </td>
                    <td className="ra-rating-col">
                      <BandPill band={e.band} />
                    </td>
                    <td className="ra-timing-col">
                      {e.plannedPeriod ? e.plannedPeriod : <span className="hint">—</span>}
                    </td>
                    <td>
                      <EngagementStatusPill unit={e} />
                    </td>
                    <td className="ra-link-col">
                      <AuditLinks unit={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="hint" style={{ margin: "8px 0" }}>
            No units in plan for this year.
          </div>
        )}
      </div>
    </>
  );
}
