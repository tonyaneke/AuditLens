import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { SessionUser } from "./permissions";

export const AUDIT_CATEGORIES = [
  "auth",
  "user",
  "data",
  "workspace",
  "security",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

// Client-reported audit actions may be any "<area>.<event>" slug EXCEPT areas that only the
// server itself is allowed to assert (sign-ins, user management, security) — otherwise every
// workspace event the app logs (deletions, approvals, status changes…) is silently dropped.
const SERVER_ONLY_ACTION_AREAS = new Set(["auth", "user", "security"]);

export function isClientAuditAction(action: string): boolean {
  const match = /^([a-z][a-z0-9_]*)\.[a-z][a-z0-9_]*$/.exec(action);
  return !!match && !SERVER_ONLY_ACTION_AREAS.has(match[1]);
}

type AuditLogInput = {
  user?: Pick<SessionUser, "id" | "name" | "email"> | null;
  action: string;
  category: AuditCategory;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditLogInput) {
  const summary = input.summary.trim().slice(0, 500);
  if (!summary) return;

  await prisma.auditLog.create({
    data: {
      userId: input.user?.id ?? null,
      userName: input.user?.name?.trim() || "System",
      userEmail: input.user?.email?.trim() || "",
      action: input.action.slice(0, 80),
      category: input.category,
      summary,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

export function categoryForAction(action: string): AuditCategory {
  const prefix = action.split(".")[0];
  if (prefix === "auth") return "auth";
  if (prefix === "user") return "user";
  if (prefix === "data") return "data";
  return "workspace";
}

export function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "auth.login": "Sign in",
    "auth.logout": "Sign out",
    "auth.password_changed": "Password changed",
    "user.created": "User created",
    "user.updated": "User updated",
    "user.deactivated": "User made inactive",
    "user.reactivated": "User made active",
    "user.deleted": "User deleted",
    "data.backup_export": "Backup exported",
    "data.backup_import": "Backup imported",
    "data.reset_all": "All data reset",
    "workspace.audit_created": "Audit created",
    "workspace.audit_updated": "Audit updated",
    "workspace.report_created": "Report created",
    "workspace.observation_created": "Observation created",
    "workspace.department_removed": "Action owner removed",
    "workspace.test_deleted": "Test deleted",
    "obs.raised": "Observation raised",
    "obs.raise_requested": "Observation submitted for approval",
    "obs.approved": "Observation approved",
    "obs.rejected": "Observation rejected",
    "obs.update": "Observation update posted",
    "obs.update_requested": "Observation edit requested",
    "obs.update_approved": "Observation edit approved",
    "obs.update_rejected": "Observation edit rejected",
    "obs.status_changed": "Observation status changed",
    "obs.status_change_requested": "Status change requested",
    "obs.status_change_approved": "Status change approved",
    "obs.status_change_rejected": "Status change rejected",
    "obs.reassigned": "Observation reassigned",
    "obs.progress_requested": "Progress report requested",
    "obs.ready_for_closure": "Marked ready for closure",
    "obs.report_verified": "Closure report verified",
    "obs.closure_rejected": "Closure rejected",
    "obs.closure_escalated": "Closure escalated",
    "obs.closed": "Observation closed",
    "obs.deleted": "Observation deleted",
    "obs.delete_requested": "Observation deletion requested",
    "obs.delete_approved": "Observation deletion approved",
    "obs.delete_rejected": "Observation deletion rejected",
    "obs.review_requested": "Observation review requested",
    "obs.review_declined": "Observation review declined",
    "obs.withdraw_forwarded": "Withdrawal forwarded",
    "obs.withdrawn": "Observation withdrawn",
    "obs.withdraw_rejected": "Withdrawal rejected",
    "plan.year_created": "Annual plan opened",
    "plan.completed": "Engagement completed",
    "plan.completion_requested": "Completion approval requested",
    "plan.completion_approved": "Completion approved",
    "plan.completion_rejected": "Completion rejected",
    "plan.unit_deleted": "Auditable unit deleted",
    "fraud.risk_deleted": "Fraud risk deleted",
    "process.review_deleted": "Process review deleted",
    "process.step_deleted": "Process step deleted",
    "iasa.deleted": "Self-assessment deleted",
    "ext.raised": "External finding added",
    "ext.assigned": "External finding assigned",
    "exco.generated": "EXCO brief generated",
    "exco.sent": "EXCO brief sent",
    "exco.brief_deleted": "EXCO brief deleted",
  };
  if (labels[action]) return labels[action];
  // Fallback: humanize "<area>.<event>" so unknown actions still read well in the trail.
  const event = action.split(".")[1] || action;
  const words = event.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
