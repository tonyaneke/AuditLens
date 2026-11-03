// Server-side AI access, independent of any one vendor. Callers describe what they want (a prompt,
// JSON or text, an optional PDF) and never name a provider: Gemini is tried first, and when it
// fails — quota, overload, a rejected key, an empty or non-JSON answer, or no key at all — the
// same request goes to OpenAI. Only providers whose key is present in the environment take part.
//
// Env:
//   GEMINI_API_KEY / GEMINI_MODEL           (default model gemini-2.5-flash)
//   OPENAI_API_KEY / OPENAI_MODEL           (default model gpt-4.1-mini)
//   OPENAI_BASE_URL                         (default https://api.openai.com/v1 — any
//                                            OpenAI-compatible endpoint works)
//   AI_PROVIDER_ORDER                       (default "gemini,openai"; list only the providers to
//                                            use, in the order to try them)

import { GoogleGenerativeAI } from "@google/generative-ai";

export type AiProviderId = "gemini" | "openai";

export interface AiRequest {
  prompt: string;
  /** Expect JSON back (object or array). The returned text is then parse-checked, fences stripped. */
  json: boolean;
  /** A PDF read alongside the prompt. */
  pdf?: { data: Buffer; fileName?: string };
}

export interface AiResult {
  text: string;
  provider: AiProviderId;
}

/* What the person on screen is told when no provider could answer. Every AI dialog shows the
   route's error verbatim, and the causes (billing, a rejected key, a missing key) are nothing an
   auditor can fix — so the detail goes to the server log for the administrator, not to the UI. */
export const AI_UNAVAILABLE_MESSAGE =
  "The AI assistant is unavailable right now. Please reach out to the AuditLens system administrator.";

/** No provider has a key configured — a setup problem, not a failed call. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super(AI_UNAVAILABLE_MESSAGE);
    this.name = "AiNotConfiguredError";
  }
}

/** Every configured provider failed; `failures` holds each one's reason (also logged). */
export class AiUnavailableError extends Error {
  readonly failures: string[];
  constructor(failures: string[]) {
    super(AI_UNAVAILABLE_MESSAGE);
    this.name = "AiUnavailableError";
    this.failures = failures;
  }
}

const LABEL: Record<AiProviderId, string> = { gemini: "Gemini", openai: "OpenAI" };

const KEY_ENV: Record<AiProviderId, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
};

/* A provider that has a fallback behind it gets a ceiling, so one that hangs rather than errors
   still hands over. The closure check runs 15-25s on a good day, so the prompt ceiling sits well
   clear of slow-but-working; PDF reads are heavier and get longer. The last provider in line has
   no ceiling of its own — the caller's timeout governs, as it did before the fallback existed. */
const FALLBACK_AFTER_MS = 45_000;
const PDF_FALLBACK_AFTER_MS = 90_000;

function providerOrder(): AiProviderId[] {
  const raw = process.env.AI_PROVIDER_ORDER || "gemini,openai";
  const listed = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is AiProviderId => p === "gemini" || p === "openai");
  return [...new Set(listed)].filter((p) => Boolean(process.env[KEY_ENV[p]]?.trim()));
}

/* ---------------- Gemini ---------------- */

async function callGemini(req: AiRequest, timeoutMs?: number): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!.trim());
  const model = genAI.getGenerativeModel(
    {
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      ...(req.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
    },
    timeoutMs ? { timeout: timeoutMs } : undefined,
  );

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
  if (req.pdf?.data.length) {
    parts.push({
      inlineData: { mimeType: "application/pdf", data: req.pdf.data.toString("base64") },
    });
  }
  parts.push({ text: req.prompt });

  const result = await model.generateContent(parts);
  return result.response.text() ?? "";
}

/* ---------------- OpenAI ---------------- */

/* Several prompts ask for a top-level JSON array, which OpenAI's json_object mode cannot return —
   so JSON is asked for in words and checked on the way back, exactly as for Gemini. */
const OPENAI_JSON_INSTRUCTION =
  "Reply with valid JSON only: no commentary, no markdown code fences. " +
  "If the instructions ask for a JSON array, return the array itself as the top-level value.";

type OpenAiContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "file"; file: { filename: string; file_data: string } }
    >;

