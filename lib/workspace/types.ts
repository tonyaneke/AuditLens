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
  /** Who returned it — the Head signing off, or the auditor verifying the owner's response.
   *  Absent on records written before auditor-initiated returns existed (treat as the Head). */
  byRole?: "head_of_audit" | "audit_staff" | string;
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
  /** Supporting documents Internal Audit attached when raising (working papers, extracts,
   *  correspondence). Distinct from the evidence on `updates`, which is the conversation trail:
   *  these are the basis of the finding itself and are set at raise time. */
  attachments?: EvidenceFile[];
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
  /** Auditor closure evidence — prefer this over closureFile when present. */
  closureFiles?: EvidenceFile[];
  closureRejection?: ClosureRejection | null;
  progressReport?: { by: string; byName: string; at: string } | null;
  updateRequestedAt?: string;
  withdrawn?: boolean;
  withdrawnAt?: string;
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

export type AuditTest = {
  id: string;
  ref: string;
  /** Legacy field name for the test name (audit-bot.js writes `title`). */
  title?: string;
  /** Earlier React shell wrote `name`; kept mirrored for old rows. */
  name?: string;
  objective?: string;
  procedure?: string;
  /** Legacy field name (audit-bot.js writes `controlTested`). */
  controlTested?: string;
  /** Earlier React shell wrote `control`; kept mirrored for old rows. */
  control?: string;
  population?: string;
  sampleBasis?: string;
  result?: "Not Tested" | "Passed" | "Exception" | "Partial" | "N/A";
  /** Legacy fieldwork-result fields. */
  resultNotes?: string;
  /** Earlier React shell wrote `notes`; kept mirrored for old rows. */
  notes?: string;
  evidenceRef?: string;
  testedBy?: string;
  testedDate?: string;
  [k: string]: unknown;
};

export type AuditPlan = {
  scope?: string;
  objectives?: string[];
  keyRisks?: string[];
  tests?: AuditTest[];
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
  plan?: AuditPlan;
  tor?: Record<string, string | undefined>;
  [k: string]: unknown;
};


export type FraudAction = {
  id: string;
  text: string;
  type?: string;
  owner?: string;
  /** Assigned action owner's user id (department head) — set via the action dialog. */
  ownerUserId?: string;
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
  /** Pre-actions-migration single prevention action (legacy field; still written by AI import). */
  preventionAction?: string;
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
  sourceRef?: string;
  year?: string;
  ref?: string;
  theme?: string;
  severity?: string;
  title: string;
  detail?: string;
  risk?: string;
  recommendation?: string;
  managementResponse?: string;
  owner?: string;
  ownerUserId?: string;
  secondaryOwner?: string;
  secondaryOwnerUserId?: string;
  departmentId?: string;
  targetDate?: string;
  /** Closure date set by the raise/assign flows (mirrors targetDate). */
  dueDate?: string;
  status?: string;
  isRepeat?: boolean;
  repeatOf?: string;
  verifiedBy?: string;
  closureEvidence?: string;
  closedDateISO?: string;
  /** Set by the raise-with-owner flow (saveExtRaise). */
  isExternal?: boolean;
  raisedBy?: string;
  raisedByName?: string;
  raisedAt?: string;
  /* Remediation / verification chain — same stamps the legacy shared obs workflow writes. */
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
  closureNote?: string;
  closureFile?: EvidenceFile | null;
  /** Auditor closure evidence — prefer this over closureFile when present. */
  closureFiles?: EvidenceFile[];
  closureDate?: string;
  closureRejection?: ClosureRejection | null;
  progressReport?: { by: string; byName: string; at: string } | null;
  updateRequestedAt?: string;
  updateRequestedBy?: string;
  withdrawn?: boolean;
  withdrawal?: { stage: string; [k: string]: unknown } | null;
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

/* ---- process & control effectiveness reviews ---- */

export type ProcFinding = {
  id: string;
  category?: string;
  title: string;
  detail?: string;
  recommendation?: string;
  severity?: string;
  [k: string]: unknown;
};

export type ProcStep = {
  id: string;
  actor?: string;
  action: string;
  /** "start" | "step" | "control" | "decision" | "end" */
  type?: string;
  note?: string;
  [k: string]: unknown;
};

export type ProcessReview = {
  id: string;
  unit?: string;
  sopTitle?: string;
  sopFileName?: string;
  /** Original SOP PDF (base64, no data: prefix) kept for AI redesign context. Stored
   * server-side only — /api/data GET strips it (and sets sopPdfStored) so the multi-MB
   * PDFs never ride in the workspace payload; /api/data PUT grafts it back. */
  sopPdfBase64?: string;
  /** True when a SOP PDF is stored for this review (the base64 itself is server-side). */
  sopPdfStored?: boolean;
  period?: string;
  overallRating?: string;
  summary?: string;
  findings?: ProcFinding[];
  keyRecommendations?: string[];
  proposedSummary?: string;
  proposedSteps?: ProcStep[];
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
  /* QAIP improvement tracking — the action's lifecycle on the Improvement Tracker tab. */
  status?: "Not started" | "In progress" | "Implemented" | "Closed" | string;
  progress?: string;
  done?: string;
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
  /** Quality Improvement Programme (Improvement Tracker tab) reporting metadata. */
  qaip?: { period?: string; commentary?: string };
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
  /** observation_status_change: the status when the change was requested. */
  fromStatus?: string;
  /** observation_update: the proposed replacement field values. */
  changes?: Record<string, unknown>;
  /** observation_withdraw: the action owner's reason. */
  reason?: string;
  /** observation_withdraw: Internal Audit's note when forwarding to the Head. */
  forwardNote?: string;
  /** observation_withdraw: the Head's decision reason. */
  headReason?: string;
  /** observation_raise: the assigned primary action owner. */
  ownerUserId?: string;
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
  /** Settings → MD & EXCO brief recipients (the field name the legacy script actually writes). */
  recipientList?: { id: string; name?: string; role?: string; email: string }[];
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
  processReviews?: ProcessReview[];
  extFindings?: ExtFinding[];
  extCommentary?: string;
  iaSAList?: IaSaRecord[];
  iaSACurrentId?: string;
  /** Plan years opened from "New audit plan" (planYear is the one currently in view). */
  planYears?: (string | number)[];
  departments?: Department[];
  /** Settings → closure response check. When true the AI check blocks every submission it judges
   *  vague; when false (the default) it advises once per round and the next Submit goes through. */
  strictClosureCheck?: boolean;
  notifications?: NotificationItem[];
  approvals?: Approval[];
  exco?: ExcoMeta;
  caeReport?: { period?: string; commentary?: string };
  [k: string]: unknown;
};

export function defaultWorkspace(): WorkspaceDb {
  return { org: "Audit Management System", audits: [] };
}
