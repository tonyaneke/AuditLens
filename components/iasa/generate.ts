"use client";

// AI documentation of a self-assessment — port of buildIASADomainPrompt/applyIASAData/
// generateIASA. One prompt per GIAS domain, fired in parallel: five small responses finish far
// faster than one 52-standard response, and a single slow/failed domain no longer sinks the run.

import { toast } from "@/components/feedback/ToastHost";
import { aiGenerate, parseAiJson, withAiBusy } from "@/lib/client/ai";
import { GIAS, STD_CONF, allStandards, ensureIaSaList, type GiasDomain } from "@/lib/workspace/iasa";
import type { IaSaRecord, WorkspaceDb } from "@/lib/workspace/types";

const IASA_DEFAULT_CTX =
  "(infer for a small in-house internal audit function at a Nigerian consumer-credit corporation regulated by the CBN)";

function buildIASADomainPrompt(org: string, g: GiasDomain, ctx: string): string {
  const stdList = g.ps
    .map((p) => `P${p.n} ${p.t}: ${p.s.map(([num, t]) => num + " " + t).join("; ")}`)
    .join("\n");
  return `Act as an internal audit quality assessor for ${org}. Assess the Internal Audit function against the IIA Global Internal Audit Standards (2024) — Domain ${g.d} (${g.dt}) ONLY:
1. Every STANDARD listed below: a conformance rating (Conforms / Partially Conforms / Does Not Conform), brief evidence supporting the rating, the gap where conformance is not full, and an improvement action for any gap.
2. Every PRINCIPLE listed below: a maturity level 1–5 (1 Initial, 2 Developing, 3 Established, 4 Managed, 5 Optimised), short principle-level commentary, and a key improvement action where relevant.

IA function context:
${ctx || IASA_DEFAULT_CTX}

Principles and standards in this domain:
${stdList}

Return ONLY a JSON object (no commentary):
{ "standards": [ { "standard": "1.1", "conformance": "Conforms | Partially Conforms | Does Not Conform", "evidence": "...", "gap": "...", "action": "..." } ],
  "principles": [ { "principle": 1, "maturity": 3, "notes": "...", "action": "..." } ] }
Include every standard and principle listed above. Keep evidence, gap and action to one short sentence each; use "" where not applicable.`;
}

type RawStd = {
  standard?: string;
  std?: string;
  num?: string;
  conformance?: string;
  conf?: string;
  evidence?: string;
  gap?: string;
  action?: string;
};
type RawPrinc = {
  principle?: unknown;
  n?: unknown;
  p?: unknown;
  conformance?: string;
  maturity?: unknown;
  notes?: string;
  action?: string;
};

/** Merge one domain response (or a legacy bare array of principles) into the record. */
function applyIASAData(sa: IaSaRecord, d: unknown): { nStd: number; nPr: number } {
  let nStd = 0;
  let nPr = 0;
  const valid = new Set(allStandards().map((s) => s.num));
  const obj = (d && typeof d === "object" ? d : {}) as {
    standards?: RawStd[];
    stds?: RawStd[];
    principles?: RawPrinc[];
  };
  const stds = Array.isArray(d) ? [] : obj.standards || obj.stds || [];
  stds.forEach((x) => {
    const num = String(x.standard || x.std || x.num || "").trim();
    if (!valid.has(num)) return;
    const conf =
      STD_CONF.find((c) => c.toLowerCase() === String(x.conformance || x.conf || "").toLowerCase()) ||
      "Not rated";
    const prev = sa.std[num] || {};
    sa.std[num] = {
      conf,
      evidence: x.evidence || "",
      gap: x.gap || "",
      action: x.action || "",
      owner: prev.owner || "",
      target: prev.target || "",
    };
    nStd++;
  });
  const prs = (Array.isArray(d) ? d : obj.principles || []) as RawPrinc[];
  prs.forEach((x) => {
    const pn = Number(x.principle) || Number(x.n) || Number(x.p);
    if (!pn || pn < 1 || pn > 15) return;
    const conf =
      STD_CONF.find((c) => c.toLowerCase() === String(x.conformance || "").toLowerCase()) ||
      "Not rated";
    sa.items[pn] = {
      conformance: conf,
      maturity: Math.min(5, Math.max(0, Math.round(Number(x.maturity) || 0))),
      notes: x.notes || "",
      action: x.action || "",
    };
    nPr++;
  });
  return { nStd, nPr };
}

export async function generateIASA(
  db: WorkspaceDb,
  recId: string,
  mutate: (fn: (d: WorkspaceDb) => void) => void,
): Promise<void> {
  const org = db.org || "";
  const results = await withAiBusy(() =>
    Promise.allSettled(
      GIAS.map((g) => aiGenerate(buildIASADomainPrompt(org, g, ""), "json").then(parseAiJson)),
    ),
  );
  let nStd = 0;
  let nPr = 0;
  const failed: string[] = [];
  mutate((d) => {
    const rec = ensureIaSaList(d).find((x) => x.id === recId);
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        if (rec) {
          const c = applyIASAData(rec, r.value);
          nStd += c.nStd;
          nPr += c.nPr;
        }
      } else {
        failed.push("Domain " + GIAS[i].d);
      }
    });
  });
  if (failed.length)
    toast(
      `Generated ${nStd} standard(s) and ${nPr} principle(s), but ${failed.join(", ")} failed — click Generate again to fill the gaps (existing ratings are kept).`,
      "error",
    );
  else if (nStd || nPr)
    toast(`Assessment generated: ${nStd} standards and ${nPr} principles documented.`, "success");
  else toast("The AI returned no usable assessments. Please try again.", "error");
}
