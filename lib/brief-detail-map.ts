/* Maps live workspace records into serialisable brief detail snapshots — mirrors what action
   owners see on ObsDetailPage / ExtFindingDetailPage / FraudRiskDetailPage. */

import { deptLabel, deptNameOf } from "@/lib/dept-scope";
import { obsThread } from "@/lib/workspace/observations";
import { effectiveClose, fmtDate, fmtDateTime, isoToDate, isOverdueObs, obsAge } from "@/lib/workspace/selectors";
import type { EvidenceFile, ExtFinding, Observation, Report } from "@/lib/workspace/types";

type BriefReport = Pick<Report, "reportDateISO" | "reportDate">;

export type BriefFile = { name: string };

export type BriefThreadEntry = {
  byName: string;
  role: string;
  at: string;
  text: string;
  kind?: string;
  tag?: string;
  evidence: BriefFile[];
};

export type BriefVerifyStep = {
  label: string;
  state: "pending" | "done" | "returned";
  who?: string;
  at?: string;
  note?: string;
};

export type BriefIssueDetail = {
  ref: string;
  title: string;
  criticality: string;
  status: string;
  category: string;
  department: string;
  repeat: boolean;
  repeatOf: string;
  owner: string;
  secondaryOwner: string;
  timeline: string;
  targetClose: string;
  overdue: boolean;
  age: string;
  createdAt: string;
  audit: string;
  area: string;
  description: string;
  criteria: string;
  risk: string;
  rootCause: string;
  recommendation: string;
  sopUpdate: string;
  managementResponse: string;
  attachments: BriefFile[];
  verifySteps: BriefVerifyStep[];
  thread: BriefThreadEntry[];
  progressReport: string;
  closedFooter: string;
};

export type BriefExtDetail = {
  ref: string;
  title: string;
  severity: string;
  status: string;
  source: string;
  sourceRef: string;
  theme: string;
  department: string;
  repeat: boolean;
  repeatOf: string;
  owner: string;
  secondaryOwner: string;
  year: string;
  target: string;
  overdue: boolean;
  closedDate: string;
  verifiedBy: string;
  detail: string;
  risk: string;
  recommendation: string;
  managementResponse: string;
  closureEvidence: string;
  verifySteps: BriefVerifyStep[];
  thread: BriefThreadEntry[];
  closedFooter: string;
};

export type BriefFraudAction = {
  text: string;
  type: string;
  status: string;
  owner: string;
  targetDate: string;
  update: string;
};

export type BriefFraudDetail = {
  scheme: string;
  res: string;
  inh: string;
  category: string;
  process: string;
  year: string;
  likelihood: number;
  impact: number;
  score: number;
  controlStrength: string;
  owner: string;
  status: string;
  description: string;
  existingControls: string;
  preventionAction: string;
  actions: BriefFraudAction[];
};

type Audit = { name?: string; area?: string };
type Data = { departments?: unknown[]; users?: Array<{ id?: string; name?: string }> };

function filesOf(list?: EvidenceFile[]): BriefFile[] {
  return (list || []).filter((f) => f?.name).map((f) => ({ name: String(f.name) }));
}

function resolveSecondaryOwner(data: Data, rec: { secondaryOwner?: string; secondaryOwnerUserId?: string }) {
  if (rec.secondaryOwner) return String(rec.secondaryOwner);
  const id = rec.secondaryOwnerUserId;
  if (!id) return "";
  return String((data.users || []).find((u) => u.id === id)?.name || "");
}

function roleLabel(role: string) {
  if (role === "action_owner") return "Action owner";
  if (role === "audit_staff") return "Internal Audit";
  if (role === "head_of_audit") return "Head of Audit";
  return role || "—";
}

function threadOf(o: Observation): BriefThreadEntry[] {
  return obsThread(o, true)
    .slice()
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .map((e) => ({
      byName: e.byName || "—",
      role: roleLabel(String(e.role || "")),
      at: e.at ? fmtDateTime(e.at) : "",
      text: e.text || "",
      kind: e.kind,
      tag: e.tag,
      evidence: filesOf(e.evidence),
    }))
    .filter((e) => e.text || e.evidence.length);
}

