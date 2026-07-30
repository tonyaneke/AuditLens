"use client";

// Audit domain dialogs: Audit edit, Report edit, Terms of Reference, Audit Plan & Tests,
// Executive Summary edit — plus the restored legacy AI flows: Generate audit plan
// (modalPlanPrompt/doImportPlan), Edit plan meta (modalEditPlan), Raise exception from a test
// (modalRaiseException/generateException), Generate observation from a one-liner
// (modalGenerateObs), Generate executive summary (modalExecPrompt/doImportExec), Scan for
// repeats (scanRepeats), bulk SOP drafting (modalSopBulk), CSV bulk import (doBulkImport),
// Reassign action owner (modalReassignObs) and Observation edit (modalObs/saveObs — edit only:
// creation goes through NewObsDialog/RaiseFlow). All ported from public/audit-bot.js.

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import RaiseFlow from "@/components/obs/RaiseFlow";
import { runAiJson, runAiText } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { directory, loadDirectory } from "@/lib/client/directory";
import { dl } from "@/lib/client/exports";
import { generateObsDraft } from "@/lib/client/obs-ai";
import { useDirectoryUsers } from "@/components/external/use-directory";
import { exportTORWord } from "@/lib/client/word";
import {
  AUDIT_STATUS,
  ASSURANCE,
  RESULTS,
  TIMELINES,
  cancelPendingStatusChange,
  departments,
  findObsIn,
  findOrCreateAudit,
  findOrCreateReport,
  findRepeatCandidates,
  hasExecSummary,
  isHead,
  normCrit,
  notifyBoth,
  notifyHeadsApproval,
  obsFromAi,
  parseCSV,
  repLabel,
  stampClosed,
  statusClass,
  supersedePendingUpdate,
  testControl,
  testResultNotes,
  testTitle,
  worstCrit,
  zc,
  type AiObsDraft,
  type RepeatCandidate,
} from "@/lib/workspace/observations";
import { CRITS, RUBRIC, STATUSES, approvals, expectedClose, fmtDate, isoNow, reportDateOf, uid } from "@/lib/workspace/selectors";
import type { Audit, AuditTest, AuditPlan, Criticality, Observation, Report, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import ResultPill from "./ResultPill";

/* ---------------- Audit Add/Edit Modal ---------------- */

export function ModalAuditDialog({ auditId }: { auditId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const a = auditId ? (db.audits || []).find((x) => x.id === auditId) : undefined;

  const [name, setName] = useState(String(a?.name || ""));
  const [type, setType] = useState<"department" | "process">((a?.type as "department" | "process") || "department");
  const [area, setArea] = useState(String(a?.area || ""));
  const [period, setPeriod] = useState(a?.period || "");
  const [leadAuditor, setLeadAuditor] = useState(a?.leadAuditor || "");
  const [leadAuditorId, setLeadAuditorId] = useState(a?.leadAuditorId || "");
  const [status, setStatus] = useState(a?.status || "In progress");
  const [err, setErr] = useState("");

  const dir = useDirectoryUsers();

  function save() {
    if (!name.trim()) {
      setErr("Audit title is required.");
      return;
    }
    const newId = a ? "" : uid();
    mutate((d) => {
      if (a) {
        const cur = (d.audits || []).find((x) => x.id === a.id);
        if (cur) {
          cur.name = name.trim();
          cur.type = type;
          cur.area = area.trim();
          cur.period = period.trim();
          cur.leadAuditor = leadAuditor;
          cur.leadAuditorId = leadAuditorId;
          cur.status = status as Audit["status"];
        }
      } else {
        const newAudit: Audit = {
          id: newId,
          name: name.trim(),
          type,
          area: area.trim(),
          period: period.trim(),
          leadAuditor,
          leadAuditorId,
          status: status as Audit["status"],
          createdAt: new Date().toISOString(),
          reports: [],
        };
        d.audits = d.audits || [];
        d.audits.push(newAudit);
      }
    });
    logAudit(a ? "audit.updated" : "audit.created", (a ? "Updated" : "Created") + " audit: " + name);
    toast(a ? "Audit updated" : "Audit created", "success");
    modal.close();
    if (!a && newId) {
      // Land on the new audit's page and offer the plan generation straight away
      // (one click to generate — the AI never runs silently).
      router.push(`/audits/${newId}`);
      modal.open(<ModalPlanPromptDialog auditId={newId} />);
    }
  }

  return (
    <ModalFrame
      title={a ? "Edit Audit" : "New Audit Engagement"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            {a ? "Save Changes" : "Create Audit"}
          </button>
        </>
      }
    >
      {err ? <div className="ai-err" style={{ marginBottom: 12 }}>{err}</div> : null}
      <label>Audit Engagement Name *</label>
      <input
        type="text"
        placeholder="e.g. Q3 IT Governance Audit or Treasury Operations Audit"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="f2" style={{ marginTop: 12 }}>
        <div>
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as "department" | "process")}>
            <option value="department">Department Audit</option>
            <option value="process">Process Review</option>
          </select>
        </div>
        <div>
          <label>Process / Department</label>
          <input
            type="text"
            placeholder="e.g. Information Technology or Accounts Payable"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </div>
      </div>

      <div className="f2" style={{ marginTop: 12 }}>
        <div>
          <label>Period Under Review</label>
          <input
            type="text"
            placeholder="e.g. Q3 2024 or FY 2024"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <div>
          <label>Lead Auditor</label>
          <select
            value={leadAuditorId}
            onChange={(e) => {
              const id = e.target.value;
              setLeadAuditorId(id);
              const u = dir.find((x) => x.id === id);
              if (u) setLeadAuditor(u.name);
            }}
          >
            <option value="">Select auditor...</option>
            {dir.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Engagement Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {AUDIT_STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </ModalFrame>
  );
}

/* ---------------- Report Add/Edit Modal ---------------- */

export function ModalReportDialog({ auditId, reportId }: { auditId: string; reportId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && reportId ? (a.reports || []).find((x) => x.id === reportId) : undefined;

  const [title, setTitle] = useState(r?.title || a?.name || "");
  const [refNo, setRefNo] = useState(r?.refNo || "");
  const [period, setPeriod] = useState(r?.period || a?.period || "");
  const [status, setStatus] = useState(r?.status || "Draft");
  const [kind, setKind] = useState(r?.kind || "Audit report");
  const [scope, setScope] = useState(r?.scope || "");
  const [err, setErr] = useState("");

  function save() {
    if (!title.trim()) {
      setErr("Report title is required.");
      return;
    }
    const newId = r ? "" : uid();
    mutate((d) => {
      const targetAudit = (d.audits || []).find((x) => x.id === auditId);
      if (!targetAudit) return;
      if (r) {
        const curReport = (targetAudit.reports || []).find((x) => x.id === r.id);
        if (curReport) {
          curReport.title = title.trim();
          curReport.refNo = refNo.trim();
          curReport.period = period.trim();
          curReport.status = status as Report["status"];
          curReport.kind = kind;
          curReport.scope = scope.trim();
        }
      } else {
        const newReport: Report = {
          id: newId,
          title: title.trim(),
          refNo: refNo.trim(),
          period: period.trim(),
          status: status as Report["status"],
          kind,
          scope: scope.trim(),
          execSummaryNarrative: "",
          createdAt: new Date().toISOString(),
          observations: [],
        };
        targetAudit.reports = targetAudit.reports || [];
        targetAudit.reports.push(newReport);
      }
    });
    logAudit(r ? "report.updated" : "report.created", (r ? "Updated" : "Created") + " report: " + title);
    toast(r ? "Report updated" : "Report created", "success");
    modal.close();
    // Legacy saveReport parity: open the (new) report's page, where the head-only
    // "Generate exec summary" button sits in the Executive Summary card.
    if (!r && newId) router.push(`/audits/${auditId}/reports/${newId}`);
  }

  return (
    <ModalFrame
      title={r ? "Edit Report" : "Add Report"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            {r ? "Save Changes" : "Create Report"}
          </button>
        </>
      }
    >
      {err ? <div className="ai-err" style={{ marginBottom: 12 }}>{err}</div> : null}
      <label>Report Title *</label>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="f2" style={{ marginTop: 12 }}>
        <div>
          <label>Ref No.</label>
          <input type="text" placeholder="e.g. IA/2024/001" value={refNo} onChange={(e) => setRefNo(e.target.value)} />
        </div>
        <div>
          <label>Period</label>
          <input type="text" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
      </div>

      <div className="f2" style={{ marginTop: 12 }}>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="Draft">Draft</option>
            <option value="Under Review">Under Review</option>
            <option value="Final">Final</option>
          </select>
        </div>
        <div>
          <label>Report Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="Audit report">Audit Report</option>
            <option value="Process review report">Process Review Report</option>
            <option value="Special review">Special Review</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Scope Description</label>
        <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
      </div>
    </ModalFrame>
  );
}

/* ---------------- Terms of Reference Modal ---------------- */

export function ModalTORDialog({ auditId }: { auditId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const tor = (a?.tor || {}) as Record<string, string>;

  const [addressee, setAddressee] = useState(tor.addressee || "");
  const [date, setDate] = useState(tor.date || new Date().toISOString().slice(0, 10));
  const [timing, setTiming] = useState(tor.timing || "");
  const [background, setBackground] = useState(tor.background || "");
  const [outOfScope, setOutOfScope] = useState(tor.outOfScope || "");
  const [infoRequired, setInfoRequired] = useState(tor.infoRequired || "");
  const [reportingTo, setReportingTo] = useState(tor.reportingTo || "");

  function save() {
    mutate((d) => {
      const cur = (d.audits || []).find((x) => x.id === auditId);
      if (cur) {
        cur.tor = {
          addressee,
          date,
          timing,
          background,
          outOfScope,
          infoRequired,
          reportingTo,
        };
      }
    });
    logAudit("tor.updated", "Updated TOR for audit: " + a?.name);
    toast("Terms of Reference saved", "success");
    modal.close();
  }

  return (
    <ModalFrame
      title="Terms of Reference (TOR)"
      footer={
        <>
          <button className="btn sec" type="button" onClick={() => exportTORWord(db, a!)}>
            ⤓ Export TOR (Word)
          </button>
          <div className="spacer" />
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save TOR
          </button>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Addressed To</label>
          <input type="text" placeholder="e.g. Managing Director / Head of Ops" value={addressee} onChange={(e) => setAddressee(e.target.value)} />
        </div>
        <div>
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Planned Timing</label>
        <input type="text" placeholder="e.g. October 15 – November 15, 2024" value={timing} onChange={(e) => setTiming(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Background &amp; Purpose</label>
        <textarea rows={3} value={background} onChange={(e) => setBackground(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Out of Scope Areas</label>
        <textarea rows={2} value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Information &amp; Access Required</label>
        <textarea rows={2} value={infoRequired} onChange={(e) => setInfoRequired(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Reporting Channel</label>
        <input type="text" placeholder="e.g. Executive Management & Board Audit Committee" value={reportingTo} onChange={(e) => setReportingTo(e.target.value)} />
      </div>
    </ModalFrame>
  );
}

/* ---------------- Audit Planning Test Modal ---------------- */

export function ModalTestDialog({ auditId, testId }: { auditId: string; testId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const plan = (a?.plan || {}) as AuditPlan;
  const tests: AuditTest[] = plan.tests || [];
  const test = testId ? tests.find((t) => t.id === testId) : undefined;

  const [ref, setRef] = useState(test?.ref || "");
  const [title, setTitle] = useState(test ? testTitle(test) : "");
  const [objective, setObjective] = useState(test?.objective || "");
  const [procedure, setProcedure] = useState(test?.procedure || "");
  const [control, setControl] = useState(test ? testControl(test) : "");
  const [population, setPopulation] = useState(test?.population || "");
  const [sampleBasis, setSampleBasis] = useState(test?.sampleBasis || "");
  const [result, setResult] = useState<string>(test?.result || "Not Tested");
  const [testedBy, setTestedBy] = useState(test?.testedBy || "");
  const [testedDate, setTestedDate] = useState(test?.testedDate || "");
  const [resultNotes, setResultNotes] = useState(test ? testResultNotes(test) : "");
  const [evidenceRef, setEvidenceRef] = useState(test?.evidenceRef || "");

  function save() {
    if (!title.trim()) {
      toast("Test name required");
      return;
    }
    // Exact legacy field names (saveTest in audit-bot.js); name/control/notes stay mirrored
    // for rows the earlier React dialog created.
    const data: Partial<AuditTest> = {
      ref,
      title,
      name: title,
      objective,
      procedure,
      controlTested: control,
      control,
      population,
      sampleBasis,
      result: (result || "Not Tested") as AuditTest["result"],
      resultNotes,
      notes: resultNotes,
      evidenceRef,
      testedBy,
      testedDate,
    };
    mutate((d) => {
      const cur = (d.audits || []).find((x) => x.id === auditId);
      if (!cur) return;
      const curPlan: AuditPlan = (cur.plan as AuditPlan | undefined) || { scope: "", objectives: [], keyRisks: [], tests: [] };
      cur.plan = curPlan;
      curPlan.tests = curPlan.tests || [];
      if (test) {
        const t = curPlan.tests.find((x) => x.id === test.id);
        if (t) Object.assign(t, data);
      } else {
        curPlan.tests.push({ id: uid(), ...data } as AuditTest);
      }
    });
    toast("Audit test saved", "success");
    modal.close();
  }

  return (
    <ModalFrame
      title={test ? "Edit test" : "Add test"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Ref</label>
          <input type="text" placeholder="e.g. T1" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <div>
          <label>Test name *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <label>Objective</label>
      <textarea value={objective} onChange={(e) => setObjective(e.target.value)} />
      <label>Procedure</label>
      <textarea value={procedure} onChange={(e) => setProcedure(e.target.value)} />
      <label>Control / assertion tested</label>
      <input type="text" value={control} onChange={(e) => setControl(e.target.value)} />
      <div className="f2">
        <div>
          <label>Population</label>
          <input type="text" value={population} onChange={(e) => setPopulation(e.target.value)} />
        </div>
        <div>
          <label>Sample basis</label>
          <input type="text" value={sampleBasis} onChange={(e) => setSampleBasis(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 14, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
        <div className="ttl">Fieldwork result</div>
      </div>
      <div className="f3">
        <div>
          <label>Result</label>
          <select value={result || "Not Tested"} onChange={(e) => setResult(e.target.value)}>
            {RESULTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Tested by</label>
          <input type="text" value={testedBy} onChange={(e) => setTestedBy(e.target.value)} />
        </div>
        <div>
          <label>Test date</label>
          <input type="text" placeholder="e.g. 12 Jul 2026" value={testedDate} onChange={(e) => setTestedDate(e.target.value)} />
        </div>
      </div>
      <label>What was found (result / exception detail)</label>
      <textarea
        placeholder="Describe what testing showed — e.g. 6 of 25 sampled disbursements had no committee approval on file."
        value={resultNotes}
        onChange={(e) => setResultNotes(e.target.value)}
      />
      <label>Evidence / working-paper reference</label>
      <input type="text" placeholder="e.g. WP-3.2 / sample sheet ref" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
    </ModalFrame>
  );
}

/* ---------------- Front Matter / Executive Summary Modal ---------------- */

export function ModalFrontMatterDialog({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);

  const [objective, setObjective] = useState(r?.objective || "");
  const [outOfScope, setOutOfScope] = useState(r?.outOfScope || "");
  const [strengths, setStrengths] = useState(r?.strengths || "");
  const [areasForImprovement, setAreasForImprovement] = useState(r?.areasForImprovement || "");
  const [assuranceLevel, setAssuranceLevel] = useState(r?.assuranceLevel || "");
  const [auditOpinion, setAuditOpinion] = useState(r?.auditOpinion || "");
  const [conclusion, setConclusion] = useState(r?.conclusion || "");

  function save() {
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      if (curR) {
        curR.objective = objective;
        curR.outOfScope = outOfScope;
        curR.strengths = strengths;
        curR.areasForImprovement = areasForImprovement;
        curR.assuranceLevel = assuranceLevel;
        curR.auditOpinion = auditOpinion;
        curR.conclusion = conclusion;
      }
    });
    toast("Executive summary saved", "success");
    modal.close();
  }

  return (
    <ModalFrame
      title="Edit Executive Summary"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save Executive Summary
          </button>
        </>
      }
    >
      <label>Audit Objective</label>
      <textarea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)} />

      <label style={{ marginTop: 10 }}>Areas Out of Scope</label>
      <textarea rows={2} value={outOfScope} onChange={(e) => setOutOfScope(e.target.value)} />

      <label style={{ marginTop: 10 }}>Highlights of Strengths</label>
      <textarea rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} />

      <label style={{ marginTop: 10 }}>Areas for Strategic Improvement</label>
      <textarea rows={3} value={areasForImprovement} onChange={(e) => setAreasForImprovement(e.target.value)} />

      <div style={{ marginTop: 10 }}>
        <label>Overall Audit Assurance Level</label>
        <select value={assuranceLevel} onChange={(e) => setAssuranceLevel(e.target.value)}>
          <option value="">Select assurance rating...</option>
          {ASSURANCE.map((asr: string) => (
            <option key={asr} value={asr}>
              {asr}
            </option>
          ))}
        </select>
      </div>

      <label style={{ marginTop: 10 }}>Internal Audit Opinion</label>
      <textarea rows={3} value={auditOpinion} onChange={(e) => setAuditOpinion(e.target.value)} />

      <label style={{ marginTop: 10 }}>Conclusion</label>
      <textarea rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
    </ModalFrame>
  );
}

/* ================= Restored legacy AI / workflow dialogs ================= */

const orgName = (db: WorkspaceDb) => String(db.org || "the organisation");

/* ---------------- Generate audit plan (modalPlanPrompt / buildPlanPrompt / doImportPlan) ---------------- */

function buildPlanPrompt(db: WorkspaceDb, a: Audit, ctx: string): string {
  return `Act as my internal audit planning assistant for ${orgName(db)}. Based on the audit details below, design a risk-based audit plan with a recommended scope and a test programme aligned to IIA best practice.

Audit name: ${a.name}
Basis: ${a.type === "department" ? "Department" : "Process"} audit
Process / Department: ${a.area || "(not specified)"}
Period: ${a.period || "(not specified)"}
Additional context: ${ctx || "(none)"}

Return ONLY a JSON object (no commentary) with these exact keys:
{
  "scope": "concise scope statement — what the audit will and will not cover",
  "objectives": ["audit objective 1", "audit objective 2"],
  "keyRisks": ["key risk 1", "key risk 2"],
  "tests": [
    {
      "ref": "T1",
      "title": "short test name",
      "objective": "what this test confirms",
      "procedure": "how to perform the test, step by step",
      "controlTested": "control or assertion being tested",
      "population": "data/population to draw from",
      "sampleBasis": "sampling approach"
    }
  ]
}
Tailor the key risks and tests specifically to this process/department.`;
}

type AiPlan = {
  scope?: unknown;
  objectives?: unknown;
  keyRisks?: unknown;
  tests?: unknown;
};

export function ModalPlanPromptDialog({ auditId }: { auditId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const [ctx, setCtx] = useState("");
  const [err, setErr] = useState("");

  async function generate() {
    if (!a) return;
    setErr("");
    let d: AiPlan | AiPlan[];
    try {
      d = await runAiJson<AiPlan | AiPlan[]>(buildPlanPrompt(db, a, ctx.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const obj: AiPlan = Array.isArray(d) ? { tests: d } : d;
    if (!obj || typeof obj !== "object") {
      setErr("Expected a JSON object.");
      return;
    }
    // Port of doImportPlan — scope/objectives/keyRisks replace, tests APPEND.
    mutate((dd) => {
      const cur = (dd.audits || []).find((x) => x.id === auditId);
      if (!cur) return;
      const plan: AuditPlan = (cur.plan as AuditPlan | undefined) || { scope: "", objectives: [], keyRisks: [], tests: [] };
      cur.plan = plan;
      if (obj.scope != null) plan.scope = String(obj.scope);
      if (Array.isArray(obj.objectives)) plan.objectives = obj.objectives.map(String);
      if (Array.isArray(obj.keyRisks)) plan.keyRisks = obj.keyRisks.map(String);
      plan.tests = plan.tests || [];
      const tests = Array.isArray(obj.tests) ? obj.tests : [];
      tests.forEach((raw) => {
        if (!raw || typeof raw !== "object") return;
        const t = raw as Record<string, unknown>;
        const title = String(t.title || "(untitled test)");
        const control = String(t.controlTested || t.control || "");
        plan.tests!.push({
          id: uid(),
          ref: String(t.ref || ""),
          title,
          name: title,
          objective: String(t.objective || ""),
          procedure: String(t.procedure || ""),
          controlTested: control,
          control,
          population: String(t.population || ""),
          sampleBasis: String(t.sampleBasis || t.sample || ""),
        });
      });
    });
    logAudit("workspace.plan_generated", "Generated audit plan for " + a.name, { auditId });
    modal.close();
    toast("Audit plan generated", "success");
  }

  return (
    <ModalFrame
      title="Generate audit plan"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate audit plan
          </BusyButton>
        </>
      }
    >
      <label>Additional context (optional)</label>
      <textarea
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
        placeholder="e.g. New loan management system went live Jan 2026; prior audit flagged weak collateral records."
      />
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- Edit scope, objectives & risks (modalEditPlan / savePlanMeta) ---------------- */

export function ModalEditPlanDialog({ auditId }: { auditId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const p = (a?.plan || {}) as AuditPlan;

  const [scope, setScope] = useState(String(p.scope || ""));
  const [objectives, setObjectives] = useState((p.objectives || []).join("\n"));
  const [keyRisks, setKeyRisks] = useState((p.keyRisks || []).join("\n"));

  function save() {
    mutate((d) => {
      const cur = (d.audits || []).find((x) => x.id === auditId);
      if (!cur) return;
      const plan: AuditPlan = (cur.plan as AuditPlan | undefined) || { scope: "", objectives: [], keyRisks: [], tests: [] };
      cur.plan = plan;
      plan.scope = scope;
      plan.objectives = objectives.split("\n").map((s) => s.trim()).filter(Boolean);
      plan.keyRisks = keyRisks.split("\n").map((s) => s.trim()).filter(Boolean);
    });
    modal.close();
    toast("Plan updated", "success");
  }

  return (
    <ModalFrame
      title="Edit scope, objectives & risks"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label>Scope</label>
      <textarea style={{ minHeight: 80 }} value={scope} onChange={(e) => setScope(e.target.value)} />
      <label>Audit objectives (one per line)</label>
      <textarea style={{ minHeight: 90 }} value={objectives} onChange={(e) => setObjectives(e.target.value)} />
      <label>Key risks (one per line)</label>
      <textarea style={{ minHeight: 90 }} value={keyRisks} onChange={(e) => setKeyRisks(e.target.value)} />
    </ModalFrame>
  );
}

/* ---------------- Raise exception from a test (modalRaiseException / buildExceptionPrompt) ---------------- */

function buildExceptionPrompt(db: WorkspaceDb, a: Audit, t: AuditTest): string {
  return `Act as my internal audit observation drafter for ${orgName(db)}. Convert the audit test result below into a formal exception (audit observation) using the 5C structure, and recommend a criticality using this rubric:
${CRITS.map((c) => `- ${c}: ${RUBRIC[c]}`).join("\n")}

Audit: ${a.name}${a.area ? " (" + a.area + ")" : ""}
Test ref: ${t.ref || "(none)"} — ${testTitle(t)}
Test objective: ${t.objective || "(not specified)"}
Procedure performed: ${t.procedure || "(not specified)"}
Control / assertion tested: ${testControl(t) || "(not specified)"}
Population / sample: ${t.population || "(not specified)"} / ${t.sampleBasis || "(not specified)"}
Test result: ${t.result || "Exception"}
What was found: ${testResultNotes(t) || "(describe the exception)"}

Return ONLY a JSON object (no commentary) with these exact keys:
{
  "title": "concise observation title",
  "category": "control theme",
  "description": "detailed condition — what testing found, with specifics",
  "criteria": "the policy/standard/expectation not met",
  "risk": "impact & risk if not addressed",
  "rootCause": "the most likely root cause(s) — if there is more than one, put EACH on its own line separated by a newline (\\n), not packed into one paragraph",
  "recommendation": "specific, actionable recommendation(s) per best practice — if there is more than one point or step, put EACH on its own line separated by a newline (\\n), not packed into one paragraph",
  "criticality": "Critical | High | Moderate | Low | Process Improvement",
  "owner": "the role/function best placed to own remediation, e.g. Head, Credit Operations",
  "timeline": "Immediate | Short-term | Long-term",
  "agreedTarget": "a realistic proposed agreed remediation target — a date or timeframe consistent with the timeline, e.g. 'Complete by 30 Sep 2026' or 'within 60 days'"
}`;
}

export function ModalRaiseExceptionDialog({ auditId, testId }: { auditId: string; testId: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const t = (((a?.plan || {}) as AuditPlan).tests || []).find((x) => x.id === testId);
  const reports = a?.reports || [];
  const [repId, setRepId] = useState(reports[0]?.id || "");
  const [err, setErr] = useState("");

  if (!a || !t) return null;

  if (!reports.length) {
    // Legacy "no report yet" notice.
    return (
      <ModalFrame
        title="Raise exception — no report yet"
        footer={
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
        }
      >
        <p>
          This audit has no report to hold the exception. Create a report first (open the audit →{" "}
          <b>+ New Report</b>), then raise the exception into it.
        </p>
      </ModalFrame>
    );
  }

  async function generate() {
    if (!a || !t) return;
    if (!repId) {
      setErr("Choose a target report.");
      return;
    }
    setErr("");
    let raw: AiObsDraft | AiObsDraft[];
    try {
      raw = await runAiJson<AiObsDraft | AiObsDraft[]>(buildExceptionPrompt(db, a, t));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const d = Array.isArray(raw) ? raw[0] : raw;
    if (!d || typeof d !== "object") {
      setErr("Expected a JSON object.");
      return;
    }
    // Port of doRaiseException — AI draft plus test enrichment, then the raise wizard.
    const obs = obsFromAi(d);
    if (!d.ref && t.ref) obs.ref = t.ref;
    if ((!d.title || d.title === "(untitled)") && testTitle(t)) obs.title = testTitle(t);
    if (!d.category && testControl(t)) obs.category = testControl(t);
    obs.sourceTest = t.id;
    obs.sourceTestRef = t.ref || "";
    obs.evidenceRef = t.evidenceRef || "";
    modal.close();
    modal.open(<RaiseFlow auditId={auditId} reportId={repId} draft={obs} />, { wide: true });
  }

  const notes = testResultNotes(t);
  return (
    <ModalFrame
      title={`Raise exception from test ${t.ref || ""}`}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate exception
          </BusyButton>
        </>
      }
    >
      <div className="note">
        <b>
          {t.ref ? t.ref + " — " : ""}
          {testTitle(t)}
        </b>{" "}
        · <ResultPill result={t.result} />
        <br />
        {notes ? notes : <i>No result notes captured yet — add them on the test for a sharper write-up.</i>}
      </div>
      <label>Target report</label>
      <select value={repId} onChange={(e) => setRepId(e.target.value)}>
        {reports.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- Generate observation from a one-liner (modalGenerateObs / buildObsPrompt) ----------------
   The prompt + draft normalizer live in lib/client/obs-ai.ts (shared with /observations/new). */

export function ModalGenerateObsDialog({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const [ol, setOl] = useState("");
  const [ctx, setCtx] = useState("");
  const [err, setErr] = useState("");

  async function generate() {
    if (!ol.trim()) {
      setErr("Enter a one-liner first.");
      return;
    }
    setErr("");
    try {
      const draft = await generateObsDraft(db, ol.trim(), String(a?.area || ""), ctx.trim());
      modal.close();
      modal.open(<RaiseFlow auditId={auditId} reportId={reportId} draft={draft} />, { wide: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  return (
    <ModalFrame
      title="Generate observation"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate observation
          </BusyButton>
        </>
      }
    >
      <label>One-liner observation</label>
      <input
        type="text"
        value={ol}
        onChange={(e) => setOl(e.target.value)}
        placeholder="e.g. Loan disbursements approved without credit committee sign-off"
      />
      <label>Additional context (optional)</label>
      <textarea
        style={{ minHeight: 80 }}
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
        placeholder="Any extra detail to steer the draft — prior findings, system, timing…"
      />
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- Generate executive summary (modalExecPrompt / buildExecPrompt / doImportExec) ---------------- */

function buildExecPrompt(db: WorkspaceDb, a: Audit, r: Report): string {
  const obs = r.observations || [];
  const c = zc();
  obs.forEach((o) => c[o.criticality]++);
  const overall = worstCrit(c, obs.length);
  const findingList =
    obs
      .map((o, i) => `${i + 1}. [${o.criticality}] ${o.title}${o.description ? " — " + o.description.slice(0, 120) : ""}`)
      .join("\n") || "(no observations captured yet)";
  return `Act as my internal audit report writer for ${orgName(db)}. Draft the executive summary for the report "${r.title}" (audit: ${a.name}${a.area ? ", " + a.area : ""}${r.period ? ", period " + r.period : ""}${r.scope ? ", scope: " + r.scope : ""}).

Findings raised (${obs.length}; mix: ${CRITS.filter((k) => c[k]).map((k) => c[k] + " " + k).join(", ") || "none"}; overall residual risk ${overall}):
${findingList}

Write in the formal tone of an internal audit report to the CAE/MD and Board Audit Committee. You MUST populate every field below — do not leave any blank or empty array. For list fields provide at least 2 substantive bullet items each (one per line when converted to text).

Return ONLY a JSON object with these exact keys:
{
  "objective": "1.1 audit objective & scope — what was assessed, frameworks/period; 1-2 short paragraphs",
  "outOfScope": ["area explicitly out of scope", "second out-of-scope area"],
  "strengths": ["notable strength / positive observation", "second strength"],
  "areasForImprovement": ["thematic area for strategic improvement", "second improvement theme"],
  "assuranceLevel": "High assurance | Moderate assurance | Limited assurance | No assurance",
  "auditOpinion": "1.4 internal audit opinion narrative justifying the assurance level and describing the control environment",
  "conclusion": "1.5 conclusion paragraph"
}`;
}

type AiExec = Record<string, unknown>;

export function ModalExecPromptDialog({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const [err, setErr] = useState("");
  const regen = hasExecSummary(r);

  async function generate() {
    if (!a || !r) return;
    setErr("");
    let d: AiExec;
    try {
      d = await runAiJson<AiExec>(buildExecPrompt(db, a, r));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    // Port of doImportExec — every section must come back populated.
    const li = (v: unknown) =>
      Array.isArray(v) ? v.filter((x) => String(x || "").trim()).join("\n") : String(v || "").trim();
    const need = (k: string, v: unknown) => {
      if (v == null || v === "") return k;
      if (Array.isArray(v) && !v.length) return k;
      return null;
    };
    const missing = [
      need("objective", d.objective),
      need("outOfScope", d.outOfScope),
      need("strengths", d.strengths),
      need("areasForImprovement", d.areasForImprovement),
      need("assuranceLevel", d.assuranceLevel),
      need("auditOpinion", d.auditOpinion),
      need("conclusion", d.conclusion),
    ].filter(Boolean);
    if (missing.length) {
      setErr("AI response incomplete — missing: " + missing.join(", ") + ". Try again.");
      return;
    }
    mutate((dd) => {
      const curA = (dd.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      if (!curR) return;
      curR.objective = String(d.objective);
      curR.outOfScope = li(d.outOfScope);
      curR.strengths = li(d.strengths);
      curR.areasForImprovement = li(d.areasForImprovement);
      curR.assuranceLevel =
        ASSURANCE.find((x) => x.toLowerCase() === String(d.assuranceLevel).toLowerCase()) || String(d.assuranceLevel);
      curR.auditOpinion = String(d.auditOpinion);
      curR.conclusion = String(d.conclusion);
    });
    logAudit("workspace.exec_summary_generated", "Generated executive summary for " + r.title, { auditId, reportId });
    modal.close();
    modal.success("Executive summary generated.");
  }

  return (
    <ModalFrame
      title={regen ? "Regenerate executive summary" : "Generate executive summary"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            {regen ? "Regenerate exec summary" : "Generate exec summary"}
          </BusyButton>
        </>
      }
    >
      <p className="hint">
        All sections will be populated — objective, out of scope, strengths, areas for improvement, opinion, and
        conclusion.
      </p>
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- Scan for repeat observations (scanRepeats / flagRepeat) ---------------- */

export function ModalScanRepeatsDialog({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);

  const hits = (r?.observations || [])
    .map((o) => {
      const c = findRepeatCandidates(db, o.title, reportId, o.id);
      return c.length ? { o, best: c[0] } : null;
    })
    .filter((x): x is { o: Observation; best: ReturnType<typeof findRepeatCandidates>[number] } => !!x);

  function flag(oid: string, label: string) {
    mutate((d) => {
      const curA = (d.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      const o = curR && (curR.observations || []).find((x) => x.id === oid);
      if (!o) return;
      o.isRepeat = true;
      if (!o.repeatOf) o.repeatOf = label;
    });
  }

  return (
    <ModalFrame
      title="Scan for repeat observations"
      footer={
        <button className="btn sec" type="button" onClick={modal.close}>
          Close
        </button>
      }
    >
      {!hits.length ? (
        <div className="empty" style={{ padding: "24px 10px" }}>
          <div className="big">🔁</div>
          No likely repeats found. Titles in this report don&apos;t closely match observations in other reports.
        </div>
      ) : (
        <>
          <p className="hint">
            {hits.length} observation(s) resemble findings in other reports. These are suggestions — confirm only
            genuine repeats.
          </p>
          {hits.map((h) => (
            <div key={h.o.id} className="obs-block" style={{ padding: "11px 13px", marginBottom: 10 }}>
              <div>
                <b>{h.o.title}</b>{" "}
                {h.o.isRepeat ? (
                  <span className="pill" style={{ background: "#efe3f7", color: "#6b3fa0" }}>
                    ↻ already flagged
                  </span>
                ) : null}
              </div>
              <div className="hint" style={{ margin: "6px 0" }}>
                Closest match ({Math.round(h.best.score * 100)}%): <b>{h.best.obs.title}</b>
                <br />
                {h.best.audit.name} · {h.best.report.title} ·{" "}
                <span className={statusClass(String(h.best.obs.status || "Open"))}>
                  {String(h.best.obs.status || "Open")}
                </span>
              </div>
              {h.o.isRepeat ? null : (
                <button className="btn sec sm" type="button" onClick={() => flag(h.o.id, repLabel(h.best))}>
                  Flag as repeat of this
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </ModalFrame>
  );
}

/* ---------------- Bulk SOP drafting (modalSopBulk / buildSopBulkPrompt / doImportSopBulk) ---------------- */

function buildSopBulkPrompt(db: WorkspaceDb, list: Observation[]): string {
  const body = list
    .map(
      (o, i) =>
        `${i + 1}. ref="${o.ref || o.id}" | ${o.title}\n   Found: ${o.description || "-"}\n   Criteria: ${o.criteria || "-"}\n   Recommendation: ${o.recommendation || "-"}`,
    )
    .join("\n\n");
  return `Act as an internal audit / policy specialist for ${orgName(db)}. For each audit observation below, draft the precise revised Standard Operating Procedure wording that resolves it — exactly what the procedure should now say (reference a clause/section where helpful). Return ONLY a JSON array (no commentary):
[ { "ref": "the ref shown for the observation", "sopUpdate": "the revised SOP wording / clause" } ]

Observations:
${body}`;
}

export function ModalSopBulkDialog({ auditId, reportId }: { auditId: string; reportId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const [includeAll, setIncludeAll] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    if (!r) return;
    setErr("");
    const list = (r.observations || []).filter((o) => includeAll || !(o.sopUpdate || "").trim());
    if (!list.length) {
      setErr("All observations already have a proposed SOP update. Tick the box to regenerate them.");
      return;
    }
    let d: unknown;
    try {
      d = await runAiJson<unknown>(buildSopBulkPrompt(db, list));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const arr = (Array.isArray(d) ? d : [d]) as Record<string, unknown>[];
    // Match refs against the CURRENT report before writing (port of doImportSopBulk).
    const patches: { obsId: string; sop: string }[] = [];
    arr.forEach((x) => {
      if (!x || !x.sopUpdate) return;
      const key = String(x.ref || "").trim();
      const obsList = r.observations || [];
      const o =
        (key && obsList.find((z) => z.ref && z.ref.toLowerCase() === key.toLowerCase())) ||
        (key && obsList.find((z) => z.id === key)) ||
        (x.title
          ? obsList.find((z) => z.title.toLowerCase().trim() === String(x.title).toLowerCase().trim())
          : null);
      if (o) patches.push({ obsId: o.id, sop: String(x.sopUpdate) });
    });
    if (!patches.length) {
      setErr("No matching observations found — check the ref values match.");
      return;
    }
    mutate((dd) => {
      const curA = (dd.audits || []).find((x) => x.id === auditId);
      const curR = curA && (curA.reports || []).find((x) => x.id === reportId);
      if (!curR) return;
      patches.forEach((p) => {
        const o = (curR.observations || []).find((z) => z.id === p.obsId);
        if (o) o.sopUpdate = p.sop;
      });
    });
    modal.close();
    toast(patches.length + " proposed SOP update(s) drafted", "success");
  }

  return (
    <ModalFrame
      title="Generate proposed SOP updates"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate SOP updates
          </BusyButton>
        </>
      }
    >
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, color: "#475569" }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={includeAll}
          onChange={(e) => setIncludeAll(e.target.checked)}
        />{" "}
        Include observations that already have a proposed SOP update
      </label>
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- CSV bulk import (downloadObsTemplate / doBulkImport) ---------------- */

const CSV_HEADERS = [
  "Audit", "AuditType", "Area", "Report", "Ref", "Title", "Criticality", "Category", "Description",
  "Criteria", "Risk", "RootCause", "Recommendation", "ProposedSOP", "ManagementResponse", "Owner",
  "Timeline", "DueDate", "Status", "IsRepeat", "RepeatOf",
];
const CSV_EXAMPLE = [
  "Credit Operations Audit 2025", "Process", "Credit Operations", "Loan Origination Controls Review", "1.1",
  "Loan disbursements approved without credit committee sign-off", "High", "Authorisation",
  "Funds were released without documented Credit Committee approval for sampled disbursements.",
  "Credit Policy requires committee approval before disbursement.",
  "Elevated credit loss, fraud and regulatory exposure.",
  "Disbursement system does not enforce approval as a hard control.",
  "Configure the system to block disbursement until approval is recorded; enforce segregation of duties.",
  "Section 4.2 of the Loan Disbursement SOP shall be revised to read: 'No disbursement may be initiated until a valid Credit Committee approval reference is recorded in the core system, and the officer who approves a facility shall not initiate its disbursement.'",
  "NDA executed; system control to be configured.", "Head, Credit Operations", "Immediate", "31 Aug 2026",
  "Open", "No", "",
];

export function downloadObsTemplate(): void {
  const q = (v: unknown) => {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = CSV_HEADERS.join(",") + "\n" + CSV_EXAMPLE.map(q).join(",") + "\n";
  dl(csv, "observations-import-template.csv", "text/csv");
}

const CSV_HMAP: Record<string, string> = {
  audit: "audit", audittype: "type", type: "type", area: "area", processdepartment: "area", department: "area",
  report: "report", ref: "ref", sn: "ref", title: "title", observation: "title", criticality: "criticality",
  rating: "criticality", category: "category", controltheme: "category", description: "description",
  detaileddescription: "description", condition: "description", criteria: "criteria", risk: "risk",
  impact: "risk", impactrisk: "risk", rootcause: "rootCause", cause: "rootCause", recommendation: "recommendation",
  proposedsop: "sopUpdate", sopupdate: "sopUpdate", proposedsopupdate: "sopUpdate",
  managementresponse: "managementResponse", mgmtresponse: "managementResponse", remediationaction: "managementResponse",
  owner: "owner", actionowner: "owner", timeline: "timeline", resolutiontimeline: "timeline", duedate: "dueDate",
  targetdate: "dueDate", agreedtarget: "dueDate", status: "status", isrepeat: "isRepeat", repeat: "isRepeat",
  repeatof: "repeatOf",
};

export function ModalBulkImportDialog() {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ReactNode>(null);

  function loadFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFileName(f.name);
    const rd = new FileReader();
    rd.onload = () => setCsvText(String(rd.result || ""));
    rd.readAsText(f);
  }

  function doImport() {
    const errOut = (m: ReactNode) => setResult(<div className="hint" style={{ color: "var(--crit)" }}>{m}</div>);
    if (!csvText.trim()) {
      errOut("Paste CSV or load a file first.");
      return;
    }
    const rows = parseCSV(csvText).filter((r) => r.some((c) => String(c).trim() !== ""));
    if (rows.length < 2) {
      errOut("No data rows found — need a header row plus at least one observation.");
      return;
    }
    const headers = rows[0].map((h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, ""));
    const idx: Record<string, number> = {};
    headers.forEach((h, i) => {
      const k = CSV_HMAP[h];
      if (k != null && idx[k] == null) idx[k] = i;
    });
    if (idx.audit == null || idx.report == null || idx.title == null) {
      errOut(
        <>
          CSV must include <b>Audit</b>, <b>Report</b> and <b>Title</b> columns. Download the template for the exact
          headers.
        </>,
      );
      return;
    }
    let imported = 0;
    const skipped: string[] = [];
    mutate((d) => {
      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        const g = (k: string) => (idx[k] != null ? String(cols[idx[k]] == null ? "" : cols[idx[k]]).trim() : "");
        const auditName = g("audit"), reportTitle = g("report"), title = g("title");
        if (!auditName || !reportTitle || !title) {
          skipped.push("Row " + (r + 1) + ": missing Audit / Report / Title");
          continue;
        }
        const a = findOrCreateAudit(d, auditName, g("type"), g("area"));
        const rep = findOrCreateReport(a, reportTitle);
        const tlRaw = g("timeline").replace(/\s+/g, "-");
        const tl = TIMELINES.find((t) => t.toLowerCase() === tlRaw.toLowerCase()) || "";
        const stRaw = g("status");
        const st =
          STATUSES.find((s) => s.toLowerCase() === stRaw.toLowerCase()) ||
          (/(progress|wip|ongoing)/i.test(stRaw)
            ? "In Progress"
            : /(clos|done|resolved|mitigat|complete)/i.test(stRaw)
              ? "Closed"
              : "Open");
        const o: Observation = {
          id: uid(),
          ref: g("ref"),
          title,
          category: g("category"),
          description: g("description"),
          criteria: g("criteria"),
          risk: g("risk"),
          rootCause: g("rootCause"),
          recommendation: g("recommendation"),
          sopUpdate: g("sopUpdate"),
          criticality: normCrit(g("criticality")) as Observation["criticality"],
          managementResponse: g("managementResponse"),
          owner: g("owner"),
          timeline: tl,
          dueDate: g("dueDate"),
          isRepeat: /^(y|yes|true|1)$/i.test(g("isRepeat")),
          repeatOf: g("repeatOf"),
          status: st,
          createdAt: new Date().toISOString(),
        };
        if (st === "Closed") o.closedDateISO = isoNow();
        rep.observations.push(o);
        imported++;
      }
    });
    logAudit("workspace.observations_imported", "Bulk-imported " + imported + " observation(s) from CSV");
    setResult(
      <>
        <div className="note">
          Imported <b>{imported}</b> observation(s){skipped.length ? `; skipped ${skipped.length}` : ""}.
        </div>
        {skipped.length ? (
          <div className="hint">
            {skipped.slice(0, 12).map((s, i) => (
              <span key={i}>
                {s}
                <br />
              </span>
            ))}
            {skipped.length > 12 ? "…" : ""}
          </div>
        ) : null}
        {imported ? (
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                modal.close();
                router.push("/audits");
              }}
            >
              View Audits &amp; Reports
            </button>{" "}
            <button
              className="btn sm sec"
              type="button"
              onClick={() => {
                modal.close();
                router.push("/");
              }}
            >
              View Dashboard
            </button>
          </div>
        ) : null}
      </>,
    );
  }

  return (
    <ModalFrame
      title="Import observations (CSV)"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
          <button className="btn pri" type="button" onClick={doImport}>
            Import
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn sec sm" type="button" onClick={downloadObsTemplate}>
          ⤓ Download CSV template
        </button>
        <label className="btn sec sm" style={{ display: "inline-block", margin: 0 }}>
          📎 Load CSV file
          <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={loadFile} />
        </label>
        <span className="hint">{fileName || "No file chosen"}</span>
      </div>
      <label style={{ marginTop: 10 }}>Or paste CSV here</label>
      <textarea
        style={{ minHeight: 140, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder={"Audit,AuditType,Area,Report,Ref,Title,Criticality,…"}
      />
      <div className="hint" style={{ marginTop: 6 }}>
        Audits and reports named in the CSV are created automatically when they don&apos;t exist yet.
      </div>
      <div style={{ marginTop: 10 }}>{result}</div>
    </ModalFrame>
  );
}

/* ---------------- Reassign action owner (modalReassignObs / saveReassignObs) ---------------- */

export function ModalReassignObsDialog({
  auditId,
  reportId,
  obsId,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
}) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const o = findObsIn(db, auditId, reportId, obsId);

  const [ownerId, setOwnerId] = useState(String(o?.ownerUserId || ""));
  const [owner2Id, setOwner2Id] = useState(String(o?.secondaryOwnerUserId || ""));
  const [due, setDue] = useState(String(o?.dueDate || ""));
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

  const dir = directory();
  // Skip departments whose head's login was deactivated (keep an existing selection visible).
  const ownerDepts = departments(db)
    .filter((d) => d.headUserId)
    .filter((d) => {
      const u = dir.find((x) => x.id === d.headUserId);
      return !u || u.active !== false || d.headUserId === ownerId || d.headUserId === owner2Id;
    });

  if (!o) return null;

  function save() {
    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, obsId);
      if (!cur) return;
      const dept = departments(d).find((x) => x.headUserId === ownerId);
      const prevOwner = cur.ownerUserId, prevSec = cur.secondaryOwnerUserId;
      cur.ownerUserId = ownerId || "";
      cur.owner = dept ? dept.headName : cur.owner || "";
      if (dept) cur.departmentId = dept.id;
      cur.secondaryOwnerUserId = owner2Id && owner2Id !== ownerId ? owner2Id : "";
      const dept2 = departments(d).find((x) => x.headUserId === cur.secondaryOwnerUserId);
      cur.secondaryOwner = dept2 ? dept2.headName : "";
      if (due) cur.dueDate = due;
      if (cur.ownerUserId && cur.ownerUserId !== prevOwner)
        notifyBoth(
          d,
          cur.ownerUserId,
          "assigned",
          "Observation reassigned to you: " + cur.title,
          "myobs",
          "AuditLens — An Observation was assigned to your department",
          `The audit observation "${cur.title}" has been assigned to your department as the primary action owner. Sign in to AuditLens to respond and close it.`,
          cur.id,
        );
      if (cur.secondaryOwnerUserId && cur.secondaryOwnerUserId !== prevSec)
        notifyBoth(
          d,
          cur.secondaryOwnerUserId,
          "assigned",
          "You have oversight on: " + cur.title,
          "myobs",
          "AuditLens — observation oversight",
          `You now have oversight of the observation "${cur.title}". Sign in to AuditLens to follow progress and add comments.`,
          cur.id,
        );
    });
    logAudit("obs.reassigned", "Reassigned owner: " + (o?.title || ""), { observationId: obsId });
    modal.close();
    modal.success("Owner reassigned. The action owner has been notified.");
  }

  return (
    <ModalFrame
      title="Reassign action owner"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save &amp; notify
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>{o.title}</b>
      </div>
      <label>Primary action owner (responds &amp; closes)</label>
      <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
        <option value="">— select primary owner —</option>
        {ownerDepts.map((d) => (
          <option key={d.id} value={d.headUserId}>
            {d.headName} · {d.name}
          </option>
        ))}
      </select>
      <label style={{ marginTop: 8 }}>
        Secondary action owner <span className="hint">(oversight — optional)</span>
      </label>
      <select value={owner2Id} onChange={(e) => setOwner2Id(e.target.value)}>
        <option value="">— none —</option>
        {ownerDepts.map((d) => (
          <option key={d.id} value={d.headUserId}>
            {d.headName} · {d.name}
          </option>
        ))}
      </select>
      <label style={{ marginTop: 8 }}>Closure date</label>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <div className="hint" style={{ marginTop: 8 }}>
        The newly-assigned owner(s) are notified. Reassignment works on any observation, including recent or past
        (closed) ones.
      </div>
    </ModalFrame>
  );
}

/* ---------------- Observation Edit Modal (legacy modalObs/saveObs) ----------------
   Edit-only: legacy's add branch is dead — observations are raised through NewObsDialog/
   RaiseFlow. The Head saves directly; audit staff cannot touch the live observation, so their
   full proposed change is parked as an `observation_update` approval for the Head to decide
   (the server enforces the same split — see CONTROLLED_OBS_FIELDS in lib/workspace-authz.ts). */

export function ModalObsDialog({
  auditId,
  reportId,
  obsId,
}: {
  auditId: string;
  reportId: string;
  obsId: string;
}) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const a = (db.audits || []).find((x) => x.id === auditId);
  const r = a && (a.reports || []).find((x) => x.id === reportId);
  const o = r && (r.observations || []).find((x) => x.id === obsId);

  const [ref, setRef] = useState(String(o?.ref || ""));
  const [crit, setCrit] = useState(String(o?.criticality || "Moderate"));
  const [status, setStatus] = useState(String(o?.status || "Open"));
  const [title, setTitle] = useState(String(o?.title || ""));
  const [cat, setCat] = useState(String(o?.category || ""));
  const [desc, setDesc] = useState(String(o?.description || ""));
  const [criteria, setCriteria] = useState(String(o?.criteria || ""));
  const [risk, setRisk] = useState(String(o?.risk || ""));
  const [root, setRoot] = useState(String(o?.rootCause || ""));
  const [rec, setRec] = useState(String(o?.recommendation || ""));
  const [sop, setSop] = useState(String(o?.sopUpdate || ""));
  const [sopErr, setSopErr] = useState("");
  const [mgmt, setMgmt] = useState(String(o?.managementResponse || ""));
  const [mgmtErr, setMgmtErr] = useState("");
  const [owner, setOwner] = useState(String(o?.owner || ""));
  const [tl, setTl] = useState(String(o?.timeline || ""));
  const [due, setDue] = useState(String(o?.dueDate || ""));
  const [isRep, setIsRep] = useState(!!o?.isRepeat);
  const [repOf, setRepOf] = useState(String(o?.repeatOf || ""));
  const [vby, setVby] = useState(String(o?.verifiedBy || ""));
  const [cev, setCev] = useState(String(o?.closureEvidence || ""));
  const [cdate, setCdate] = useState(String(o?.closedDateISO || ""));
  const [cnote, setCnote] = useState(String(o?.closureNote || ""));

  // Repeat auto-suggest (legacy suggestRepeats/markRepeatIdx). Computed at open from the stored
  // title, recomputed on demand from the edited one.
  const [sug, setSug] = useState<{ forTitle: string; cands: RepeatCandidate[] }>(() => ({
    forTitle: String(o?.title || ""),
    cands: findRepeatCandidates(db, String(o?.title || ""), reportId, obsId),
  }));
  const [flagged, setFlagged] = useState("");

  if (!o) return null;
  const head = isHead(user);

  const base = reportDateOf(r);
  const ec = expectedClose({ ...o, timeline: tl }, r);

  async function generateSop() {
    if (!title && !desc && !rec) {
      toast("Add the observation details (title / description / recommendation) first.", "error");
      return;
    }
    setSopErr("");
    const prompt = `Act as an internal audit / policy specialist for ${db.org}. For the audit observation below, draft the precise revised Standard Operating Procedure wording that resolves it — i.e. exactly what the procedure should now say (you may reference a clause/section number and quote the new text). Return ONLY the revised SOP wording as plain text (no commentary, no JSON).

Observation: ${title}
What was found: ${desc || "-"}
Criteria / expectation: ${criteria || "-"}
Impact / risk: ${risk || "-"}
Possible root cause: ${root || "-"}
Recommendation: ${rec || "-"}`;
    try {
      setSop((await runAiText(prompt)).trim());
    } catch (e) {
      setSopErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  async function generateMgmt() {
    if (!title && !desc) {
      toast("Add the observation details first.", "error");
      return;
    }
    setMgmtErr("");
    const prompt = `Act as the process owner / management responding to an internal audit observation at ${db.org}. Enhance the brief management response below into a concise, ACTION-focused response. Guidance:
- Do NOT over-acknowledge or restate the issue/risk — at most one short clause showing you understand it, then move on. The auditor has already described the issue.
- Lead with what management is doing: the agreed remediation action, the responsible owner, and a target timeline.
- Where applicable, state the interim / compensating control(s) applied now to contain the risk while the permanent, preventive fix is implemented.
- Convey urgency through concrete actions and dates, not through adjectives or assurances of "priority".
Be specific and concrete; do not over-promise, grovel, or be defensive. Write in the first person on behalf of management and keep it tight (one short paragraph, or two only if compensating + permanent fixes both apply). Return ONLY the enhanced management response as plain text (no commentary, no JSON).

Observation: ${title}
What was found: ${desc || "-"}
Criteria / expectation: ${criteria || "-"}
Impact / risk: ${risk || "-"}
Possible root cause: ${root || "-"}
Auditor recommendation: ${rec || "-"}
Criticality: ${crit || "-"}${owner ? `\nAction owner: ${owner}` : ""}${tl ? `\nResolution timeline: ${tl}` : ""}${due ? `\nTarget date: ${due}` : ""}

Management's current draft response: ${mgmt || "(none provided — draft an appropriate response from scratch)"}`;
    try {
      setMgmt((await runAiText(prompt)).trim());
    } catch (e) {
      setMgmtErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  function markRepeat(c: RepeatCandidate) {
    setIsRep(true);
    setRepOf(repLabel(c));
    setFlagged(repLabel(c));
  }

  function save() {
    if (!o) return;
    if (!title.trim()) {
      toast("Title required.", "error");
      return;
    }
    const data: Partial<Observation> = {
      ref: ref.trim(),
      title: title.trim(),
      category: cat.trim(),
      description: desc.trim(),
      criteria: criteria.trim(),
      risk: risk.trim(),
      rootCause: root.trim(),
      recommendation: rec.trim(),
      sopUpdate: sop.trim(),
      criticality: crit as Criticality,
      managementResponse: mgmt.trim(),
      owner: owner.trim(),
      timeline: tl,
      dueDate: due.trim(),
      status,
      isRepeat: isRep,
      repeatOf: repOf.trim(),
      verifiedBy: vby.trim(),
      closureEvidence: cev.trim(),
      closureNote: cnote.trim(),
    };
    if (status === "Closed" && cdate) data.closedDateISO = cdate;

    if (!head) {
      // Audit staff cannot edit an observation directly — the full proposed change is
      // routed to the Head of Audit for approval. The live observation is left untouched.
      mutate((d) => {
        supersedePendingUpdate(d, obsId, user);
        approvals(d).push({
          id: uid(),
          kind: "observation_update",
          obsId,
          auditId,
          reportId,
          obsTitle: o.title || title.trim(),
          changes: data,
          requestedBy: user.id || "",
          requestedByName: user.name || "",
          requestedAt: new Date().toISOString(),
          status: "pending",
        });
        notifyHeadsApproval(d, title.trim() + " (edit request)");
      });
      logAudit("obs.update_requested", "Requested edit to observation: " + title.trim(), {
        auditId,
        reportId,
        observationId: obsId,
      });
      modal.close();
      toast("Edit submitted to the Head of Audit for approval.", "success");
      return;
    }

    mutate((d) => {
      const cur = findObsIn(d, auditId, reportId, obsId);
      if (!cur) return;
      const oldStatus = cur.status || "Open";
      stampClosed(cur, status);
      Object.assign(cur, data);
      if (status !== oldStatus) cancelPendingStatusChange(d, obsId, user); // head applied directly — supersede any pending request
    });
    modal.close();
    toast("Observation updated.", "success");
  }

  return (
    <ModalFrame
      title="Edit observation"
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
      <div className="f3">
        <div>
          <label>Ref</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 1.1" />
        </div>
        <div>
          <label>Criticality *</label>
          <select value={crit} onChange={(e) => setCrit(e.target.value)}>
            {CRITS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <label>Title *</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <label>Category / control theme</label>
      <input value={cat} onChange={(e) => setCat(e.target.value)} />
      <label>Detailed description (condition)</label>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label>Criteria / expectation</label>
      <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      <label>Impact / risk (effect)</label>
      <textarea value={risk} onChange={(e) => setRisk(e.target.value)} />
      <label>Possible root cause</label>
      <textarea value={root} onChange={(e) => setRoot(e.target.value)} />
      <label>Recommendation</label>
      <textarea value={rec} onChange={(e) => setRec(e.target.value)} />
      <label>
        Proposed SOP update <span className="hint">(what the procedure should say)</span>{" "}
        <BusyButton className="btn sec sm ai-generate-btn" style={{ marginLeft: 6 }} busyLabel="Generating…" onClick={generateSop}>
          Generate
        </BusyButton>
      </label>
      <textarea value={sop} onChange={(e) => setSop(e.target.value)} />
      {sopErr ? <div className="ai-err" style={{ marginTop: 6 }}>{sopErr}</div> : null}
      <label>
        Management response{" "}
        <BusyButton className="btn sec sm ai-generate-btn" style={{ marginLeft: 6 }} busyLabel="Generating…" onClick={generateMgmt}>
          Generate
        </BusyButton>
      </label>
      <textarea value={mgmt} onChange={(e) => setMgmt(e.target.value)} />
      {mgmtErr ? <div className="ai-err" style={{ marginTop: 6 }}>{mgmtErr}</div> : null}
      <div className="f3">
        <div>
          <label>Action owner</label>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. Head, Credit Operations" />
        </div>
        <div>
          <label>Resolution timeline</label>
          <select value={tl} onChange={(e) => setTl(e.target.value)}>
            <option value="">— select —</option>
            {TIMELINES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label>
            Closure action <span className="hint">(optional override)</span>
          </label>
          <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="blank = auto-compute" />
        </div>
      </div>
      <div className="f2" style={{ marginTop: 4 }}>
        <div>
          <label>Repeat observation?</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, marginTop: 4 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={isRep} onChange={(e) => setIsRep(e.target.checked)} />{" "}
            Raised in a prior audit / report
          </label>
        </div>
        <div>
          <label>
            Repeat of <span className="hint">(prior ref / period)</span>
          </label>
          <input value={repOf} onChange={(e) => setRepOf(e.target.value)} placeholder="e.g. IA/2025/014 or FY2025" />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <button
          className="btn sec sm"
          type="button"
          onClick={() => setSug({ forTitle: title, cands: findRepeatCandidates(db, title, reportId, obsId) })}
        >
          🔁 Suggest possible repeats
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>
        {flagged ? (
          <div className="hint" style={{ color: "var(--low)", fontWeight: 600 }}>✓ Flagged as repeat of: {flagged}</div>
        ) : null}
        {!sug.forTitle || sug.forTitle.trim().length < 4 ? (
          <div className="hint">Add a fuller title, then check for repeats.</div>
        ) : sug.cands.length ? (
          <>
            <div className="hint" style={{ marginBottom: 2 }}>
              Possible repeats from other reports — confirm any that are genuine:
            </div>
            {sug.cands.map((c) => (
              <div
                className="row"
                key={c.obs.id}
                style={{ alignItems: "flex-start", gap: 8, borderTop: "1px solid var(--line)", padding: "7px 0" }}
              >
                <div style={{ flex: 1 }}>
                  <b>{c.obs.title}</b>
                  <div className="hint">
                    {c.audit.name} · {c.report.title} ·{" "}
                    <span className={statusClass(c.obs.status)}>{c.obs.status || "Open"}</span> ·{" "}
                    {Math.round(c.score * 100)}% match
                  </div>
                </div>
                <button className="btn sec sm" type="button" onClick={() => markRepeat(c)}>
                  Mark as repeat
                </button>
              </div>
            ))}
          </>
        ) : (
          <div className="hint">No similar observations found in other reports.</div>
        )}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        {base ? (
          <>
            Expected close = report date ({fmtDate(base)}) + window
            {ec ? <>: <b>{fmtDate(ec)}</b></> : <> — set a timeline to compute</>}. Leave Closure action blank to use
            this.
          </>
        ) : (
          <>
            Set the <b>report date</b> in the report front matter (Executive Summary → Edit) to enable aging &amp;
            expected close.
          </>
        )}
      </div>
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
        <div className="ttl">
          Closure verification{" "}
          <span className="hint" style={{ textTransform: "none", fontWeight: 400 }}>(used when status = Closed)</span>
        </div>
      </div>
      <div className="f3">
        <div>
          <label>Verified by</label>
          <input value={vby} onChange={(e) => setVby(e.target.value)} placeholder="e.g. J. Auditor" />
        </div>
        <div>
          <label>Closure evidence / WP ref</label>
          <input value={cev} onChange={(e) => setCev(e.target.value)} />
        </div>
        <div>
          <label>Closed date</label>
          <input type="date" value={cdate} onChange={(e) => setCdate(e.target.value)} />
        </div>
      </div>
      <label>Closure note</label>
      <textarea value={cnote} onChange={(e) => setCnote(e.target.value)} />
    </ModalFrame>
  );
}
