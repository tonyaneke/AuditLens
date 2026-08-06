// Pure helpers for the Action-Owner portal — ported 1:1 from public/audit-bot.js
// (myObsList/myExtList/myWithdrawnObs/myFraudRisks + the fraud-action migration/rollup).
// All take the workspace db (+ the current user's id) explicitly; no globals, no side
// effects during render — the legacy migrateFraudActions() write happens lazily inside
// mutate() via ensureFraudActions()/resolveFraudAction() instead.

import { deptScopeFor, inDeptScope, type DeptScope } from "@/lib/dept-scope";
import {
  allObs,
  extList,
  fraudBand,
  fraudList,
  obsIsApproved,
  residualBand,
  uid,
  withdrawnObsAll,
  type ObsWithContext,
} from "./selectors";
import type { ExtFinding, FraudAction, FraudRisk, Observation, WorkspaceDb } from "./types";

/* ---------------- constants (verbatim from audit-bot.js) ---------------- */

export const ACTION_STATUS = ["Planned", "In Progress", "Implemented"] as const;

export const EXT_SEV_HEX: Record<string, string> = {
  High: "#b00020",
  Medium: "#c9a300",
  Low: "#2e7d32",
};

/* ---------------- portal status buckets ----------------
   An action owner's portal was one undifferentiated list per register, which for a head of
   department carrying dozens of observations meant scrolling to find the two that still needed
   them. These are the buckets they actually think in.

   "Ready for Closure" is not a stored status — nothing writes it. It is the state between the
   owner's response (ownerRectifiedAt) and Internal Audit's verification, and the stored status
   over that whole span is "In Progress". Deriving it here is what lets an owner separate
   "still mine" from "with Internal Audit"; it matches the pill MyObsCard already renders. */

export const OWNER_STATUSES = ["Open", "In Progress", "Ready for Closure", "Closed"] as const;

export function ownerStatusOf(o: { status?: string; ownerRectifiedAt?: string }): string {
  const s = o.status || "Open";
  if (s === "Closed") return "Closed";
  return o.ownerRectifiedAt ? "Ready for Closure" : s;
}

/* ---------------- owner matching (by user id, as in legacy) ---------------- */

/** Internal observations assigned to this owner (primary or secondary), approved only. */
export function myObsList(db: WorkspaceDb, userId: string | undefined): ObsWithContext[] {
  return allObs(db).filter(
    (o) =>
      ((o.ownerUserId && o.ownerUserId === userId) ||
        (o.secondaryOwnerUserId && o.secondaryOwnerUserId === userId)) &&
      obsIsApproved(o),
  );
}

/** Withdrawn observations that were assigned to this owner. */
export function myWithdrawnObs(db: WorkspaceDb, userId: string | undefined): ObsWithContext[] {
  return withdrawnObsAll(db).filter(
    (o) =>
      (o.ownerUserId && o.ownerUserId === userId) ||
      (o.secondaryOwnerUserId && o.secondaryOwnerUserId === userId),
  );
}

/* ---------------- department matching ----------------
   The portal shows the DEPARTMENT's observations, not just the ones with this person's name on
   them (requested 2026-08-05). These mirror canSeeObs() in lib/workspace-scope.ts exactly — the
   server has already trimmed the payload the same way, so a mismatch here would only ever hide
   something the client was legitimately given. Kept separate from myObsList so the card can still
   say which ones are assigned to the person reading it. */

export type PortalUser = { id: string; department?: string; extraDepartments?: string[] };

function scopeOf(db: WorkspaceDb, user: PortalUser | undefined): DeptScope {
  return deptScopeFor(db, user);
}

/** Assigned to this person, or raised against their department. The rule the portal, the
 *  dashboard and the sidebar counts all share. */
export function isMineOrMyDept(
  o: Observation,
  userId: string | undefined,
  scope: DeptScope,
): boolean {
  if (userId && ((o.ownerUserId && o.ownerUserId === userId) || (o.secondaryOwnerUserId && o.secondaryOwnerUserId === userId)))
    return true;
  return inDeptScope(o, scope);
}

