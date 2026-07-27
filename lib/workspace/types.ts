// Typed model of the workspace blob stored in WorkspaceData.data (single row, id "default").
// Shapes are derived from public/audit-bot.js (defaultDB/saveObs/resetAllData and the lifecycle
// stamps) and lib/workspace-authz.ts. The legacy script freely adds fields, so every entity keeps
// an index-signature escape hatch — type the fields the React shell reads/writes, tolerate the rest.

export type Criticality =
  | "Critical"
  | "High"
  | "Moderate"
  | "Low"
  | "Process Improvement";
export type ObsStatus = "Open" | "In Progress" | "Closed";
export type Timeline = "Immediate" | "Short-term" | "Long-term";

export type EvidenceFile = {
  itemId: string;
  webUrl?: string;
  name: string;
  size?: number;
};

export type ObsUpdate = {
  id: string;
  by: string;
  byName: string;
  role: string;
  at: string;
  text: string;
  evidence: EvidenceFile[];
  /** "" = normal (to IA, visible to all) · "owner" = private co-owner note · "ia_only" = hidden from owners */
  audience?: "" | "owner" | "ia_only";
  kind?: "comment" | "progress";
};

export type ClosureRejection = {
  target: "auditor" | "owner";
  note: string;
  by?: string;
  byName?: string;
  at?: string;
  prevOwnerRectified?: { at: string; byName: string } | null;
  prevReportVerified?: { at: string; byName: string } | null;
};

export type Observation = {
  id: string;
  ref?: string;
  title: string;
  category?: string;
  description?: string;
  criteria?: string;
  risk?: string;
  rootCause?: string;
  recommendation?: string;
  sopUpdate?: string;
  criticality: Criticality;
  managementResponse?: string;
  owner?: string;
  ownerUserId?: string;
  secondaryOwnerUserId?: string;
  departmentId?: string;
  timeline?: Timeline | string;
  dueDate?: string;
  status?: ObsStatus | string;
  closedDateISO?: string;
  isRepeat?: boolean;
  repeatOf?: string;
  createdAt?: string;
  obsApproval?: "pending" | "approved" | "rejected";
  raisedBy?: string;
  raisedByName?: string;
  raisedAt?: string;
  ownerResponse?: string;
  ownerResponseEvidence?: EvidenceFile[];
  ownerRectifiedBy?: string;
  ownerRectifiedByName?: string;
  ownerRectifiedAt?: string;
  reportVerifiedBy?: string;
  reportVerifiedByName?: string;
  reportVerifiedAt?: string;
  headVerifiedBy?: string;
  headVerifiedByName?: string;
  headVerifiedAt?: string;
  headComment?: string;
  verifiedBy?: string;
  closureEvidence?: string;
  closureNote?: string;
  closureFile?: EvidenceFile | null;
  closureRejection?: ClosureRejection | null;
  progressReport?: { by: string; byName: string; at: string } | null;
  updateRequestedAt?: string;
  withdrawn?: boolean;
  withdrawal?: { stage: string; [k: string]: unknown } | null;
  notes?: unknown[];
  updates?: ObsUpdate[];
  [k: string]: unknown;
};

export type Report = {
  id: string;
  title: string;
  refNo?: string;
  period?: string;
  status?: string;
  kind?: string;
  scope?: string;
  reportDate?: string;
  reportDateISO?: string;
  createdAt?: string;
  objective?: string;
  outOfScope?: string;
  strengths?: string;
  areasForImprovement?: string;
  auditOpinion?: string;
  conclusion?: string;
  assuranceLevel?: string;
  execSummaryNarrative?: string;
  observations: Observation[];
  [k: string]: unknown;
};

export type Audit = {
  id: string;
  name: string;
  type?: string;
  area?: string;
  period?: string;
  leadAuditorId?: string;
  leadAuditor?: string;
  status?: string;
  createdAt?: string;
  reports: Report[];
  [k: string]: unknown;
};

export type FraudAction = {
  id: string;
  text: string;
  type?: string;
  owner?: string;
  targetDate?: string;
  status?: "Planned" | "In Progress" | "Implemented" | string;
  update?: string;
  ownerUpdates?: { at: string; by: string; byName: string; text: string; status?: string }[];
  [k: string]: unknown;
};

export type FraudRisk = {
  id: string;
  year?: string;
  process?: string;
  category?: string;
  scheme: string;
  description?: string;
  likelihood: number;
  impact: number;
  existingControls?: string;
  controlStrength?: string;
  residualOverride?: string;
  ownerUserId?: string;
  owner?: string;
  departmentId?: string;
  status?: string;
  actions?: FraudAction[];
  createdAt?: string;
  [k: string]: unknown;
};

