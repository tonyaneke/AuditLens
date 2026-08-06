/* Which department a record belongs to, and which records a department's staff may work on.
 *
 * Requested 2026-08-05: an observation is raised against a DEPARTMENT, not against one person.
 * Until now only the two named owners could see or answer it, so a finding sat untouched whenever
 * the department head was on leave, and the rest of the department had no idea it existed. Every
 * member of the department now sees their department's observations and any of them can carry one
 * through to Ready for Closure — accountability still sits with the named owner, but the work no
 * longer has a single point of failure.
 *
 * This module is deliberately dependency-free and shared by BOTH sides:
 *   - the server, via lib/workspace-scope.ts (the payload trim + the write reconciler), and
 *   - the client, via lib/workspace/portal.ts and the observation screens.
 * They must agree. If the client shows an observation the server does not consider in-scope, the
 * owner's ordinary save is reconciled away and logged as a security violation.
 *
 * TWO SIGNALS, because neither is reliable on its own:
 *
 *   departmentId   Set at raise time from the department record whose head is the assigned owner
 *                  (RaiseFlow). It goes stale: 13 live observations and one external finding point
 *                  at `deptacf7bfd87a`, a department record that no longer exists, and matching on
 *                  it alone would have hidden all of Credit Operations' oldest findings from the
 *                  very department that owns them.
 *   the owner      A department record carries the user id of its head, so an observation assigned
 *                  to that head belongs to that department whatever its departmentId says.
 *
 * MATCHING IS BY NAME, not by id, and that is load-bearing: a department gets a NEW record every
 * time an action owner is added for it, so "Finance Department" is two records (Jonathan
 * Aderibigbe's and Najma Goni's) covering 28 observations between them. Finance staff must see all
 * 28, not the 25 that happen to hang off the first record.
 */

type Obj = Record<string, unknown>;

/** The shape this module needs from a workspace document — loose on purpose so it takes both the
 *  server-side WorkspaceDb (lib/db-data.ts) and the strict client type (lib/workspace/types.ts).
 *  The index signature is what makes both assignable: without it TypeScript's weak-type check
 *  rejects a document whose `departments` is only reachable through its own index signature. */
export type DeptSource = { departments?: unknown; [k: string]: unknown };

/** A record that can belong to a department: observations and external findings both qualify. */
export type DeptScoped = {
  departmentId?: unknown;
  ownerUserId?: unknown;
  secondaryOwnerUserId?: unknown;
};

/** Anything that carries department membership — a session, a directory row, a user record. */
export type DeptMember = { department?: unknown; extraDepartments?: unknown };

export type DeptScope = {
  /** Normalised department keys. Empty when the viewer has no department — then nothing is in scope. */
  keys: ReadonlySet<string>;
  /** Every workspace department record carrying one of those names. */
  deptIds: ReadonlySet<string>;
  /** The user ids those records are headed by — the fallback for a stale departmentId. */
  ownerIds: ReadonlySet<string>;
};

export const EMPTY_DEPT_SCOPE: DeptScope = {
  keys: new Set<string>(),
  deptIds: new Set<string>(),
  ownerIds: new Set<string>(),
};

/* ---------------- name normalisation ----------------

   The same department reaches us under several names, from three different places that nobody is
   going to keep in step by hand:

     User.department            free text typed (or picked) in Settings — "P&C", "Admin", "OMD"
     departments[].name         picked from DEPARTMENTS when an action owner is added
     the org's own roster       "Finance & Accounts", "Strategic Comms", "Impact & Sustainability"

   normalizeDept folds the mechanical differences (case, punctuation, a redundant trailing
   "Department"), and ALIASES folds the ones no rule could infer. Everything else stays distinct:
   "Operations" and "Credit Operations" are different departments and must never collapse. */

/* Confirmed against the organisation's department roster (2026-08-06). Each entry maps a
   mechanically-normalised name to the canonical key it belongs to.

   THE KEY IS THE PROPER NAME, as confirmed by the Head of Audit — so "Finance & Accounts" folds
   into `finance` and not the other way round, and "Strategic Comms" folds into
   `corporate communications`. The choice of key is invisible to users (it is never displayed;
   components/settings/staff.ts holds the display names) but getting the DIRECTION right keeps
   this table readable against the org chart.

   Two entries are judgement calls the Head of Audit confirmed, recorded here rather than buried
   in a migration:

     finance and accounts → finance
                            The CFO was listed under "Finance" and his three staff under
                            "Finance & Accounts". One department, so all four share its 28
                            observations.
     operations → impact and sustainability
                            "Operations Department" is the workspace record headed by Emmanuel
                            Nwaka, Lead — Impact & Sustainability. The roster retires Operations as
                            a staffed department and puts him and his EA under Impact &
                            Sustainability; the alias is what keeps his existing observation
                            reachable by both of them.

   Everything else is a spelling the register has genuinely been written in at some point. Aliasing
   rather than renaming the workspace department records is deliberate: an observation stores the
   `departmentId` it was raised against, and renaming records would strand it. */
