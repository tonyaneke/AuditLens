import type { WorkspaceDb } from "./db-data";

/* SEC-02 / SEC-05 — structural validation for the whole-document PUT.
 *
 * Validation used to be one line — `Array.isArray(body.data.audits)` — which let an authenticated
 * client store anything else it liked in the row that holds the entire audit record.
 *
 * This is deliberately a STRUCTURAL guard, not a schema. lib/workspace-authz.ts already decides
 * every field's VALUE for a non-head write (controlled fields are forced back to the stored copy),
 * so the job here is narrower and different in kind: reject documents that are the wrong shape,
 * absurdly large, or carry keys that are dangerous to merge — before any of it reaches Postgres.
 *
 * No runtime schema library: WorkspaceDb has an index-signature escape hatch and 40+ nested
 * optional types, so a full schema would be a large surface that silently drifts from the real
 * shape. What is checked here is the part that must never drift — identity and containment.
 */

type Obj = Record<string, unknown>;

/** Roughly 3× the largest observed document (~1.7 MB stored). Anything past this is not a save. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Containment caps. Set well above real-world volumes (105 observations, 18 fraud risks today) so
// they only ever fire on abuse, never on growth.
const CAPS: Record<string, number> = {
  audits: 2_000,
  reports: 2_000,
  observations: 5_000,
  extFindings: 10_000,
  fraudRisks: 10_000,
  approvals: 20_000,
  notifications: 50_000,
  auditUniverse: 5_000,
  processReviews: 5_000,
  departments: 1_000,
};

/* Keys that must never be merged into a stored object. JSON.parse puts `__proto__` on the object
   as a plain own property rather than invoking the setter, so this is not exploitable today — but
   the document is spread, structuredClone'd and re-merged in several places downstream, and one
   of those becoming Object.assign-shaped is all it would take. Cheap to strip, so strip it. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/* `ok: true` narrows the caller's `unknown` to WorkspaceDb, so the PUT handler gets its type
   guarantee from the check that actually ran rather than from a cast. */
export type ValidationResult =
  | { ok: true; data: WorkspaceDb }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Every record in a top-level collection must be an object carrying a non-empty string id —
 *  every reconciler in lib/workspace-authz.ts keys on `id`, and a record without one can never be
 *  matched to its stored copy, so it would slip past field-level authorization entirely. */
function checkCollection(rows: unknown, name: string, path: string): string | null {
  if (rows === undefined) return null;
  if (!Array.isArray(rows)) return `${path} must be an array`;
  const cap = CAPS[name];
  if (cap && rows.length > cap) return `${path} exceeds the maximum of ${cap} entries`;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isPlainObject(row)) return `${path}[${i}] must be an object`;
    if (typeof row.id !== "string" || !row.id) return `${path}[${i}] is missing a string id`;
  }
  return null;
}

/**
 * Validate the incoming workspace document's structure. Returns the first problem found, so the
 * 400 tells the caller something actionable rather than "invalid".
 */
export function validateWorkspaceShape(data: unknown): ValidationResult {
  if (!isPlainObject(data)) return { ok: false, error: "Workspace data must be an object." };

  // audits is the one section every client must send — its absence means a truncated or
  // wrong-shaped document, and accepting it would blank the audit record.
  if (!Array.isArray(data.audits)) {
    return { ok: false, error: "Invalid workspace data — audits array required." };
  }

  const topLevel: Array<[string, string]> = [
    ["audits", "audits"],
    ["extFindings", "extFindings"],
    ["fraudRisks", "fraudRisks"],
    ["approvals", "approvals"],
    ["notifications", "notifications"],
    ["auditUniverse", "auditUniverse"],
    ["processReviews", "processReviews"],
    ["departments", "departments"],
  ];
  for (const [key, path] of topLevel) {
    const err = checkCollection(data[key], key, path);
    if (err) return { ok: false, error: err };
  }

  // The audits → reports → observations nesting is the part that actually holds the audit record.
  const audits = data.audits as Obj[];
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    const repErr = checkCollection(a.reports, "reports", `audits[${i}].reports`);
    if (repErr) return { ok: false, error: repErr };
    for (const [j, r] of (Array.isArray(a.reports) ? (a.reports as Obj[]) : []).entries()) {
      const obsErr = checkCollection(
        r.observations,
        "observations",
        `audits[${i}].reports[${j}].observations`,
      );
      if (obsErr) return { ok: false, error: obsErr };
    }
  }

  return { ok: true, data: data as WorkspaceDb };
}

/** Recursively delete prototype-polluting keys. Mutates in place — call on the freshly parsed
 *  body, before anything else touches it. */
export function stripForbiddenKeys(value: unknown, depth = 0): void {
  if (depth > 64 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) stripForbiddenKeys(v, depth + 1);
    return;
  }
  for (const key of Object.keys(value as Obj)) {
    if (FORBIDDEN_KEYS.has(key)) {
      delete (value as Obj)[key];
      continue;
    }
    stripForbiddenKeys((value as Obj)[key], depth + 1);
  }
}

/** Convenience wrapper used by the PUT handler. */
export function prepareIncomingWorkspace(data: unknown): ValidationResult {
  stripForbiddenKeys(data);
  return validateWorkspaceShape(data as WorkspaceDb);
}
