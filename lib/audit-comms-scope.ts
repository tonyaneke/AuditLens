import { normalizeDept, type DeptScope } from "./dept-scope";

/* Who may see an engagement's communications — the notice at the start, the conclusion at the end,
 * and the information / clarification requests in between (lib/workspace/audit-comms.ts).
 *
 * An audit has never carried a department: Internal Audit audits across the organisation and an
 * audit's `area` is free text. What ties an engagement to a department is a COMMUNICATION issued to
 * it — the engagement notice (from the Terms of Reference) or the audit conclusion (from a final
 * report). Each names the departments it is addressed to. Until one is issued nobody outside
 * Internal Audit sees the audit at all, so a plan still being drafted never reaches the department
 * it is about.
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

/** The departments an ISSUED communication ({issuedAt, departments}) went to, as normalised keys. */
export function issuedDeptKeys(comm: unknown): Set<string> {
  const keys = new Set<string>();
  if (!isObj(comm) || !comm.issuedAt || !Array.isArray(comm.departments)) return keys;
  for (const d of comm.departments) {
    const k = normalizeDept(d);
    if (k) keys.add(k);
  }
  return keys;
}

/** True when an issued communication reaches one of the scoped departments. */
export function commReaches(comm: unknown, scope: DeptScope | null | undefined): boolean {
  if (!scope || !scope.keys.size) return false;
  for (const k of issuedDeptKeys(comm)) if (scope.keys.has(k)) return true;
  return false;
}

/** Every department the engagement's notice or conclusion went to. */
export function engagementDeptKeys(audit: unknown): Set<string> {
  if (!isObj(audit)) return new Set();
  return new Set([...issuedDeptKeys(audit.notice), ...issuedDeptKeys(audit.closeout)]);
}

/** True when the engagement's notice or conclusion reached one of the scoped departments. */
export function engagementReaches(audit: unknown, scope: DeptScope | null | undefined): boolean {
  if (!isObj(audit)) return false;
  return commReaches(audit.notice, scope) || commReaches(audit.closeout, scope);
}

/** True when a request belongs to one of the scoped departments AND the engagement was
 *  communicated to that department. Both, because a viewer in two departments must not see a
 *  request addressed to the one the engagement never reached. `audit` is the request's own audit. */
export function requestReaches(
  req: unknown,
  audit: unknown,
  scope: DeptScope | null | undefined,
): boolean {
  if (!isObj(req) || !scope || !scope.keys.size) return false;
  const key = normalizeDept(req.department);
  if (!key || !scope.keys.has(key)) return false;
  return engagementDeptKeys(audit).has(key);
}
