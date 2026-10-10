import { normalizeDept, type DeptScope } from "./dept-scope";

/* Who may see an engagement's communications — the notice and its information / clarification
 * requests (lib/workspace/audit-comms.ts).
 *
 * An audit has never carried a department: Internal Audit audits across the organisation and an
 * audit's `area` is free text. What ties an engagement to a department is the ENGAGEMENT NOTICE —
 * Internal Audit names the departments it is addressed to when they issue it from the Terms of
 * Reference. Until it is issued nobody outside Internal Audit sees the audit at all, so a plan
 * still being drafted never reaches the department it is about.
 *
 * Dependency-free (bar lib/dept-scope.ts, which is too) and shared by BOTH sides, like dept-scope:
 *   - the server, via lib/workspace-scope.ts — the payload trim and the write reconciler, and
 *   - the client, via the portal's Audits tab.
 * If they disagree, an owner's ordinary save is reconciled away and logged as a violation.
 */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The departments an audit's notice was issued to, as normalised keys. Empty until issued. */
export function noticeDeptKeys(audit: unknown): Set<string> {
  const keys = new Set<string>();
  const notice = isObj(audit) ? audit.notice : undefined;
  if (!isObj(notice) || !notice.issuedAt || !Array.isArray(notice.departments)) return keys;
  for (const d of notice.departments) {
    const k = normalizeDept(d);
    if (k) keys.add(k);
  }
  return keys;
}

/** True when the audit's issued notice reaches one of the scoped departments. */
export function auditNoticedTo(audit: unknown, scope: DeptScope | null | undefined): boolean {
  if (!scope || !scope.keys.size) return false;
  for (const k of noticeDeptKeys(audit)) if (scope.keys.has(k)) return true;
  return false;
}

/** True when a request belongs to one of the scoped departments AND the engagement's notice
 *  reached that department. Both, because a viewer in two departments must not see a request
 *  addressed to the one the notice never went to. `audit` is the request's own audit. */
export function requestReaches(
  req: unknown,
  audit: unknown,
  scope: DeptScope | null | undefined,
): boolean {
  if (!isObj(req) || !scope || !scope.keys.size) return false;
  const key = normalizeDept(req.department);
  if (!key || !scope.keys.has(key)) return false;
  return noticeDeptKeys(audit).has(key);
}
