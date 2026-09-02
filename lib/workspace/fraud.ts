// Fraud risk assessment (ACFE / COSO aligned) — helpers ported 1:1 from public/audit-bot.js
// (fraudActions/rollupFraud/migrateFraudActions/actStatusClass and the fraud constants).
// Everything takes the workspace db explicitly; nothing reads a global. Core rating maths
// (fraudBand/residualBand/fraudResidual/fraudList, BANDS/BAND_HEX) already live in selectors.ts.

import { BANDS, fraudBand, fraudList, residualBand, uid } from "./selectors";
import type { Department, FraudAction, FraudRisk, WorkspaceDb } from "./types";

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
basic accessors ---------------- */

export function fraudActions(f: FraudRisk): FraudAction[] {
  return f.actions || [];
}

export function actStatusClass(s: string | undefined): string {
  return s === "Implemented" ? "s-Closed" : s === "In Progress" ? "s-InProgress" : "s-Open";
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
  f.status = a.every((x) => x.status === "Implemented")
    ? "Mitigated"
    : a.some((x) => x.status === "Implemented" || x.status === "In Progress")
      ? "Mitigating"
      : "Identified";
}

function rolledUpStatus(f: FraudRisk): string | undefined {
  const a = f.actions || [];
  if (!a.length) return f.status;
  return a.every((x) => x.status === "Implemented")
    ? "Mitigated"
    : a.some((x) => x.status === "Implemented" || x.status === "In Progress")
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

export type FraudView = FraudRisk & { inh: string; res: string; score: number };

/** Register enriched with inherent band, residual band and L×I score (legacy `en`). */
export function fraudEnriched(db: WorkspaceDb): FraudView[] {
  return fraudList(db).map((f) => {
    const inh = fraudBand(f.likelihood * f.impact);
    const res = f.residualOverride || residualBand(inh, f.controlStrength);
    return { ...f, inh, res, score: f.likelihood * f.impact };
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