const ALIASES: Record<string, string> = {
  admin: "administration",
  audit: "internal audit",
  credit: "credit operations",
  "credit ops": "credit operations",
  "finance and accounts": "finance",
  "information technology": "it",
  operations: "impact and sustainability",
  omd: "office of the managing director",
  "p and c": "people and culture",
  "strategic communications": "corporate communications",
  "strategic comms": "corporate communications",
  "strategy and innovation": "strategy",
};

export function normalizeDept(name: unknown): string {
  const base = String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+department$/, "")
    .trim();
  return ALIASES[base] ?? base;
}

function asArray(v: unknown): Obj[] {
  return Array.isArray(v) ? (v as Obj[]) : [];
}

/* ---------------- membership ----------------

   Most people belong to one department. Two do not — the Head of Admin, People & Culture sits in
   both, and the Chief of Staff covers Strategic Comms alongside the MD's office — so membership is
   a LIST: `department` is the person's home department (what the UI shows, what the Settings
   dropdown sets) and `extraDepartments` carries any others. Both confer identical access; the
   split exists so one field stays a single value for display. */

/** Every department key a member belongs to. */
export function deptKeysOf(member: DeptMember | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!member) return keys;
  const add = (v: unknown) => {
    const k = normalizeDept(v);
    if (k) keys.add(k);
  };
  add(member.department);
  if (Array.isArray(member.extraDepartments)) member.extraDepartments.forEach(add);
  return keys;
}

/** The scope for a member, resolved against the workspace's department records. */
export function deptScopeFor(
  db: DeptSource | null | undefined,
  member: DeptMember | string | null | undefined,
): DeptScope {
  const keys = deptKeysOf(typeof member === "string" ? { department: member } : member);
  if (!keys.size) return EMPTY_DEPT_SCOPE;
  const deptIds = new Set<string>();
  const ownerIds = new Set<string>();
  for (const d of asArray(db?.departments)) {
    if (!keys.has(normalizeDept(d.name))) continue;
    if (d.id) deptIds.add(String(d.id));
    if (d.headUserId) ownerIds.add(String(d.headUserId));
  }
  return { keys, deptIds, ownerIds };
}

/** True when this record belongs to one of the scoped departments, by either signal.
 *  The secondary owner counts: they already hold personal oversight of the item, so their
 *  department is genuinely party to it — the same rule ownedBy() applies to the individual. */
export function inDeptScope(
  rec: DeptScoped | null | undefined,
  // Tolerates a missing scope: a viewer built without a department (a fixture, or a session
  // whose user has none) simply has nothing in department scope, and must not throw for it.
  scope: DeptScope | null | undefined,
): boolean {
  if (!rec || !scope || !scope.keys.size) return false;
  const did = rec.departmentId;
  if (did && scope.deptIds.has(String(did))) return true;
  const primary = rec.ownerUserId;
  if (primary && scope.ownerIds.has(String(primary))) return true;
  const secondary = rec.secondaryOwnerUserId;
  return !!secondary && scope.ownerIds.has(String(secondary));
}

/** Name of the department a record belongs to, for display ("Raised against Finance Department").
 *  Resolves through departmentId first, then the owner, mirroring inDeptScope(). */
export function deptNameOf(db: DeptSource | null | undefined, rec: DeptScoped | null | undefined): string {
  if (!rec) return "";
  const depts = asArray(db?.departments);
  const byId = rec.departmentId
    ? depts.find((d) => String(d.id) === String(rec.departmentId))
    : undefined;
  if (byId) return String(byId.name || "");
  const owner = rec.ownerUserId;
  const byOwner = owner ? depts.find((d) => d.headUserId && String(d.headUserId) === String(owner)) : undefined;
  return byOwner ? String(byOwner.name || "") : "";
}

/** Members of a department, from a user directory. Used for the in-app fan-out when an
 *  observation is raised against or closed for a department. Honours extraDepartments, so
 *  someone who covers two departments is notified for both. */
export function deptMembers<T extends { id: string; active?: boolean } & DeptMember>(
  users: readonly T[],
  department: unknown,
): T[] {
  const key = normalizeDept(department);
  if (!key) return [];
  return users.filter((u) => u.active !== false && deptKeysOf(u).has(key));
}
