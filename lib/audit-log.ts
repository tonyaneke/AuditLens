import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { SessionUser } from "./permissions";

export const AUDIT_CATEGORIES = [
  "auth",
  "user",
  "data",
  "workspace",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const CLIENT_AUDIT_ACTIONS = new Set([
  "data.backup_export",
  "data.backup_import",
  "data.reset_all",
  "workspace.audit_created",
  "workspace.audit_updated",
  "workspace.report_created",
  "workspace.observation_created",
]);

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
    "user.deleted": "User deleted",
    "data.backup_export": "Backup exported",
    "data.backup_import": "Backup imported",
    "data.reset_all": "All data reset",
    "workspace.audit_created": "Audit created",
    "workspace.audit_updated": "Audit updated",
    "workspace.report_created": "Report created",
    "workspace.observation_created": "Observation created",
  };
  return labels[action] || action;
}