function verifyStepsOf(o: Observation): BriefVerifyStep[] {
  const rej = o.closureRejection || null;
  const ownerReturned = !o.ownerRectifiedAt && rej?.prevOwnerRectified;
  const auditorReturned = !o.reportVerifiedAt && rej?.prevReportVerified;
  const returnedBy =
    rej?.byName || (rej?.byRole === "audit_staff" ? "Internal Audit" : rej?.byRole ? "the Head" : "");

  const steps: BriefVerifyStep[] = [
    { label: "Raised", state: o.raisedAt ? "done" : "pending", who: o.raisedByName, at: o.raisedAt ? fmtDateTime(o.raisedAt) : "" },
    ownerReturned
      ? {
          label: "Ready for closure",
          state: "returned",
          who: rej!.prevOwnerRectified!.byName,
          at: rej!.prevOwnerRectified!.at ? fmtDateTime(rej!.prevOwnerRectified!.at) : "",
          note: returnedBy ? `Returned by ${returnedBy}` : "Returned",
        }
      : {
          label: "Ready for closure",
          state: o.ownerRectifiedAt ? "done" : "pending",
          who: o.ownerRectifiedByName,
          at: o.ownerRectifiedAt ? fmtDateTime(o.ownerRectifiedAt) : "",
        },
    auditorReturned
      ? {
          label: "Auditor verified",
          state: "returned",
          who: rej!.prevReportVerified!.byName,
          at: rej!.prevReportVerified!.at ? fmtDateTime(rej!.prevReportVerified!.at) : "",
          note: returnedBy ? `Returned by ${returnedBy}` : "Returned",
        }
      : {
          label: "Auditor verified",
          state: o.reportVerifiedAt ? "done" : "pending",
          who: o.reportVerifiedByName,
          at: o.reportVerifiedAt ? fmtDateTime(o.reportVerifiedAt) : "",
        },
    {
      label: "Head verified & closed",
      state: o.headVerifiedAt ? "done" : "pending",
      who: o.headVerifiedByName,
      at: o.closedDateISO ? fmtDate(isoToDate(o.closedDateISO)) || fmtDateTime(o.closedDateISO) : o.headVerifiedAt ? fmtDateTime(o.headVerifiedAt) : "",
    },
  ];
  return steps;
}

function closedFooterOf(o: Observation) {
  if (o.status !== "Closed") return "";
  const parts = [
    `Closed${o.closedDateISO ? " " + (fmtDate(isoToDate(o.closedDateISO)) || o.closedDateISO) : ""}`,
    `Verified by ${o.headVerifiedByName || o.verifiedBy || "—"}`,
  ];
  if (o.raisedByName) parts.push(`Raised by ${o.raisedByName}`);
  if (o.reportVerifiedByName) parts.push(`Verified by auditor ${o.reportVerifiedByName}`);
  return parts.join(" · ");
}

function progressReportOf(o: Observation) {
  const p = o.progressReport;
  if (!p?.at) return "";
  return `${p.byName || "Someone"} requested a progress report · ${fmtDateTime(p.at)}`;
}

