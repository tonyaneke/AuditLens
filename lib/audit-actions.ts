/* The audit trail's vocabulary: every action the trail records, how it reads, and which of them a
 * browser is still allowed to report.
 *
 * Client-safe on purpose (no Prisma): the audit log page needs the labels and the filter groups,
 * and lib/audit-log.ts needs the same list to validate what it accepts. Two copies of the list is
 * how the old filter came to offer "Audit created" (workspace.audit_created) while every real entry
 * was written as audit.created — the filter matched nothing.
 *
 * WHO WRITES WHAT. Almost everything here is written by the SERVER: sign-ins and user management by
 * their routes, and every change to the workspace document by lib/workspace-changes.ts, which diffs
 * what a save actually persisted. The browser may only report the few things the server cannot see
 * for itself — see CLIENT_AUDIT_ACTIONS. */

export type ActionGroup = { label: string; actions: [action: string, label: string][] };

export const ACTION_GROUPS: ActionGroup[] = [
  {
    label: "Sign-in & sessions",
    actions: [
      ["auth.login", "Signed in"],
      ["auth.logout", "Signed out"],
      ["auth.login_blocked", "Sign-in blocked"],
      ["auth.role_switched", "Admin switched view"],
    ],
  },
  {
    label: "User accounts",
    actions: [
      ["user.created", "User created"],
      ["user.updated", "User updated"],
      ["user.deactivated", "User made inactive"],
      ["user.reactivated", "User made active"],
      ["user.deleted", "User deleted"],
      ["executive.onboarded", "Executive onboarded"],
      ["executive.onboarded_all", "All executives onboarded"],
      ["user.onboarding_test_sent", "Onboarding test e-mail sent"],
    ],
  },
  {
    label: "Audits",
    actions: [
      ["audit.created", "Audit created"],
      ["audit.updated", "Audit details updated"],
      ["audit.deleted", "Audit deleted"],
      ["audit.tor_updated", "Terms of reference updated"],
      ["audit.plan_updated", "Audit programme updated"],
      ["audit.test_added", "Test added"],
      ["audit.test_updated", "Test edited"],
      ["audit.test_result", "Test result recorded"],
      ["audit.test_deleted", "Test deleted"],
    ],
  },
  {
    label: "Reports",
    actions: [
      ["report.created", "Report created"],
      ["report.updated", "Report updated"],
      ["report.deleted", "Report deleted"],
      ["report.cae_updated", "CAE quarterly report updated"],
    ],
  },
  {
    label: "Observations",
    actions: [
      ["obs.raised", "Observation raised"],
      ["obs.raise_requested", "Observation submitted for approval"],
      ["obs.approved", "Observation approved"],
      ["obs.rejected", "Observation rejected"],
      ["obs.edited", "Observation edited"],
      ["obs.reassigned", "Observation reassigned"],
      ["obs.moved", "Observation moved"],
      ["obs.status_changed", "Observation status changed"],
      ["obs.update", "Comment posted"],
      ["obs.update_edited", "Comment edited"],
      ["obs.update_deleted", "Comment deleted"],
      ["obs.owner_update_requested", "Owner update requested"],
      ["obs.progress_requested", "Progress report requested"],
      ["obs.ready_for_closure", "Closure response submitted"],
      ["obs.report_verified", "Remediation verified"],
      ["obs.closure_rejected", "Returned for more work"],
      ["obs.closed", "Observation closed"],
      ["obs.reopened", "Observation reopened"],
      ["obs.deleted", "Observation deleted"],
      ["obs.review_requested", "Withdrawal requested"],
      ["obs.withdraw_forwarded", "Withdrawal forwarded to the Head"],
      ["obs.review_declined", "Withdrawal request declined"],
      ["obs.withdrawn", "Observation withdrawn"],
      ["obs.withdraw_rejected", "Withdrawal rejected"],
      ["obs.withdrawal_cleared", "Withdrawal request cleared"],
      ["obs.reinstated", "Observation reinstated"],
      ["obs.edit_requested", "Edit requested"],
      ["obs.update_approved", "Edit approved"],
      ["obs.update_rejected", "Edit rejected"],
      ["obs.status_change_requested", "Status change requested"],
      ["obs.status_change_approved", "Status change approved"],
      ["obs.status_change_rejected", "Status change rejected"],
      ["obs.delete_requested", "Deletion requested"],
      ["obs.delete_approved", "Deletion approved"],
      ["obs.delete_rejected", "Deletion rejected"],
    ],
  },
  {
    label: "External findings",
    actions: [
      ["ext.raised", "External finding added"],
      ["ext.edited", "External finding edited"],
      ["ext.reassigned", "External finding reassigned"],
      ["ext.status_changed", "External finding status changed"],
      ["ext.update", "Comment posted (external)"],
      ["ext.update_edited", "Comment edited (external)"],
      ["ext.update_deleted", "Comment deleted (external)"],
      ["ext.owner_update_requested", "Owner update requested (external)"],
      ["ext.progress_requested", "Progress report requested (external)"],
      ["ext.ready_for_closure", "Closure response submitted (external)"],
      ["ext.report_verified", "Remediation verified (external)"],
      ["ext.closure_rejected", "Returned for more work (external)"],
      ["ext.closed", "External finding closed"],
      ["ext.reopened", "External finding reopened"],
      ["ext.deleted", "External finding deleted"],
      ["ext.withdrawn", "External finding withdrawn"],
      ["ext.reinstated", "External finding reinstated"],
      ["ext.commentary_updated", "External findings commentary updated"],
    ],
  },
  {
    label: "Fraud risk",
    actions: [
      ["fraud.risk_created", "Fraud risk added"],
      ["fraud.risk_updated", "Fraud risk updated"],
      ["fraud.risk_deleted", "Fraud risk deleted"],
      ["fraud.action_added", "Prevention action added"],
      ["fraud.action_edited", "Prevention action edited"],
      ["fraud.action_assigned", "Prevention action assigned"],
      ["fraud.action_status_updated", "Prevention action status changed"],
      ["fraud.action_validated", "Prevention action validated by IA"],
      ["fraud.action_update", "Implementation update posted"],
      ["fraud.action_deleted", "Prevention action deleted"],
      ["fraud.plan_updated", "Fraud plan narrative updated"],
    ],
  },
  {
    label: "Annual plan",
    actions: [
      ["plan.year_created", "Annual plan opened"],
      ["plan.year_removed", "Annual plan removed"],
      ["plan.unit_created", "Auditable unit added"],
      ["plan.unit_updated", "Auditable unit updated"],
      ["plan.unit_deleted", "Auditable unit deleted"],
      ["plan.completed", "Engagement completed"],
      ["plan.completion_requested", "Completion approval requested"],
      ["plan.completion_approved", "Completion approved"],
      ["plan.completion_rejected", "Completion rejected"],
    ],
  },
  {
    label: "Process reviews",
    actions: [
      ["process.review_created", "Process review created"],
      ["process.review_updated", "Process review updated"],
      ["process.review_deleted", "Process review deleted"],
    ],
  },
  {
    label: "Self-assessment",
    actions: [
      ["iasa.created", "Self-assessment started"],
      ["iasa.updated", "Self-assessment updated"],
      ["iasa.completed", "Self-assessment completed"],
      ["iasa.deleted", "Self-assessment deleted"],
    ],
  },
  {
    label: "Approvals",
    actions: [
      ["approval.requested", "Approval requested"],
      ["approval.approved", "Request approved"],
      ["approval.rejected", "Request rejected"],
      ["approval.superseded", "Approval request withdrawn"],
      ["approval.deleted", "Approval request removed"],
    ],
  },
  {
    label: "Executive brief",
    actions: [
      ["exco.generated", "Brief generated"],
      ["exco.sent", "Brief sent"],
      ["exco.brief_deleted", "Brief deleted"],
      ["exco.updated", "Brief content updated"],
    ],
  },
  {
    label: "Settings",
    actions: [
      ["settings.updated", "Settings changed"],
      ["settings.department_added", "Department added"],
      ["settings.department_updated", "Department updated"],
      ["settings.department_removed", "Department removed"],
      ["settings.exco_recipients_updated", "Brief recipients updated"],
    ],
  },
  {
    label: "Exports, e-mails & AI",
    actions: [
      ["data.audit_log_export", "Audit log exported"],
      ["obs.bulk_reminder", "Observation reminders e-mailed"],
      ["ext.bulk_reminder", "External finding reminders e-mailed"],
      ["workspace.plan_generated", "Audit programme generated with AI"],
      ["workspace.exec_summary_generated", "Executive summary generated with AI"],
      ["workspace.observations_imported", "Observations imported from CSV"],
      ["plan.generated", "Annual plan generated with AI"],
      ["plan.universe_generated", "Audit universe generated with AI"],
    ],
  },
  {
    label: "Security",
    actions: [
      ["security.workspace_write_filtered", "Disallowed changes reverted"],
      ["security.audit_governance_changed", "Audit governance metadata changed"],
      ["security.unversioned_write_rejected", "Save refused — no version token"],
      ["security.file_access_denied", "File download refused — not in viewer's scope"],
      ["security.unversioned_write_allowed", "Save accepted without a version token"],
      ["security.changes_unreadable", "Save could not be fully itemised"],
      ["workspace.changes_truncated", "Further changes in the same save"],
    ],
  },
];

