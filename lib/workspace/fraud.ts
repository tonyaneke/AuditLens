// Fraud risk assessment (ACFE / COSO aligned) — helpers ported 1:1 from public/audit-bot.js
// (fraudActions/rollupFraud/migrateFraudActions/actStatusClass and the fraud constants).
// Everything takes the workspace db explicitly; nothing reads a global. Core rating maths
// (fraudBand/residualBand/fraudResidual/fraudList, BANDS/BAND_HEX) already live in selectors.ts.

import { BANDS, fraudBand, fraudList, residualBand, uid } from "./selectors";
import type { Department, EvidenceFile, FraudAction, FraudRisk, WorkspaceDb } from "./types";

/* ---------------- constants (verbatim from audit-bot.js) ---------------- */

export const FRAUD_CATS = [
  "Asset Misappropriation",
  "Corruption",
  "Financial Statement Fraud",
  "Other",
] as const;
export const CTRL_STRENGTH = ["Strong", "Moderate", "Weak", "None"] as const;
export const FRAUD_STATUS = ["Identified", "Mitigating", "Mitigated"] as const;
export const ACTION_TYPES = ["Preventive", "Detective", "Corrective"] as const;
export const ACTION_STATUS = ["Planned", "In Progress", "Implemented"] as const;
/** Internal Audit's sign-off on an owner's "Implemented" — never offered to action owners, and
 *  always carries a validation note. */
export const FRAUD_VALIDATED = "Validated";
export const IA_ACTION_STATUS = [...ACTION_STATUS, FRAUD_VALIDATED] as const;
export const LIKE_LABEL = ["", "Rare", "Unlikely", "Possible", "Likely", "Almost certain"] as const;
export const IMP_LABEL = ["", "Insignificant", "Minor", "Moderate", "Major", "Severe"] as const;

// Canonical organisation departments (legacy DEPARTMENTS — pre-fills the "Department" picker).
export const DEPARTMENTS = [
  "Strategy Department",
  "Credit Operations",
  "Audit Department",
  "Finance Department",
  "Legal Department",
  "People & Culture Department",
  "Risk Management",
  "Procurement Department",
  "Operations Department",
  "Administration Department",
  "Office of the Managing Director",
] as const;

/* ---------------- 
This is a test section to see what i am doing...Because this is supper weird that I am here to do all this section for the action 
basic accessors 
Continue on the already existing code and trying to understand the code and logic behind it as this is only way ...this is only way to work on it
---------------- */

export function fraudActions(f: FraudRisk): FraudAction[] {
  return f.actions || [];
}

export function actStatusClass(s: string | undefined): string {
  return s === FRAUD_VALIDATED
    ? "s-Validated"
    : s === "Implemented"
      ? "s-Closed"
      : s === "In Progress"
        ? "s-InProgress"
        : "s-Open";
}

/** Implemented by the owner or validated by Internal Audit — either way, no longer outstanding. */
export function fraudActionDone(status: unknown): boolean {
  return status === "Implemented" || status === FRAUD_VALIDATED;
}

/** Mutating (run inside mutate()): record Internal Audit's validation of an action. Files are
 *  added to any already attached to the validation, never replace them. */
export function validateFraudAction(
  a: FraudAction,
  note: string,
  by: { id: string; name: string },
  files: EvidenceFile[] = [],
): void {
  a.status = FRAUD_VALIDATED;
  a.validationNote = note;
  a.validatedAt = new Date().toISOString();
  a.validatedBy = by.id;
  a.validatedByName = by.name;
  if (files.length) a.validationEvidence = [...(a.validationEvidence || []), ...files];
}

/** Mutating: withdraw a validation when Internal Audit moves the action off "Validated". */
export function clearFraudValidation(a: FraudAction): void {
  delete a.validationNote;
  delete a.validatedAt;
  delete a.validatedBy;
  delete a.validatedByName;
  delete a.validationEvidence;
}

/** Every file the owner has attached across their implementation updates, newest first. */
export function fraudOwnerEvidence(a: FraudAction): EvidenceFile[] {
  const seen = new Set<string>();
  const out: EvidenceFile[] = [];
  for (const u of a.ownerUpdates || []) {
    for (const e of u.evidence || []) {
      if (!e?.itemId || seen.has(e.itemId)) continue;
      seen.add(e.itemId);
      out.push(e);
    }
  }
  return out;
}

/** SharePoint folder key for a fraud risk's evidence (uploads group files by record). */
export function fraudUploadKey(riskId: string): string {
  return "fraud-" + riskId;
}

/** Sort rank for a residual band (Low → Extreme). */
export function bandRank(b: string): number {
  return BANDS.indexOf(b as (typeof BANDS)[number]);
}

