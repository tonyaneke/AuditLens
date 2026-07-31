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

export type ClosureVerdict = {
  concrete: boolean;
  feedback: string;
  questions: string[];
  suggestion: string;
  tips: string[];
};

/* The suggestion is copied verbatim into the closure response box — a plain textarea — and is then
   re-rendered by RichText, which deletes markdown markers outright. So asterisks the model emits
   despite being told not to read as literal punctuation in the template and then silently vanish
   downstream. Strip them here, once, so what the owner previews, copies and submits is one and the
   same text. Markdown bullets become a real bullet character rather than disappearing. */
function plainAiText(s: unknown): string {
  return String(s == null ? "" : s)
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*[*+-][ \t]+/gm, "• ")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

THE JUDGEMENT COMES FIRST — decide "concrete" before you write anything else, and do not let the
drafting rules below soften it. Mark it NOT concrete whenever the response, read on its own:
- only asserts completion — "done", "noted", "resolved", "implemented", "we have complied", "the
  issue has been addressed" — without saying what was actually done;
- restates or paraphrases the ${rej ? "requested changes" : "recommendation"} back as if quoting it were evidence of having done it;
- promises or plans rather than reports — "will be", "is being", "in progress", "shortly", "ongoing";
- names no specific artefact, action, date or owner that an auditor could go and check;
- is too short or too general to verify. When you are in any doubt, it is NOT concrete.
Only an unfilled template counts worse than filler: if the response still carries square-bracket
placeholders like "[date ...]", it is NOT concrete — say so plainly in "feedback" and return the
same template back, since the owner has copied it in without filling the gaps.

THE SUGGESTION IS A CONTRACT. The owner drops it straight into the response box, fills the brackets
and submits it — and it must pass on that submission. Write "suggestion" as a FINISHED RESPONSE WITH
GAPS, never as an outline, a form or a set of instructions:
- ONE RESPONSE, BUT BROKEN INTO READABLE PARAGRAPHS. Flowing prose the owner could send as-is once
  the gaps are filled — never one dense block. Write TWO TO FOUR short paragraphs of two or three
  sentences each, each separated by a BLANK LINE (a \\n\\n between them), so it is easy to read once
  pasted in. Group them by theme: what was done and when, then how it addresses what was asked and
  what evidence backs it, then how it will be kept in place. Do NOT lay it out as labelled lines,
  headings or bullets. Do NOT split it into "Recommendation 1 / 2 / 3" sections and do NOT repeat the
  same structure per part — where the recommendation has several parts, cover them in sequence across
  those same paragraphs.
- EVERY WORD OUTSIDE THE BRACKETS IS FINAL WORDING. The owner should only ever be typing facts into
  gaps, never composing a sentence of their own.
- A PLACEHOLDER IS A SHORT FACTUAL VALUE the owner can look up — a name, a date, a number, a document
  title, a system, a job title. Two to eight words. NEVER "[describe how ...]", "[explain ...]",
  "[state the mechanism ...]": if something needs describing, YOU write the description as ordinary
  prose and leave only the specific facts in brackets. Write "enforced by routing every proposal to
  [job title of the approver] for sign-off before [name of the stage it gates]", NOT "[describe the
  enforcement mechanism]".
- Say inside each bracket exactly what belongs there, with an example — "[date the new approval
  matrix took effect, e.g. 12 June 2026]", not "[date]". The owner must never have to guess.
- Cover EVERY element you would check for, woven into that prose: what was actually done, when, who
  did it or which unit owns it, how it addresses ${rej ? "the Head of Audit's request" : "the recommendation"}, what evidence backs it up, and how it
  will be kept in place going forward. Drop an element ONLY if it genuinely does not apply here.
- NAME ANY NEW OR REVISED DOCUMENT AND SAY IT IS ATTACHED. Whenever the action produced or changed a
  document — a policy, procedure, checklist, workflow, matrix, register, terms of reference, training
  record, system configuration — the template must name it and state that it accompanies this
  response, leaving gaps for its exact title and its version or approval date: "the attached [exact
  title of the new checklist, e.g. Strategic Initiative Review Checklist] ([version or approval date,
  e.g. v1.0 approved 15 May 2026])". Where the action produced no document, name whatever evidence
  does exist instead. Never put an instruction to the owner inside the template — the template IS the
  response the auditor reads; the reminder to actually attach the file belongs in "tips".
- TEST IT BEFORE YOU RETURN IT: if the owner replaces every bracket with a truthful specific and
  changes nothing else, would you mark that response concrete? If not, the template is missing a
  placeholder — add it. Never raise something later that the template did not ask for.
- "questions" must only probe things the template already has a placeholder for. Do not ask for
  anything the template failed to request.
- PLAIN TEXT ONLY — no markdown. No asterisks, no ** bold markers, no # headings, no bullet
  characters. The owner types this into a plain text box, so any markup shows up as literal
  punctuation.

Return ONLY a JSON object: {"concrete": true or false, "feedback": "one or two sentences of specific feedback", "questions": ["a short probing question the owner should answer","..."], "suggestion": "the finished-response-with-gaps described above, as one continuous piece of prose — only when not concrete, else empty string", "tips": ["3 to 5 very short notes on how to fill the gaps without getting flagged again — name the vague phrases to avoid and the kind of specific that satisfies each one, e.g. 'Give a real date, not \\"recently\\" or \\"soon\\"'. Whenever the template says a document is attached, one tip MUST tell the owner to attach that file here with the Attach file button. Empty array when concrete."]}`;
  const d = parseAiJson<{
    concrete?: unknown;
    feedback?: string;
    questions?: unknown;
    suggestion?: string;
    tips?: unknown;
  }>(await aiGenerate(prompt, "json"));
  return {
    concrete: d.concrete === true || String(d.concrete).toLowerCase() === "true",
    feedback: plainAiText(d.feedback),
    questions: Array.isArray(d.questions) ? d.questions.map(plainAiText).filter(Boolean) : [],
    suggestion: plainAiText(d.suggestion),
    tips: Array.isArray(d.tips) ? d.tips.map(plainAiText).filter(Boolean) : [],
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
