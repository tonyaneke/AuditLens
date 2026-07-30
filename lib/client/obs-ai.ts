"use client";

// One-liner → AI observation draft (port of buildObsPrompt/generateObsFromPicker from
// audit-bot.js), plus the AI quality gates on owner submissions (runCommentCheck /
// runClosureCheck / extractEvidenceText). Shared by the report page's "+ Add observation (AI)"
// dialog, the /observations/new helper page, ObsComposer and ReadyForClosureDialog.

import { aiGenerate, parseAiJson, runAiJson } from "@/lib/client/ai";
import { obsFromAi, type AiObsDraft } from "@/lib/workspace/observations";
import { CRITS, RUBRIC } from "@/lib/workspace/selectors";
import type { Observation, WorkspaceDb } from "@/lib/workspace/types";

export function buildObsPrompt(db: WorkspaceDb, ol: string, area: string, ctx: string): string {
  return `Act as my internal audit observation drafter for ${String(db.org || "the organisation")}. Expand the one-liner below into a formal audit observation using the 5C structure. Recommend a criticality using this rubric:
${CRITS.map((c) => `- ${c}: ${RUBRIC[c]}`).join("\n")}

One-liner: ${ol}
Department: ${area || "(not specified)"}
Process / audit area: ${ctx || "(not specified)"}

Return ONLY a JSON object (no commentary) with these exact keys — every field must be populated with substantive content:
{
  "ref": "observation reference e.g. 1.1",
  "title": "concise observation title",
  "category": "control theme, e.g. Credit risk / Segregation of duties",
  "description": "detailed condition — what was observed, with specifics",
  "criteria": "the policy/standard/expectation that was not met",
  "risk": "impact & risk if not addressed",
  "rootCause": "the most likely root cause(s) — if there is more than one, put EACH on its own line separated by a newline (\\n), not packed into one paragraph",
  "recommendation": "specific, actionable recommendation(s) per best practice — if there is more than one point or step, put EACH on its own line separated by a newline (\\n), not packed into one paragraph",
  "criticality": "Critical | High | Moderate | Low | Process Improvement",
  "owner": "the role/function best placed to own remediation, e.g. Head, Credit Operations",
  "timeline": "Immediate | Short-term | Long-term",
  "agreedTarget": "a realistic proposed agreed remediation target — a date or timeframe consistent with the timeline, e.g. 'Complete by 30 Sep 2026' or 'within 60 days'"
}`;
}

/** Runs the one-liner prompt and returns the normalized draft ready for the raise wizard. */
export async function generateObsDraft(
  db: WorkspaceDb,
  ol: string,
  area: string,
  ctx: string,
): Promise<Observation> {
  const raw = await runAiJson<AiObsDraft | AiObsDraft[]>(buildObsPrompt(db, ol, area, ctx));
  const arr = Array.isArray(raw) ? raw : [raw];
  const d = arr.find((x) => x && typeof x === "object");
  if (!d) throw new Error("No observation found in that response.");
  return obsFromAi(d);
}

/* ---------------- AI quality gates on owner submissions ----------------
   Ports of runCommentCheck / runClosureCheck / extractEvidenceText. These deliberately use
   aiGenerate directly (no withAiBusy overlay) — the calling dialog shows its own "Checking…"
   busy button, exactly like legacy btnBusy did. Callers treat a thrown error as "reviewer
   unavailable": the comment gate lets the post through, the closure gate blocks. */

export type CommentVerdict = { ok: boolean; feedback: string; questions: string[] };

