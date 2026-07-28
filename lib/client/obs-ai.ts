"use client";

// One-liner → AI observation draft (port of buildObsPrompt/generateObsFromPicker from
// audit-bot.js). Shared by the report page's "+ Add observation (AI)" dialog and the
// /observations/new helper page.

import { runAiJson } from "@/lib/client/ai";
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
