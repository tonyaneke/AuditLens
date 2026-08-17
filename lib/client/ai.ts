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

/* ---------------- connection failures ----------------
   An AI call can fail two ways, and they are not the same thing to the person waiting on it.
   Either the model answered and we disliked the answer (no key, bad JSON, empty completion) —
   that is the app's problem and the route says so in JSON — or the round trip never completed
   at all. The second kind is what an action owner hits on a weak connection, and telling them
   "the reviewer is unavailable" sends them to Internal Audit for a fault in their own network.
   It is raised as its own error type so callers can say so and offer a retry. */

export type AiFailureKind = "offline" | "timeout" | "connection";

export class AiUnreachableError extends Error {
  readonly kind: AiFailureKind;
  constructor(kind: AiFailureKind) {
    super(
      kind === "offline"
        ? "No internet connection."
        : kind === "timeout"
          ? "The request timed out."
          : "The connection was lost.",
    );
    this.name = "AiUnreachableError";
    this.kind = kind;
  }
}

export function isAiUnreachable(e: unknown): e is AiUnreachableError {
  return e instanceof AiUnreachableError;
}

/* Observed round trips on the closure check run 15-25s against Gemini, so the ceiling has to sit
   well clear of a slow-but-working call — this is here to end a request that is never coming
   back, not to police latency. Without it a dropped connection leaves the owner on a spinner
   indefinitely, which is the one outcome worse than an error. */
const AI_TIMEOUT_MS = 60_000;

export async function aiGenerate(prompt: string, mode: "json" | "text" = "json"): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    /* fetch only rejects for transport-level failures — offline, DNS, TLS, or our own timeout.
       An HTTP error status resolves normally and is handled below. */
    const name = e instanceof Error ? e.name : "";
    throw new AiUnreachableError(
      name === "TimeoutError"
        ? "timeout"
        : typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "connection",
    );
  }

  let data: { error?: string; text?: string } | null = null;
  try {
    data = (await res.json()) as { error?: string; text?: string };
  } catch {
    data = null;
  }
  if (!res.ok) {
    /* The route always answers with a JSON {error}. A failure carrying no such body came from
       somewhere between us and it — a gateway, or the platform cutting the function off at its
       maxDuration — which the caller should treat as a connection problem, not an AI one. */
    if (!data || typeof data.error !== "string") {
      throw new AiUnreachableError(res.status === 504 ? "timeout" : "connection");
    }
    throw new Error(data.error);
  }
  return data?.text || "";
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