export async function runCommentCheck(
  o: Observation,
  text: string,
  mode: "progress" | "comment",
): Promise<CommentVerdict> {
  const isProgress = mode === "progress";
  const prompt = `You are an internal audit quality reviewer. An action owner has posted ${isProgress ? "a PROGRESS REPORT" : "a comment"} on an audit observation. Decide whether it is acceptable to submit.

${isProgress
    ? `A PROGRESS REPORT must be CONCRETE. It should say what has actually been done so far, the current status, and ideally what remains and by when. REJECT vague statements such as "in progress", "we are working on it", "ongoing", "will do soon" that contain no specifics, dates, or named actions.`
    : `A COMMENT only needs to be RELEVANT and carry some information — a genuine question, clarification, or update. BE LENIENT: accept short but meaningful comments. REJECT only empty filler such as "ok", "noted", "done", "seen" that carries no information at all.`}

Observation: ${o.title}
Recommendation: ${o.recommendation || "(none stated)"}
${isProgress ? "Progress report" : "Comment"}: """${text}"""

Return ONLY a JSON object: {"ok": true or false, "feedback": "one or two sentences of specific, friendly guidance on what to add (only when not ok)", "questions": ["a short probing question the owner should answer","..."]}`;
  const d = parseAiJson<{ ok?: unknown; feedback?: string; questions?: unknown }>(
    await aiGenerate(prompt, "json"),
  );
  return {
    ok: d.ok === true || String(d.ok).toLowerCase() === "true",
    feedback: d.feedback || "",
    questions: Array.isArray(d.questions) ? (d.questions as string[]) : [],
  };
}

export type ClosureVerdict = { concrete: boolean; feedback: string; questions: string[]; suggestion: string };

export async function runClosureCheck(
  o: Observation,
  text: string,
  evidenceText: string,
): Promise<ClosureVerdict> {
  // After a Head return, the bar is "does this address the requested changes" — not a fresh
  // re-litigation of the whole recommendation the Head had already seen.
  const rej = o.closureRejection && o.closureRejection.target === "owner" ? o.closureRejection : null;
  const prompt = `You are an internal audit quality reviewer. An action owner has written a closure response claiming they have addressed an audit observation. Judge whether the response is CONCRETE and CREDIBLY ADDRESSES ${rej ? "THE REQUESTED CHANGES" : "THE RECOMMENDATION"} — not vague filler like "done", "noted", "resolved", "will comply" without specifics. A concrete response states specifically what was implemented or changed, ideally when, and how it maps to what was asked.
${rej ? `
IMPORTANT: this observation was previously submitted for closure and RETURNED by the Head of Audit with a specific request. Judge ONLY whether the response concretely addresses that request — do NOT demand the owner restate everything that was already accepted.
The Head of Audit's requested changes: """${rej.note}"""` : ""}

Observation title: ${o.title}
Recommendation to address: ${o.recommendation || "(none stated)"}
Owner's closure response: """${text}"""
${evidenceText ? `
Attached evidence file content (extracted; may contain specifics not repeated in the response text — count it as part of the owner's submission):
"""${evidenceText}"""` : ""}

Return ONLY a JSON object: {"concrete": true or false, "feedback": "one or two sentences of specific feedback", "questions": ["a short probing question the owner should answer","..."], "suggestion": "an improved, concrete rewrite the owner can adapt to what they actually did — only when not concrete, else empty string. If it contains numbered or sequential steps, put EACH step on its own line separated by a newline (\\n), not packed into one paragraph."}`;
  const d = parseAiJson<{ concrete?: unknown; feedback?: string; questions?: unknown; suggestion?: string }>(
    await aiGenerate(prompt, "json"),
  );
  return {
    concrete: d.concrete === true || String(d.concrete).toLowerCase() === "true",
    feedback: d.feedback || "",
    questions: Array.isArray(d.questions) ? (d.questions as string[]) : [],
    suggestion: d.suggestion || "",
  };
}

/* Extracts text from an attached evidence file (PDF/DOCX) so the AI reviewer can use context
   that lives in the document rather than the response text. Best-effort — "" on any failure. */
export async function extractEvidenceText(f: File | undefined): Promise<string> {
  if (!f) return "";
  const n = (f.name || "").toLowerCase();
  if (!n.endsWith(".pdf") && !n.endsWith(".docx")) return "";
  try {
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/documents/extract", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}) as { text?: string });
    return res.ok && d.text ? String(d.text).slice(0, 6000) : "";
  } catch {
    return "";
  }
}
