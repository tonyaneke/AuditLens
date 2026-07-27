"use client";

// Audit domain dialogs: Audit edit, Report edit, Terms of Reference, Audit Plan & Tests, Executive Summary edit.

import { useState } from "react";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { logAudit } from "@/lib/client/audit-log";
import { useDirectoryUsers } from "@/components/external/use-directory";
import { exportTORWord } from "@/lib/client/word";
import { AUDIT_STATUS, ASSURANCE } from "@/lib/workspace/observations";
import { uid } from "@/lib/workspace/selectors";
import type { Audit, AuditTest, AuditPlan, Report } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/* ---------------- Audit Add/Edit Modal ---------------- */

export function ModalAuditDialog({ auditId }: { auditId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
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
          id: uid(),
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
          id: uid(),
          title: title.trim(),
          refNo: refNo.trim(),
          period: period.trim(),
          status: status as Report["status"],
          kind,
          scope: scope.trim(),
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

  const [ref, setRef] = useState(test?.ref || `T${tests.length + 1}`);
  const [name, setName] = useState(test?.name || "");
  const [objective, setObjective] = useState(test?.objective || "");
  const [control, setControl] = useState(test?.control || "");
  const [result, setResult] = useState<AuditTest["result"]>(test?.result || "Not Tested");
  const [notes, setNotes] = useState(test?.notes || "");

  function save() {
    if (!name.trim()) return;
    mutate((d) => {
      const cur = (d.audits || []).find((x) => x.id === auditId);
      if (!cur) return;
      const curPlan: AuditPlan = (cur.plan as AuditPlan | undefined) || { scope: "", objectives: [], keyRisks: [], tests: [] };
      cur.plan = curPlan;
      curPlan.tests = curPlan.tests || [];
      if (test) {
        const t = curPlan.tests.find((x) => x.id === test.id);
        if (t) {
          t.ref = ref;
          t.name = name;
          t.objective = objective;
          t.control = control;
          t.result = result;
          t.notes = notes;
        }
      } else {
        curPlan.tests.push({
          id: uid(),
          ref,
          name,
          objective,
          control,
          result,
          notes,
        });
      }
    });
    toast("Audit test saved", "success");
    modal.close();
  }

  return (
    <ModalFrame
      title={test ? "Edit Audit Test" : "Add Audit Test"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn pri" type="button" onClick={save}>
            Save Test
          </button>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Test Ref</label>
          <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
        <div>
          <label>Test Result</label>
          <select value={result} onChange={(e) => setResult(e.target.value as AuditTest["result"])}>
            <option value="Not Tested">Not Tested</option>
            <option value="Passed">Passed</option>
            <option value="Exception">Exception</option>
            <option value="Partial">Partial</option>
            <option value="N/A">N/A</option>
          </select>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Test Name / Procedure *</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Control / Population Under Test</label>
        <input type="text" value={control} onChange={(e) => setControl(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Audit Objective</label>
        <textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <label>Testing Notes / Findings</label>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
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