/** Every approved internal observation this user's portal shows: theirs plus their department's. */
export function portalObsList(db: WorkspaceDb, user: PortalUser | undefined): ObsWithContext[] {
  const scope = scopeOf(db, user);
  return allObs(db).filter((o) => isMineOrMyDept(o, user?.id, scope) && obsIsApproved(o));
}

/** Withdrawn observations for the same population. */
export function portalWithdrawnObs(db: WorkspaceDb, user: PortalUser | undefined): ObsWithContext[] {
  const scope = scopeOf(db, user);
  return withdrawnObsAll(db).filter((o) => isMineOrMyDept(o, user?.id, scope));
}

/** Every external finding this user's portal shows: theirs plus their department's.
 *  Mirrors canSeeExt() in lib/workspace-scope.ts — no approval gate, because a regulator's
 *  finding has no draft state. */
export function portalExtList(db: WorkspaceDb, user: PortalUser | undefined): ExtFinding[] {
  const scope = scopeOf(db, user);
  return extList(db).filter(
    (f) =>
      (user?.id && ((f.ownerUserId && f.ownerUserId === user.id) || (f.secondaryOwnerUserId && f.secondaryOwnerUserId === user.id))) ||
      inDeptScope(f, scope),
  );
}

/** True when this record is assigned to the person directly — used to label a card
 *  "Assigned to you" among their department's other items. Structural rather than typed to
 *  Observation so the portal cards, which also carry external findings, can use one rule. */
export function isAssignedTo(
  o: { ownerUserId?: string; secondaryOwnerUserId?: string },
  userId: string | undefined,
): boolean {
  return !!userId && (o.ownerUserId === userId || o.secondaryOwnerUserId === userId);
}

/** External / regulatory findings assigned to this owner (primary or secondary). */
export function myExtList(db: WorkspaceDb, userId: string | undefined): ExtFinding[] {
  return extList(db).filter(
    (f) =>
      (f.ownerUserId && f.ownerUserId === userId) ||
      (f.secondaryOwnerUserId && f.secondaryOwnerUserId === userId),
  );
}

/* ---------------- "still on my plate" counts (sidebar pending dots) ----------------
   What an action owner has NOT finished. Deliberately narrower than the list pages: an item
   only counts while the owner still owes something — once they have marked it Ready for
   Closure the ball is with Internal Audit, so the dot clears even though it is still open. */

/** Observations awaiting a response from this user's DEPARTMENT.
 *  Department-wide rather than personal because any member can now answer any of them: a count of
 *  "yours alone" would read as zero to everyone but the named owner while the department still
 *  owed Internal Audit a dozen responses. */
export function myObsPendingCount(db: WorkspaceDb, user: PortalUser | undefined): number {
  return portalObsList(db, user).filter(
    (o) => (o.status || "Open") !== "Closed" && !o.withdrawn && !o.ownerRectifiedAt,
  ).length;
}

/** External findings awaiting a response from this user's department — department-wide for the
 *  same reason as observations: any member can now answer any of them. */
export function myExtPendingCount(db: WorkspaceDb, user: PortalUser | undefined): number {
  return portalExtList(db, user).filter(
    (f) => (f.status || "Open") !== "Closed" && !f.ownerRectifiedAt,
  ).length;
}

/** Fraud prevention actions this owner has not implemented yet. */
export function myFraudPendingCount(db: WorkspaceDb, userId: string | undefined): number {
  return myFraudRisks(db, userId).reduce(
    (n, f) => n + myFraudActionsFor(f, userId).filter((a) => a.status !== "Implemented").length,
    0,
  );
}

/** Fraud risks whose prevention actions this owner implements (primary owner only). */
export function myFraudRisks(db: WorkspaceDb, userId: string | undefined): FraudRisk[] {
  // A risk is "mine" when it is assigned to me at risk level OR any of its prevention
  // actions is individually assigned to me (per-action assignment via the action dialog).
  return fraudList(db).filter(
    (f) =>
      f.ownerUserId === userId || fraudActionsView(f).some((a) => a.ownerUserId === userId),
  );
}

