"use client";

// Client AI helpers — port of aiGenerate/parseAiJson/runAiJson/runAiText from audit-bot.js.
// The global busy overlay + poll pause are handled by the AiBusy provider via withAiBusy().

import { pauseSync, resumeSync } from "@/lib/workspace/sync-pause";

export function parseAiJson<T = unknown>(raw: string): T {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^```(json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("Couldn't read AI response as JSON.");
  }
}

export async function aiGenerate(prompt: string, mode: "json" | "text" = "json"): Promise<string> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, mode }),
  });
  const data = await res.json().catch(() => ({}) as { error?: string; text?: string });
  if (!res.ok) throw new Error((data as { error?: string }).error || "AI request failed.");
  return (data as { text?: string }).text || "";
}

let aiBusySetter: ((on: boolean) => void) | null = null;
/** Wired once by <AiBusyOverlay>; safe no-op before mount. */
export function registerAiBusy(setter: ((on: boolean) => void) | null): void {
  aiBusySetter = setter;
}

/** Run an async AI task with the global overlay shown and workspace polling paused. */
export async function withAiBusy<T>(fn: () => Promise<T>): Promise<T> {
  pauseSync("ai");
  aiBusySetter?.(true);
  try {
    return await fn();
  } finally {
    aiBusySetter?.(false);
    resumeSync("ai");
  }
}

export async function runAiJson<T = unknown>(prompt: string): Promise<T> {
  return withAiBusy(async () => parseAiJson<T>(await aiGenerate(prompt, "json")));
}

export async function runAiText(prompt: string): Promise<string> {
  return withAiBusy(async () => aiGenerate(prompt, "text"));
}
