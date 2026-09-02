"use client";

/** Browser-local drafts for modals the user may leave mid-way (raise observation, etc.). */

const PREFIX = "auditlens:draft:";

export function saveModalDraft<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ savedAt: new Date().toISOString(), data }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function loadModalDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: T };
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export function clearModalDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