async function callOpenAi(req: AiRequest, timeoutMs?: number): Promise<string> {
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");

  const content: OpenAiContent = req.pdf?.data.length
    ? [
        {
          type: "file",
          file: {
            filename: req.pdf.fileName || "document.pdf",
            file_data: `data:application/pdf;base64,${req.pdf.data.toString("base64")}`,
          },
        },
        { type: "text", text: req.prompt },
      ]
    : req.prompt;

  const messages: Array<{ role: "system" | "user"; content: OpenAiContent }> = [];
  if (req.json) messages.push({ role: "system", content: OPENAI_JSON_INSTRUCTION });
  messages.push({ role: "user", content });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", messages }),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  type Completion = {
    error?: { message?: string };
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; refusal?: string | null };
    }>;
  };
  const data = (await res.json().catch(() => null)) as Completion | null;

  if (!res.ok) {
    // A 401 echoes part of the rejected key ("Incorrect API key provided: sk-proj-…abcd") — mask
    // it before the message travels to the UI or the logs.
    const message = (data?.error?.message || res.statusText || "request failed").replace(
      /\bsk-[\w*.-]+/g,
      "sk-…",
    );
    throw new Error(`${message} (${res.status})`);
  }

  const choice = data?.choices?.[0];
  if (choice?.message?.refusal) throw new Error(`declined the request: ${choice.message.refusal}`);
  if (choice?.finish_reason === "length") throw new Error("the response was cut off at the token limit");
  return choice?.message?.content ?? "";
}

/* ---------------- shared ---------------- */

const CALL: Record<AiProviderId, (req: AiRequest, timeoutMs?: number) => Promise<string>> = {
  gemini: callGemini,
  openai: callOpenAi,
};

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The JSON text in a reply, tolerating fences or a stray sentence around it; null if none. */
function extractJson(raw: string): string | null {
  const text = stripCodeFences(raw);
  if (parses(text)) return text;
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    if (parses(slice)) return slice;
  }
  return null;
}

function describeFailure(err: unknown, timeoutMs?: number): string {
  const name = err instanceof Error ? err.name : "";
  if (timeoutMs && /abort|timeout/i.test(name)) {
    return `no answer within ${Math.round(timeoutMs / 1000)}s`;
  }
  let message = err instanceof Error ? err.message : String(err);
  // Node's fetch reports every transport failure as "fetch failed"; the cause says which.
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  if (message === "fetch failed" && cause) {
    message = `network error (${cause.code || cause.message || "unknown"})`;
  }
  return (
    message
      // "[GoogleGenerativeAI Error]: Error fetching from https://…: [503 …] The model is overloaded"
      .replace(/^\[GoogleGenerativeAI Error\]:\s*/, "")
      .replace(/^Error fetching from \S+:\s*/, "")
      .slice(0, 300) || "request failed"
  );
}

/**
 * Run one AI request, falling back through the configured providers until one answers.
 * Throws AiNotConfiguredError when no provider has a key, otherwise AiUnavailableError. Both
 * carry the user-facing AI_UNAVAILABLE_MESSAGE; the technical reason is logged server-side.
 */
export async function generateAi(req: AiRequest): Promise<AiResult> {
  const providers = providerOrder();
  if (!providers.length) {
    console.error(
      "[ai] No AI provider is configured — set GEMINI_API_KEY and/or OPENAI_API_KEY (check AI_PROVIDER_ORDER).",
    );
    throw new AiNotConfiguredError();
  }

  const failures: string[] = [];
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const next = providers[i + 1];
    const timeoutMs = next ? (req.pdf ? PDF_FALLBACK_AFTER_MS : FALLBACK_AFTER_MS) : undefined;
    try {
      const raw = (await CALL[provider](req, timeoutMs)).trim();
      if (!raw) throw new Error("returned an empty response");
      if (!req.json) return { text: raw, provider };
      const json = extractJson(raw);
      if (json === null) throw new Error("returned invalid JSON");
      return { text: json, provider };
    } catch (err) {
      const reason = describeFailure(err, timeoutMs);
      failures.push(`${LABEL[provider]}: ${reason}`);
      if (next) {
        console.warn(`[ai] ${LABEL[provider]} failed (${reason}); falling back to ${LABEL[next]}.`);
      }
    }
  }
  console.error(`[ai] All AI providers failed. ${failures.join(" · ")}`);
  throw new AiUnavailableError(failures);
}