export function mapBriefIssueDetail(
  o: Observation,
  audit: Audit,
  report: BriefReport,
  data: Data,
): BriefIssueDetail {
  const rep = report as Report;
  const ec = effectiveClose(o, rep);
  const ageN = obsAge(o, rep);
  const dept = deptLabel(deptNameOf(data, o));
  return {
    ref: o.ref || "",
    title: o.title || "",
    criticality: o.criticality || "",
    status: o.status || "Open",
    category: o.category || "",
    department: dept,
    repeat: !!o.isRepeat,
    repeatOf: o.repeatOf || "",
    owner: o.owner || "—",
    secondaryOwner: resolveSecondaryOwner(data, o),
    timeline: String(o.timeline || ""),
    targetClose: fmtDate(ec),
    overdue: isOverdueObs(o, rep),
    age: ageN == null ? "" : `${ageN} day${ageN !== 1 ? "s" : ""}${o.status === "Closed" ? " to close" : ""}`,
    createdAt: o.createdAt ? fmtDateTime(o.createdAt) : "",
    audit: audit.name || "",
    area: (audit.name || "") + (audit.area ? " · " + audit.area : ""),
    description: o.description || "",
    criteria: o.criteria || "",
    risk: o.risk || "",
    rootCause: o.rootCause || "",
    recommendation: o.recommendation || "",
    sopUpdate: o.sopUpdate || "",
    managementResponse: o.managementResponse || "",
    attachments: filesOf(o.attachments),
    verifySteps: verifyStepsOf(o),
    thread: threadOf(o),
    progressReport: progressReportOf(o),
    closedFooter: closedFooterOf(o),
  };
}

export function mapBriefExtDetail(f: ExtFinding, data: Data): BriefExtDetail {
  const obs = f as unknown as Observation;
  const target = f.targetDate || f.dueDate || "";
  const targetDate = target ? fmtDate(isoToDate(target)) || target : "Not specified";
  const closed = f.closedDateISO ? fmtDate(isoToDate(f.closedDateISO)) || f.closedDateISO : "";
  return {
    ref: f.ref || "",
    title: f.title || "",
    severity: f.severity || "—",
    status: f.status || "Open",
    source: f.source || "—",
    sourceRef: f.sourceRef || "",
    theme: f.theme || "",
    department: deptLabel(deptNameOf(data, f)),
    repeat: !!f.isRepeat,
    repeatOf: f.repeatOf || "",
    owner: f.owner || "Unassigned",
    secondaryOwner: resolveSecondaryOwner(data, f),
    year: String(f.year || ""),
    target: targetDate,
    overdue: f.status !== "Closed" && !!target && !!isoToDate(target) && isoToDate(target)! < new Date(new Date().setHours(0, 0, 0, 0)),
    closedDate: closed,
    verifiedBy: f.verifiedBy || "",
    detail: f.detail || "",
    risk: f.risk || "",
    recommendation: f.recommendation || "",
    managementResponse: String(f.managementResponse || (f as { response?: string }).response || ""),
    closureEvidence: f.closureEvidence || "",
    verifySteps: verifyStepsOf(obs),
    thread: threadOf(obs),
    closedFooter: closedFooterOf(obs),
  };
}

export function mapBriefFraudDetail(f: Record<string, unknown>): BriefFraudDetail {
  const likelihood = Number(f.likelihood || 0);
  const impact = Number(f.impact || 0);
  const score = likelihood * impact;
  const inh =
    score <= 4 ? "Low" : score <= 9 ? "Medium" : score <= 14 ? "High" : "Extreme";
  const acts = Array.isArray(f.actions) ? f.actions : [];
  return {
    scheme: String(f.scheme || ""),
    res: String(f.res || f.residualOverride || ""),
    inh,
    category: String(f.category || "—"),
    process: String(f.process || ""),
    year: String(f.year || ""),
    likelihood,
    impact,
    score,
    controlStrength: String(f.controlStrength || "—"),
    owner: String(f.owner || "—"),
    status: String(f.status || "Identified"),
    description: String(f.description || f.narrative || ""),
    existingControls: String(f.existingControls || ""),
    preventionAction: String(f.preventionAction || ""),
    actions: acts.map((a: Record<string, unknown>) => ({
      text: String(a.text || ""),
      type: String(a.type || ""),
      status: String(a.status || ""),
      owner: String(a.owner || ""),
      targetDate: String(a.targetDate || ""),
      update: String(a.update || ""),
    })),
  };
}

/** Full detail snapshot — list rows on the brief main page read the same fields. */
export function issueListFields(d: BriefIssueDetail): BriefIssueDetail {
  return d;
}

export function repeatListFields(d: BriefIssueDetail): BriefIssueDetail {
  return d;
}