/** The actions an owner works on within a risk: all of them when the risk itself is theirs,
 * otherwise only the actions assigned to them directly. */
export function myFraudActionsFor(f: FraudRisk, userId: string | undefined): FraudAction[] {
  const acts = fraudActionsView(f);
  return f.ownerUserId === userId ? acts : acts.filter((a) => a.ownerUserId === userId);
}

/* ---------------- fraud actions: pure view + lazy legacy migration ---------------- */

/** Stable synthetic id for the action derived from a pre-migration `preventionAction`. */
export function synthFraudActionId(f: FraudRisk): string {
  return f.id + ":legacy0";
}

function synthesizedAction(f: FraudRisk, id: string): FraudAction {
  return {
    id,
    text: String(f.preventionAction || ""),
    type: "Preventive",
    owner: f.owner || "",
    targetDate: "",
    status: f.status === "Mitigated" ? "Implemented" : "Planned",
  };
}

/**
 * Read-only equivalent of legacy fraudActions() *after* migrateFraudActions() ran: risks
 * still carrying only the old single `preventionAction` field are shown as one Preventive
 * action (with a stable synthetic id) without mutating the db during render.
 */
export function fraudActionsView(f: FraudRisk): FraudAction[] {
  if (f.actions) return f.actions;
  return f.preventionAction ? [synthesizedAction(f, synthFraudActionId(f))] : [];
}

/** Display status matching legacy rollupFraud() output without writing to the db. */
export function fraudRollupStatus(f: FraudRisk): string {
  const a = fraudActionsView(f);
  if (!a.length) return f.status || "Identified";
  return a.every((x) => x.status === "Implemented")
    ? "Mitigated"
    : a.some((x) => x.status === "Implemented" || x.status === "In Progress")
      ? "Mitigating"
      : "Identified";
}

/** Residual band exactly as viewMyFraud computes it (no likelihood/impact defaulting). */
export function fraudResidualBand(f: FraudRisk): string {
  const inh = fraudBand(f.likelihood * f.impact);
  return f.residualOverride || residualBand(inh, f.controlStrength);
}

/* ---------------- write helpers (call ONLY inside mutate()) ---------------- */

/** Legacy migrateFraudActions() for one risk — materialises `actions` on first write. */
export function ensureFraudActions(f: FraudRisk): FraudAction[] {
  if (!f.actions) {
    f.actions = f.preventionAction ? [synthesizedAction(f, uid())] : [];
  }
  return f.actions;
}

/**
 * Find an action on a risk for a write, materialising the legacy single-action shape if
 * needed (a synthetic view id resolves to the newly materialised action).
 */
export function resolveFraudAction(f: FraudRisk, actionId: string): FraudAction | undefined {
  const actions = ensureFraudActions(f);
  const hit = actions.find((x) => x.id === actionId);
  if (hit) return hit;
  if (actionId === synthFraudActionId(f)) return actions[0];
  return undefined;
}

/** Legacy rollupFraud() — verbatim; mutates f.status from its actions. */
export function rollupFraud(f: FraudRisk): void {
  const a = f.actions || [];
  if (!a.length) return;
  f.status = a.every((x) => x.status === "Implemented")
    ? "Mitigated"
    : a.some((x) => x.status === "Implemented" || x.status === "In Progress")
      ? "Mitigating"
      : "Identified";
}

/** Legacy notify() — pushes an in-app notification onto the workspace blob. */
export function pushNotification(
  db: WorkspaceDb,
  userId: string,
  kind: string,
  text: string,
  link: string,
  obsId = "",
): void {
  if (!userId) return;
  db.notifications = db.notifications || [];
  db.notifications.push({
    id: uid(),
    userId,
    kind: kind || "info",
    text: text || "",
    link: link || "",
    obsId,
    read: false,
    at: new Date().toISOString(),
  });
}