/** Residual band from the raw rating inputs (legacy newFraudResidual, generalised). */
export function residualFor(
  likelihood: number,
  impact: number,
  controlStrength: string | undefined,
  residualOverride: string | undefined,
): string {
  const inh = fraudBand(likelihood * impact);
  return residualOverride || residualBand(inh, controlStrength);
}

/* ---------------- rollup & one-time actions migration ---------------- */

/** Mutating (run inside mutate()): derive overall status from the action statuses. */
export function rollupFraud(f: FraudRisk): void {
  const a = f.actions || [];
  if (!a.length) return;
  f.status = a.every((x) => fraudActionDone(x.status))
    ? "Mitigated"
    : a.some((x) => fraudActionDone(x.status) || x.status === "In Progress")
      ? "Mitigating"
      : "Identified";
}

function rolledUpStatus(f: FraudRisk): string | undefined {
  const a = f.actions || [];
  if (!a.length) return f.status;
  return a.every((x) => fraudActionDone(x.status))
    ? "Mitigated"
    : a.some((x) => fraudActionDone(x.status) || x.status === "In Progress")
      ? "Mitigating"
      : "Identified";
}

/** Pure check — lets a component decide whether the migration mutation is needed at all. */
export function fraudMigrationNeeded(db: WorkspaceDb): boolean {
  return fraudList(db).some((f) => !f.actions || f.status !== rolledUpStatus(f));
}

/**
 * Mutating (run inside mutate()): port of legacy migrateFraudActions() — lift the old single
 * preventionAction field into the actions list and re-derive each overall status.
 */
export function migrateFraudActions(db: WorkspaceDb): void {
  fraudList(db).forEach((f) => {
    if (!f.actions) {
      f.actions = f.preventionAction
        ? [
            {
              id: uid(),
              text: f.preventionAction,
              type: "Preventive",
              owner: f.owner || "",
              targetDate: "",
              status: f.status === "Mitigated" ? "Implemented" : "Planned",
            },
          ]
        : [];
    }
    rollupFraud(f);
  });
}

/* ---------------- enriched view model ---------------- */

/**
 * Where a risk sits on the likelihood × impact grid after controls. Only a residual BAND is
 * recorded (inherent band stepped down by control strength, or a manual override), so this picks
 * the cell of that band nearest the inherent rating: impact is held wherever the band allows and
 * the reduction is taken in likelihood, since anti-fraud controls mainly make a scheme less likely
 * rather than less damaging. A risk whose controls don't change its band stays on its inherent
 * cell, and the cell's colour always matches the residual band shown in the register.
 */
export function residualCell(
  likelihood: number,
  impact: number,
  band: string,
): { likelihood: number; impact: number } {
  let best = { likelihood, impact };
  let bestCost = Infinity;
  for (let i = 1; i <= 5; i++) {
    for (let l = 1; l <= 5; l++) {
      if (fraudBand(l * i) !== band) continue;
      // An impact step always costs more than any likelihood move (|ΔL| ≤ 4).
      const cost = Math.abs(impact - i) * 10 + Math.abs(likelihood - l);
      if (cost < bestCost) {
        bestCost = cost;
        best = { likelihood: l, impact: i };
      }
    }
  }
  return best;
}

export type FraudView = FraudRisk & {
  inh: string;
  res: string;
  score: number;
  resLikelihood: number;
  resImpact: number;
};

/** Register enriched with inherent band, residual band, L×I score and residual grid cell (legacy `en`). */
export function fraudEnriched(db: WorkspaceDb): FraudView[] {
  return fraudList(db).map((f) => {
    const inh = fraudBand(f.likelihood * f.impact);
    const res = f.residualOverride || residualBand(inh, f.controlStrength);
    const rc = residualCell(f.likelihood, f.impact, res);
    return {
      ...f,
      inh,
      res,
      score: f.likelihood * f.impact,
      resLikelihood: rc.likelihood,
      resImpact: rc.impact,
    };
  });
}

/* ---------------- departments / owner resolution ---------------- */

export function departments(db: WorkspaceDb): Department[] {
  return db.departments || [];
}

/** Departments assignable as action owner (have a head login). Legacy ownerOptions source. */
export function ownerDepartments(db: WorkspaceDb): Department[] {
  return departments(db).filter((d) => !!d.headUserId);
}

export function deptByHead(db: WorkspaceDb, userId: string | undefined): Department | undefined {
  if (!userId) return undefined;
  return departments(db).find((d) => d.headUserId === userId);
}

/** Best-effort email for a user id via the department model (legacy ownerEmailFor fallback). */
export function ownerEmailFor(db: WorkspaceDb, userId: string | undefined): string {
  const d = deptByHead(db, userId);
  return (d && d.headEmail) || "";
}