/* Actions no longer written, kept so history still reads well. Several were written by the browser
   under names that did not match their own filter entry, and "obs.update_requested" meant two
   different things depending on the screen that wrote it. */
const LEGACY_LABELS: Record<string, string> = {
  "auth.password_changed": "Password changed",
  "data.backup_export": "Backup exported",
  "data.backup_import": "Backup imported",
  "data.reset_all": "All data reset",
  "workspace.audit_created": "Audit created",
  "workspace.audit_updated": "Audit updated",
  "workspace.report_created": "Report created",
  "workspace.observation_created": "Observation created",
  "workspace.department_removed": "Department removed",
  "workspace.test_deleted": "Test deleted",
  "tor.updated": "Terms of reference updated",
  "sop.updated": "SOP updated",
  "settings.closure_check": "Closure check setting changed",
  "obs.update_requested": "Update requested",
  "obs.closure_escalated": "Closure escalated",
  "process.step_deleted": "Process step deleted",
  "ext.assigned": "External finding assigned",
  "fraud.risk_created": "Fraud risk added",
};

const LABELS: Record<string, string> = Object.fromEntries(
  ACTION_GROUPS.flatMap((g) => g.actions),
);

export function actionLabel(action: string): string {
  const known = LABELS[action] || LEGACY_LABELS[action];
  if (known) return known;
  // Humanise "<area>.<event>" so an action nobody labelled still reads.
  const event = action.split(".")[1] || action;
  const words = event.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* What a browser may still report through POST /api/audit-log. It used to accept any
   "<area>.<event>" outside auth/user/security, which let any signed-in user write "Observation
   closed" into the trail for something that never happened — and the real entries were only ever
   as complete as each screen remembered to make them. Changes to records are now derived on the
   server from what a save actually persisted, so the browser is limited to the things the server
   cannot observe: a file generated in the browser, e-mails it sent, and AI assistance it used. */
export const CLIENT_AUDIT_ACTIONS: ReadonlySet<string> = new Set([
  "data.audit_log_export",
  "obs.bulk_reminder",
  "ext.bulk_reminder",
  "workspace.plan_generated",
  "workspace.exec_summary_generated",
  "workspace.observations_imported",
  "plan.generated",
  "plan.universe_generated",
]);

export function isClientAuditAction(action: string): boolean {
  return CLIENT_AUDIT_ACTIONS.has(action);
}

/* How the session behind an entry was established. `dev` is the one that matters: the developer
   sign-in issues a session AS someone else, so the entry's user is the account used, and
   `actorName` names the developer who was actually operating it. */
export const AUTH_METHOD_LABELS: Record<string, string> = {
  sso: "Microsoft sign-in",
  dev: "Developer sign-in",
  system: "Scheduled job",
  script: "Maintenance script",
};

export function authMethodLabel(method: string | null | undefined): string {
  if (!method) return "";
  return AUTH_METHOD_LABELS[method] || method;
}