export type ExtFinding = {
  id: string;
  source?: string;
  year?: string;
  ref?: string;
  theme?: string;
  severity?: string;
  title: string;
  owner?: string;
  ownerUserId?: string;
  secondaryOwnerUserId?: string;
  targetDate?: string;
  status?: string;
  isRepeat?: boolean;
  closedDateISO?: string;
  updates?: ObsUpdate[];
  createdAt?: string;
  [k: string]: unknown;
};

export type AuditUniverseUnit = {
  id: string;
  name: string;
  category?: string;
  owner?: string;
  factors?: Record<string, number>;
  lastAudited?: string;
  plannedPeriod?: string;
  includeInPlan?: boolean | null;
  engStatus?: string;
  occDone?: string[];
  linkedAuditIds?: string[];
  /** Pre-multi-link shape kept for reads; writes always use linkedAuditIds. */
  linkedAuditId?: string;
  ratingOverride?: string;
  frequencyOverride?: string;
  rationale?: string;
  /** Plan year this engagement slipped from (set by the rollover). */
  carryOverFrom?: string | number;
  createdAt?: string;
  [k: string]: unknown;
};

/* ---- IA self-assessment against the IIA Global Internal Audit Standards ---- */

export type IaSaStandard = {
  conf?: string;
  evidence?: string;
  gap?: string;
  action?: string;
  owner?: string;
  target?: string;
};

export type IaSaPrinciple = {
  /** Legacy principle-level rating; the rollup from standards supersedes it. */
  conformance?: string;
  maturity?: number;
  notes?: string;
  action?: string;
};

export type IaSaRecord = {
  id: string;
  period?: string;
  assessor?: string;
  scope?: string;
  approach?: string;
  lastEQA?: string;
  commentary?: string;
  items: Record<string, IaSaPrinciple>;
  std: Record<string, IaSaStandard>;
  status?: "in_progress" | "completed" | string;
  startedAt?: string;
  completedAt?: string;
  [k: string]: unknown;
};

export type Approval = {
  id: string;
  kind:
    | "observation_raise"
    | "engagement_completion"
    | "observation_status_change"
    | "observation_update"
    | "observation_delete"
    | "observation_withdraw"
    | string;
  status: "pending" | "approved" | "rejected" | "superseded" | string;
  obsId?: string;
  auditId?: string;
  reportId?: string;
  unitId?: string;
  unitName?: string;
  obsTitle?: string;
  newStatus?: string;
  requestedBy?: string;
  requestedByName?: string;
  requestedAt?: string;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  [k: string]: unknown;
};

export type NotificationItem = {
  id: string;
  userId: string;
  kind: string;
  text: string;
  /** Legacy view name used for navigation (e.g. "myobs", "observation", "approvals", "fraud"). */
  link: string;
  /** Deep-link target: internal observation id or external finding id. */
  obsId?: string;
  read: boolean;
  at: string;
};

export type Department = {
  id: string;
  name: string;
  headName?: string;
  headEmail?: string;
  headUserId?: string;
  createdAt?: string;
};

export type ExcoBrief = {
  id: string;
  period?: string;
  generatedAt?: string;
  token?: string;
  snapshot?: Record<string, unknown>;
  sends?: unknown[];
  [k: string]: unknown;
};

export type ExcoMeta = {
  period?: string;
  headline?: string;
  commentary?: string;
  briefs?: ExcoBrief[];
  recipientsList?: { id: string; name?: string; email: string }[];
  [k: string]: unknown;
};

export type WorkspaceDb = {
  org?: string;
  signOffName?: string;
  signOffTitle?: string;
  logo?: string;
  lastBackup?: string;
  planYear?: string;
  audits: Audit[];
  auditUniverse?: AuditUniverseUnit[];
  fraudRisks?: FraudRisk[];
  fraudPlanNarrative?: string;
  fraudUpdate?: { period?: string; commentary?: string };
  processReviews?: unknown[];
  extFindings?: ExtFinding[];
  extCommentary?: string;
  iaSAList?: IaSaRecord[];
  iaSACurrentId?: string;
  /** Plan years opened from "New audit plan" (planYear is the one currently in view). */
  planYears?: (string | number)[];
  departments?: Department[];
  notifications?: NotificationItem[];
  approvals?: Approval[];
  exco?: ExcoMeta;
  caeReport?: { period?: string; commentary?: string };
  [k: string]: unknown;
};

export function defaultWorkspace(): WorkspaceDb {
  return { org: "Audit Management System", audits: [] };
}
