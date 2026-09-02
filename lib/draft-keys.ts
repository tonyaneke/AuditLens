/** Server-side draft keys — scoped per user in UserDraft. */

export const NEW_OBS_DRAFT_KEY = "new-obs";

export function raiseDraftKey(auditId: string, reportId: string) {
  return `raise:${auditId}:${reportId}`;
}

/** Reject odd keys before they hit the database. */
export function parseDraftKey(raw: unknown): string | null {
  const key = String(raw || "").trim();
  if (!key || key.length > 160) return null;
  if (!/^[a-z0-9][a-z0-9:_-]*$/i.test(key)) return null;
  return key;
}

export const MAX_DRAFT_BYTES = 512 * 1024;
