// A complete, concluded sample engagement for audit communications — the one place its content is
// written, shared by scripts/seed-concluded-audit.mts (puts it in the workspace) and
// scripts/send-comms-email-samples.mts (renders every e-mail it would produce). So the e-mails you
// receive as samples describe exactly the engagement you can open in the app.
//
// It is addressed to TEST_DEPT, a department only the tester belongs to (scripts/seed-comms-test.mts
// sets that up), and carries no observations — raising one would ask the Head of Audit to approve it.
import { closeoutFromReport, formatTiming, noticeTemplate } from "../lib/workspace/audit-comms";
import type { Audit, AuditRequest, Report } from "../lib/workspace/types";

export const TEST_DEPT = "AuditLens Test";
export const SAMPLE_AUDIT_ID = "test-comms-concluded";
export const SAMPLE_REPORT_ID = "test-comms-concluded-report";

export type Tester = { id: string; name: string };

export function sampleConcludedAudit(tester: Tester): { audit: Audit; requests: AuditRequest[] } {
  const report: Report = {
    id: SAMPLE_REPORT_ID,
    title: "[TEST] Vendor Payments — Internal Audit Report",
    refNo: "IA/TEST/002",
    period: "Q3 2026",
    status: "Final",
    kind: "Audit report",
    reportDate: "22 August 2026",
    reportDateISO: "2026-08-22",
    createdAt: "2026-08-11T09:00:00.000Z",
    objective:
      "To assess the adequacy and operating effectiveness of controls over vendor onboarding, invoice processing and payment approval for July–September 2026.",
    outOfScope: "Payroll payments\nTax remittances\nPetty cash",
    strengths:
      "Vendor onboarding forms were complete and approved for all 25 vendors sampled.\nEvery payment sampled was approved in the system within delegated limits.\nThe vendor master file is reviewed monthly by Finance, with evidence retained.",
    areasForImprovement:
      "Automate the three-way match so that manual overrides are system-logged and reviewed.\nIntroduce a quarterly review of dormant vendors on the master file.\nAgree a service level for supplier statement reconciliations.",
    auditOpinion:
      "Based on the audit work performed, Internal Audit provides High Assurance that controls over vendor onboarding, invoice processing and payment approval are adequately designed and operating effectively. The improvement opportunities noted above would strengthen the control environment further but do not represent significant exposures.",
    assuranceLevel: "High assurance",
    conclusion:
      "Controls over vendor payments are generally adequate and operating effectively. Management has agreed the improvement actions above, with target dates by 31 December 2026, and Internal Audit will follow them up through the platform.",
    execSummaryNarrative: "",
    observations: [],
  };

  const audit: Audit = {
    id: SAMPLE_AUDIT_ID,
    name: "[TEST] Vendor Payments Process Audit",
    type: "process",
    area: TEST_DEPT,
    period: "Q3 2026",
    leadAuditorId: tester.id,
    leadAuditor: tester.name,
    status: "Completed",
    createdAt: "2026-07-01T08:00:00.000Z",
    plan: {
      scope:
        "Vendor onboarding, invoice processing and payment approval at head office for July–September 2026, covering the vendor master file, purchase orders, goods-received notes and payment approvals in the system.",
      objectives: [
        "Confirm that vendors are approved and due-diligenced before their first payment.",
        "Confirm that invoices are matched to a purchase order and goods-received note before payment.",
        "Confirm that payments are approved within delegated limits.",
      ],
      keyRisks: [
        "Payments to fictitious or unapproved vendors.",
        "Duplicate or unsupported invoices being paid.",
        "Payments approved beyond delegated authority.",
      ],
      tests: [
        { id: "test-cc-t1", ref: "T1", title: "Vendor approval before first payment", objective: "Sample 25 new vendors", result: "Passed" },
        { id: "test-cc-t2", ref: "T2", title: "Three-way match", objective: "Sample 40 payments", result: "Passed" },
        { id: "test-cc-t3", ref: "T3", title: "Approval within delegated limits", objective: "All payments above ₦5m", result: "Passed" },
      ],
    },
    tor: {
      addressee: `Head of Department — ${TEST_DEPT}`,
      date: "2026-07-01",
      timingFrom: "2026-07-14",
      timingTo: "2026-08-08",
      timing: formatTiming("2026-07-14", "2026-08-08"),
      background:
        "Vendor payments are the largest outflow outside payroll and were rated High in the 2026 risk-based internal audit plan. This engagement gives management assurance that only approved vendors are paid, for goods and services actually received, within delegated authority.",
      outOfScope: "Payroll payments\nTax remittances\nPetty cash",
      infoRequired:
        "Vendor master file extract as at 30 June 2026\nPayments listing, July–September 2026\nDelegation of authority matrix\nRead-only access to the payments module",
      reportingTo: "Executive Management and the Board Audit Committee",
    },
    reports: [report],
  };

  audit.notice = {
    text: noticeTemplate(audit),
    departments: [TEST_DEPT],
    issuedAt: "2026-07-01T09:00:00.000Z",
    issuedBy: tester.id,
    issuedByName: tester.name,
  };
  audit.closeout = {
    ...closeoutFromReport(report),
    departments: [TEST_DEPT],
    issuedAt: "2026-08-25T10:00:00.000Z",
    issuedBy: tester.id,
    issuedByName: tester.name,
  };

  const requests: AuditRequest[] = [
    {
      id: "test-cc-ir01",
      auditId: SAMPLE_AUDIT_ID,
      ref: "IR-01",
      kind: "information",
      department: TEST_DEPT,
      subject: "Vendor master file extract",
      text: "Please send the vendor master file as at 30 June 2026, with each vendor's approval date and approver.",
      dueDate: "2026-07-22",
      raisedBy: tester.id,
      raisedByName: tester.name,
      side: "ia",
      raisedAt: "2026-07-15T09:30:00.000Z",
      messages: [
        { id: "test-cc-m1", by: tester.id, byName: tester.name, side: "dept", at: "2026-07-18T14:05:00.000Z", text: "Here is the extract as at 30 June 2026. Approval dates are in column F, approvers in column G." },
        { id: "test-cc-m2", by: tester.id, byName: tester.name, side: "ia", at: "2026-07-19T08:40:00.000Z", text: "Received, thank you — this covers what we need." },
      ],
      closedAt: "2026-07-19T08:41:00.000Z",
      closedBy: tester.id,
      closedByName: tester.name,
    },
    {
      id: "test-cc-cr01",
      auditId: SAMPLE_AUDIT_ID,
      ref: "CR-01",
      kind: "clarification",
      department: TEST_DEPT,
      subject: "Period covered by the payments sample",
      text: "Does the payments sample cover July only, or the whole quarter? We want to pull the right supporting documents.",
      raisedBy: tester.id,
      raisedByName: tester.name,
      side: "dept",
      raisedAt: "2026-07-16T11:15:00.000Z",
      messages: [
        { id: "test-cc-m3", by: tester.id, byName: tester.name, side: "ia", at: "2026-07-16T15:20:00.000Z", text: "The whole quarter — July to September 2026. We will share the sample list by Friday." },
      ],
      closedAt: "2026-07-17T09:00:00.000Z",
      closedBy: tester.id,
      closedByName: tester.name,
    },
  ];

  return { audit, requests };
}
