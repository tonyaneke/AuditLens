"use client";

// Audit Detail view (/audits/[audit]) — React port of renderAudit / planCard / planHTML from
// audit-bot.js, including the full legacy test programme table, the Generate-audit-plan flow
// and the ⚑ Raise-exception entry point on Exception/Partial test rows.

import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { exportAuditWord } from "@/lib/client/word";
import { exportExceptionsWord, exportPlanWord } from "@/lib/client/plan-word";
import { logAudit } from "@/lib/client/audit-log";
import {
  RESULTS,
  testControl,
  testIsException,
  testResultNotes,
  testTitle,
} from "@/lib/workspace/observations";
import type { AuditPlan, AuditTest, Report } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import ResultPill from "./ResultPill";
import {
  ModalAuditDialog,
  ModalEditPlanDialog,
  ModalPlanPromptDialog,
  ModalRaiseExceptionDialog,
  ModalReportDialog,
  ModalTestDialog,
  ModalTORDialog,
} from "./lazy";

export default function AuditDetailPage({ auditId }: { auditId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);

  usePageChrome({
    title: a?.name || "Audit Engagement",
    actions: a ? (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/audits" className="btn sec sm">
          ← Back to List
        </Link>
        <button className="btn sec sm" onClick={() => modal.open(<ModalTORDialog auditId={a.id} />)}>
          📄 Terms of Reference
        </button>
        <button className="btn sec sm" onClick={() => modal.open(<ModalAuditDialog auditId={a.id} />)}>
          ✎ Edit Audit
        </button>
        <button className="btn pri sm" onClick={() => exportAuditWord(db, a)}>
          ⤓ Export Audit
        </button>
      </div>
    ) : undefined,
  });

  if (!a) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Audit engagement not found</h3>
        <p className="hint">The requested audit engagement could not be found.</p>
        <Link href="/audits" className="btn sec" style={{ marginTop: 16 }}>
          ← Back to Audits List
        </Link>
      </div>
    );
  }

  const plan = (a.plan || {}) as AuditPlan;
  const tests: AuditTest[] = plan.tests || [];
  const hasPlan = !!(
    a.plan &&
    ((plan.scope || "").trim() || tests.length || (plan.objectives || []).length || (plan.keyRisks || []).length)
  );
  const hasExceptions = tests.some(testIsException);

  // Result-count summary line (planHTML): "N passed · N exceptions · N partial · N not tested".
  const rc: Record<string, number> = {};
  RESULTS.forEach((r) => (rc[r] = 0));
  tests.forEach((t) => {
    const k = t.result || "Not Tested";
    rc[k] = (rc[k] || 0) + 1;
  });

  function delTest(t: AuditTest) {
    if (!a) return;
    modal.confirm({
      message: "Delete this test?",
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => {
        mutate((d) => {
          const cur = (d.audits || []).find((x) => x.id === auditId);
          const p = cur && (cur.plan as AuditPlan | undefined);
          if (!p || !p.tests) return;
          p.tests = p.tests.filter((x) => x.id !== t.id);
        });
        logAudit("workspace.test_deleted", "Deleted test: " + testTitle(t) + (a ? " in " + a.name : ""), {
          auditId,
          testId: t.id,
        });
      },
    });
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="f3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div>
            <div className="ttl">Type</div>
            <div>{a.type === "department" ? "Department audit" : "Process audit"}</div>
          </div>
          <div>
            <div className="ttl">Process / Department</div>
            <div>{a.area || "—"}</div>
          </div>
          <div>
            <div className="ttl">Period</div>
            <div>{a.period || "—"}</div>
          </div>
          <div>
            <div className="ttl">Lead Auditor</div>
            <div>{a.leadAuditor || "—"}</div>
          </div>
          <div>
            <div className="ttl">Status</div>
            <div>
              <span className={`pill ${a.status === "Completed" ? "c-Low" : a.status === "In progress" ? "c-Medium" : "c-High"}`}>
                {a.status || "In progress"}
              </span>
            </div>
          </div>
          <div>
            <div className="ttl">Reports</div>
            <div>{a.reports ? a.reports.length : 0}</div>
          </div>
        </div>
      </div>

      {/* Audit Planning — Scope & Test Programme (legacy planCard/planHTML) */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Audit Planning — Scope &amp; Test Programme</h3>
          <div className="spacer" />
          <button
            className="btn sm dark ai-generate-btn"
            onClick={() => modal.open(<ModalPlanPromptDialog auditId={a.id} />)}
          >
            {hasPlan ? "Regenerate audit plan" : "Generate audit plan"}
          </button>
          {a.plan ? (
            <>
              <button className="btn ghost sm" onClick={() => modal.open(<ModalEditPlanDialog auditId={a.id} />)}>
                Edit
              </button>
              <button className="btn sm" onClick={() => exportPlanWord(db, a)}>
                ⤓ Export plan (Word)
              </button>
              {hasExceptions ? (
                <button className="btn sm" style={{ background: "var(--crit)" }} onClick={() => exportExceptionsWord(db, a)}>
                  ⤓ Exceptions report (Word)
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {!hasPlan ? (
          <div className="empty" style={{ padding: "24px 10px" }}>
            <div className="big">✦</div>
            No audit plan yet.
          </div>
        ) : (
          <>
            {plan.scope ? (
              <div className="obs-field">
                <div className="ttl">Scope</div>
                <div className="txt">
                  <RichText text={plan.scope} />
                </div>
              </div>
            ) : null}

            {plan.objectives && plan.objectives.length ? (
              <div className="obs-field">
                <div className="ttl">Audit objectives</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {plan.objectives.map((o: string, i: number) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.keyRisks && plan.keyRisks.length ? (
              <div className="obs-field">
                <div className="ttl">Key risks</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {plan.keyRisks.map((r: string, i: number) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="row" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <div className="ttl">Test programme ({tests.length})</div>
              {tests.length ? (
                <span className="hint">
                  {rc["Passed"]} passed ·{" "}
                  <b style={{ color: "var(--crit)" }}>
                    {rc["Exception"]} exception{rc["Exception"] !== 1 ? "s" : ""}
                  </b>{" "}
                  · {rc["Partial"]} partial · {rc["Not Tested"]} not tested
                  {rc["N/A"] ? <> · {rc["N/A"]} N/A</> : null}
                </span>
              ) : null}
              <div className="spacer" />
              <button className="btn ghost sm" onClick={() => modal.open(<ModalTestDialog auditId={a.id} />)}>
                + Add test
              </button>
            </div>

            {tests.length ? (
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Test</th>
                    <th>Objective</th>
                    <th>Control / population</th>
                    <th>Result</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t: AuditTest) => {
                    const isExc = testIsException(t);
                    const notes = testResultNotes(t);
                    return (
                      <tr key={t.id}>
                        <td>{t.ref || ""}</td>
                        <td>
                          <b>{testTitle(t)}</b>
                          {notes ? (
                            <div className="hint">
                              <b>Found:</b> {notes}
                            </div>
                          ) : null}
                        </td>
                        <td>{t.objective || ""}</td>
                        <td>
                          {testControl(t)}
                          {t.population || t.sampleBasis ? (
                            <div className="hint">
                              {t.population || ""}
                              {t.population && t.sampleBasis ? " · " : ""}
                              {t.sampleBasis || ""}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <ResultPill result={t.result} />
                          {t.evidenceRef ? <div className="hint">WP: {t.evidenceRef}</div> : null}
                          {t.testedBy ? (
                            <div className="hint">
                              {t.testedBy}
                              {t.testedDate ? " · " + t.testedDate : ""}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {isExc ? (
                            <button
                              className="btn sm"
                              style={{ background: "var(--crit)", display: "block", marginBottom: 5 }}
                              onClick={() => modal.open(<ModalRaiseExceptionDialog auditId={a.id} testId={t.id} />)}
                            >
                              ⚑ Raise
                            </button>
                          ) : null}
                          <button className="btn ghost sm" onClick={() => modal.open(<ModalTestDialog auditId={a.id} testId={t.id} />)}>
                            Edit
                          </button>
                          <button className="btn ghost sm" title="Delete" onClick={() => delTest(t)}>
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="hint" style={{ marginTop: 6 }}>
                No tests yet.
              </div>
            )}
          </>
        )}
      </div>

      {/* Reports Section */}
      <div className="section-block">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            Reports ({a.reports ? a.reports.length : 0})
          </h3>
          <button className="btn pri sm" onClick={() => modal.open(<ModalReportDialog auditId={a.id} />)}>
            + New Report
          </button>
        </div>

        {!a.reports || a.reports.length === 0 ? (
          <div className="card" style={{ padding: 40, textAlign: "center" }}>
            <div className="hint">No reports in this audit yet.</div>
            <button className="btn pri" style={{ marginTop: 12 }} onClick={() => modal.open(<ModalReportDialog auditId={a.id} />)}>
              + Add a Report
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {a.reports.map((r: Report) => {
              const obs = r.observations || [];
              return (
                <div className="card" key={r.id} style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <Link href={`/audits/${a.id}/reports/${r.id}`} style={{ fontWeight: 700, fontSize: 16 }}>
                      {r.title}
                    </Link>
                    <span className={`pill ${r.status === "Final" ? "c-Low" : "c-Medium"}`}>{r.status || "Draft"}</span>
                  </div>
                  {r.refNo ? <div className="meta" style={{ marginBottom: 8 }}>Ref: {r.refNo}</div> : null}
                  <div className="hint" style={{ flex: 1, marginBottom: 12 }}>
                    {obs.length} observation(s)
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn sec sm" onClick={() => modal.open(<ModalReportDialog auditId={a.id} reportId={r.id} />)}>
                      Edit
                    </button>
                    <Link href={`/audits/${a.id}/reports/${r.id}`} className="btn pri sm">
                      View Report →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
