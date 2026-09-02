"use client";

/** Server-side form drafts — scoped to the signed-in user via /api/drafts.
 *  Legacy browser localStorage entries are migrated once on read, then removed. */

const LEGACY_PREFIX = "auditlens:draft:";

function readLegacyDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: T };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function clearLegacyDraft(key: string): void {
  try {
    localStorage.removeItem(LEGACY_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export async function loadModalDraft<T>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/drafts?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (res.status === 401) return readLegacyDraft<T>(key);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T | null };
    if (json.data != null) return json.data;

    const legacy = readLegacyDraft<T>(key);
    if (legacy != null) {
      await saveModalDraft(key, legacy);
      clearLegacyDraft(key);
      return legacy;
    }
    return null;
  } catch {
    return readLegacyDraft<T>(key);
  }
}

export async function saveModalDraft<T>(key: string, data: T): Promise<boolean> {
  try {
    const res = await fetch("/api/drafts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, data }),
    });
    if (res.ok) {
      clearLegacyDraft(key);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function clearModalDraft(key: string): Promise<void> {
  clearLegacyDraft(key);
  try {
    await fetch(`/api/drafts?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch {
    /* best effort */
  }
}

export { NEW_OBS_DRAFT_KEY, raiseDraftKey } from "@/lib/draft-keys";
