"use client";

// Audit Detail view (/audits/[audit]) — React port of renderAudit / planCard from audit-bot.js.

import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { exportAuditWord } from "@/lib/client/word";
import { ck } from "@/lib/workspace/selectors";
import type { Audit, AuditTest, Report } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ModalAuditDialog,
  ModalReportDialog,
  ModalTestDialog,
  ModalTORDialog,
} from "./dialogs";

export default function AuditDetailPage({ auditId }: { auditId: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);

  usePageChrome({
    title: a?.name || "Audit Engagement",
    actions: a ? (
      <div style={{ display: "flex", gap: 8 }}>
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

  const plan = (a.plan || {}) as {
    scope?: string;
    objectives?: string[];
    keyRisks?: string[];
    tests?: AuditTest[];
  };
  const tests = plan.tests || [];

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

      {/* Audit Planning Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Audit Planning — Scope &amp; Test Programme</h3>
          <button className="btn sec sm" onClick={() => modal.open(<ModalTestDialog auditId={a.id} />)}>
            + Add Test
          </button>
        </div>

        {plan.scope ? (
          <div style={{ marginBottom: 14 }}>
            <div className="ttl">Scope</div>
            <div className="txt"><RichText text={plan.scope} /></div>
          </div>
        ) : null}

        {plan.objectives && plan.objectives.length ? (
          <div style={{ marginBottom: 14 }}>
            <div className="ttl">Audit Objectives</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {plan.objectives.map((o: string, i: number) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {plan.keyRisks && plan.keyRisks.length ? (
          <div style={{ marginBottom: 14 }}>
            <div className="ttl">Key Risks</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {plan.keyRisks.map((r: string, i: number) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {tests.length ? (
          <div>
            <div className="ttl" style={{ marginBottom: 8 }}>
              Test Programme ({tests.length})
            </div>
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Test</th>
                  <th>Objective</th>
                  <th>Control / Population</th>
                  <th>Result</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t: AuditTest) => (
                  <tr key={t.id}>
                    <td>
                      <b>{t.ref}</b>
                    </td>
                    <td>{t.name}</td>
                    <td>{t.objective || "—"}</td>
                    <td>{t.control || "—"}</td>
                    <td>
                      <span className={`pill ${t.result === "Passed" ? "c-Low" : t.result === "Exception" ? "c-Critical" : "c-Medium"}`}>
                        {t.result || "Not Tested"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn sec sm" onClick={() => modal.open(<ModalTestDialog auditId={a.id} testId={t.id} />)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="hint">No tests added to the audit programme yet.</div>
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
