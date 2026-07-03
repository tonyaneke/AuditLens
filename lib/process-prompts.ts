export function buildProcReviewPrompt(
  org: string,
  unit: string,
  sopTitle: string,
) {
  return `Act as an internal audit / business process specialist for ${org}. Review the attached Standard Operating Procedure PDF and assess the process effectiveness for the business unit. Identify:
- Control gaps: missing or weak controls (approvals, segregation of duties, reconciliations, validations, limits, audit trail)
- Process gaps: missing steps, unclear ownership, weak handoffs, no escalation, undefined timelines
- Redundancy: duplicate, repetitive or non-value-adding tasks
- Efficiency opportunity: automation, streamlining, removing bottlenecks
- Strength: notable good practices

Business unit: ${unit || "(not specified)"}
SOP: ${sopTitle || "(untitled)"}

Read the full attached PDF carefully, including tables, headings, and procedural steps.

Return ONLY a JSON object (no commentary):
{
  "overallRating": "Strong | Adequate | Needs improvement | Weak",
  "summary": "concise assessment of the process's effectiveness",
  "findings": [
    { "category": "Control gap | Process gap | Redundancy | Efficiency opportunity | Strength", "title": "short title", "detail": "what was observed in the SOP", "recommendation": "specific improvement", "severity": "High | Medium | Low" }
  ],
  "keyRecommendations": ["top priority improvement", "..."]
}`;
}

export function buildProposeProcessPrompt(
  org: string,
  unit: string,
  sopTitle: string,
  findingsList: string,
  hasPdf: boolean,
) {
  const sopRef = hasPdf
    ? "Use the attached original SOP PDF for context where helpful."
    : "Redesign from the findings below (no original SOP PDF is attached).";

  return `Act as a business process re-engineering specialist for ${org}. Redesign the "${unit}" process${sopTitle ? ` (${sopTitle})` : ""} into an improved, controlled and efficient end-to-end process — resolving the control gaps, removing redundancies and building in efficiency from the findings below.

Findings to resolve:
${findingsList}

${sopRef}

Return ONLY a JSON object (no commentary):
{
  "proposedSummary": "short narrative of the redesigned process and the key improvements",
  "steps": [
    { "actor": "role responsible", "action": "what happens at this step", "type": "start | step | control | decision | end", "note": "for a decision, the branch condition; otherwise optional" }
  ]
}
Order the steps end-to-end (begin with a "start", finish with an "end"). Use type "control" for embedded controls (approvals, segregation of duties, reconciliations, system blocks) and "decision" for branch/approval points.`;
}
