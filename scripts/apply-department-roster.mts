/* Bring the live accounts in line with the organisation's department roster.
 *
 *   npx tsx scripts/apply-department-roster.mts            DRY RUN — prints the plan, writes nothing
 *   npx tsx scripts/apply-department-roster.mts --apply    applies it
 *
 * THE ROSTER IS components/settings/staff.ts — `STAFF_DIRECTORY` plus `STAFF_EXTRA_DEPARTMENTS`.
 * This script does not carry its own copy of it, because the copy would be the one that rots: the
 * same list drives the Add-user autocomplete, so anything applied here is what Settings offers.
 *
 * It does four things, and nothing else:
 *   1. moves people whose department changed
 *   2. sets the second department for those who cover two
 *   3. creates accounts for anyone on the roster who has none
 *   4. REMOVES accounts for people no longer on it (--apply only, and never anyone privileged)
 *
 * A change of department and a change of SPELLING are reported separately, because they mean
 * different things. "Finance Department" → "Finance & Accounts" grants and revokes nothing — the
 * alias table in lib/dept-scope.ts already makes those one department — but it is still applied,
 * because the stored string is what every screen prints under the person's name, and leaving
 * people labelled with a retired department is how the roster starts drifting again.
 *
 * NO EMAIL IS EVER SENT. Accounts are created with `active: true` and `welcomeEmailSentAt` left
 * null, matching how the 25 onboarded on 2026-08-06 were created — the welcome email is the Head
 * of Audit's to send. See [[welcome-email-on-activation]] in the project notes.
 *
 * REMOVALS ARE DELETIONS, and deliberately narrow: only an `action_owner` who holds no assigned
 * work may be deleted. Anyone who owns an observation, external finding or fraud action is
 * reported and SKIPPED — deleting them would leave records pointing at a user id that resolves to
 * nothing, and the register would show "unassigned" against work that was genuinely done. Nobody
 * with a head_of_audit, audit_staff or admin role is ever touched.
 */

import {
  getPrisma,
  heading,
  outcome,
  parseArgs,
  readWorkspace,
  section,
  table,
} from "./_migration.mjs";
import {
  STAFF_DIRECTORY,
  STAFF_EXTRA_DEPARTMENTS,
  staffEmail,
} from "../components/settings/staff";
import { deptScopeFor, inDeptScope, normalizeDept } from "../lib/dept-scope";
import type { WorkspaceDb } from "../lib/workspace/types";

const NAME = "apply-department-roster";
const ctx = parseArgs();

const prisma = await getPrisma();
const db = (await readWorkspace()) as unknown as WorkspaceDb;

/** Roles this script will never delete or reassign — Internal Audit's own accounts. */
const PROTECTED_ROLES = new Set(["head_of_audit", "audit_staff", "admin"]);

const existing = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
    department: true,
    extraDepartments: true,
    role: true,
    active: true,
  },
});
const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

/* The roster, keyed by the email every account is derived from. */
type Row = { name: string; title: string; department: string; extras: string[]; email: string };
const roster: Row[] = STAFF_DIRECTORY.map(([name, title, department]) => ({
  name,
  title,
  department,
  extras: STAFF_EXTRA_DEPARTMENTS[name] || [],
  email: staffEmail(name),
})).filter((r) => !!r.email);
const rosterEmails = new Set(roster.map((r) => r.email));

/* Work assigned to each user id — what makes a removal unsafe. */
const assigned = new Map<string, number>();
const bump = (id: unknown) => {
  if (typeof id === "string" && id) assigned.set(id, (assigned.get(id) || 0) + 1);
};
for (const a of db.audits || []) {
  for (const r of a.reports || []) {
    for (const o of r.observations || []) {
      bump(o.ownerUserId);
      bump(o.secondaryOwnerUserId);
    }
  }
}
for (const f of db.extFindings || []) {
  bump(f.ownerUserId);
  bump(f.secondaryOwnerUserId);
}
for (const f of db.fraudRisks || []) {
  bump(f.ownerUserId);
  for (const act of f.actions || []) bump(act.ownerUserId);
}
/** Department records they head — deleting the head would strand the record's observations. */
const headsDept = new Set((db.departments || []).map((d) => d.headUserId).filter(Boolean));

/** Approved observations a given membership would see, so the plan shows the consequence. */
const approvedObs = (db.audits || [])
  .flatMap((a) => (a.reports || []).flatMap((r) => r.observations || []))
  .filter((o) => o.obsApproval !== "pending" && o.obsApproval !== "rejected");
function obsCountFor(department: string, extras: string[]): number {
  const scope = deptScopeFor(db, { department, extraDepartments: extras });
  return approvedObs.filter((o) => inDeptScope(o, scope)).length;
}

const sameDepts = (a: string[], b: string[]) => {
  const ka = new Set(a.map(normalizeDept).filter(Boolean));
  const kb = new Set(b.map(normalizeDept).filter(Boolean));
  return ka.size === kb.size && [...ka].every((k) => kb.has(k));
};

/* ------------------------------------------------------------------ plan */

type Update = { id: string; email: string; name: string; from: string; to: string; obs: string };
const moves: Update[] = [];
const renames: Update[] = [];
const creates: Row[] = [];
const unchanged: string[] = [];

const label = (d: string, x: string[]) => (x.length ? `${d} + ${x.join(" + ")}` : d);

for (const r of roster) {
  const hit = byEmail.get(r.email);
  if (!hit) {
    creates.push(r);
    continue;
  }
  if (PROTECTED_ROLES.has(hit.role)) {
    // Internal Audit's own accounts keep whatever department they have; their scope is total.
    unchanged.push(`${hit.name} (${hit.role})`);
    continue;
  }
  const curExtras = Array.isArray(hit.extraDepartments) ? (hit.extraDepartments as string[]) : [];
  const from = label(hit.department, curExtras);
  const to = label(r.department, r.extras);
  if (from === to) {
    unchanged.push(hit.name);
    continue;
  }
  const update: Update = {
    id: hit.id,
    email: r.email,
    name: r.name,
    from,
    to,
    obs: `${obsCountFor(hit.department, curExtras)} → ${obsCountFor(r.department, r.extras)}`,
  };
  // Same department under a new name changes nothing about access; a different one does.
  const sameAccess =
    normalizeDept(hit.department) === normalizeDept(r.department) && sameDepts(curExtras, r.extras);
  (sameAccess ? renames : moves).push(update);
}

type Removal = { id: string; name: string; email: string; role: string; why: string; safe: boolean };
const removals: Removal[] = [];
for (const u of existing) {
  if (rosterEmails.has(u.email.toLowerCase())) continue;
  const work = assigned.get(u.id) || 0;
  const isHead = headsDept.has(u.id);
  const safe = !PROTECTED_ROLES.has(u.role) && work === 0 && !isHead;
  removals.push({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    why: PROTECTED_ROLES.has(u.role)
      ? "Internal Audit account — never touched"
      : isHead
        ? "heads a department record"
        : work
          ? `${work} record(s) assigned to them`
          : "no assigned work",
    safe,
  });
}

/* ------------------------------------------------------------------ report */

heading(`${NAME} — align live accounts with the department roster`);
console.log(
  `\n  Roster: ${roster.length} people · Live accounts: ${existing.length}\n` +
    `  Source of truth: components/settings/staff.ts\n`,
);

section("Department MOVES — these change what the person can see", moves.length);
table(
  moves.map((u) => ({ name: u.name, from: u.from, to: u.to, "observations seen": u.obs })),
  { name: 22, from: 32, to: 36 },
);

section("Renames only — same department, canonical spelling, no access change", renames.length);
table(
  renames.map((u) => ({ name: u.name, from: u.from, to: u.to, "observations seen": u.obs })),
  { name: 22, from: 32, to: 36 },
);

section("Accounts to create", creates.length);
table(
  creates.map((r) => ({
    name: r.name,
    email: r.email,
    department: r.department,
    "job title": r.title,
    "will see": String(obsCountFor(r.department, r.extras)),
  })),
  { name: 22, department: 26, "job title": 34 },
);

const toDelete = removals.filter((r) => r.safe);
const kept = removals.filter((r) => !r.safe);
section("Accounts to remove — not on the roster", toDelete.length);
table(
  toDelete.map((r) => ({ name: r.name, email: r.email, role: r.role, why: r.why })),
  { name: 22 },
);
if (kept.length) {
  section("Off the roster but KEPT — removal would strand data", kept.length);
  table(kept.map((r) => ({ name: r.name, email: r.email, role: r.role, why: r.why })), { name: 22 });
  console.log("\n  Reassign their work in AuditLens first if these accounts really must go.");
}

console.log(`\n  Unchanged: ${unchanged.length}`);

/* A department nobody's observations resolve to is worth knowing about before, not after.
   Internal Audit is excluded: its people are full-scope by role and never need a record. */
const empty = [...new Set(roster.map((r) => r.department))]
  .filter((d) => normalizeDept(d) !== "internal audit")
  .filter((d) => !deptScopeFor(db, { department: d }).deptIds.size)
  .sort();
if (empty.length) {
  section("Roster departments with no department record in the workspace", empty.length);
  for (const d of empty) console.log(`  ${d}`);
  console.log(
    "\n  Nobody in these sees anything until Internal Audit adds an action owner for a department\n" +
      "  of that name (Settings → Action Owners), which is what creates the record.",
  );
}

/* ------------------------------------------------------------------ apply */

const changes = moves.length + renames.length + creates.length + toDelete.length;

if (ctx.apply && changes) {
  const { writeAuditLog } = await import("../lib/audit-log");
  console.log("");

  for (const [kind, list] of [["moved", moves], ["renamed", renames]] as const) {
    for (const u of list) {
      const r = roster.find((x) => x.email === u.email)!;
      await prisma.user.update({
        where: { id: u.id },
        data: { department: r.department, extraDepartments: r.extras },
      });
      console.log(`  ${kind.padEnd(8)} ${u.email.padEnd(28)} ${u.from}  →  ${u.to}`);
      await writeAuditLog({
        user: null,
        action: "user.updated",
        category: "user",
        summary:
          `Department roster: ${kind} ${u.name} (${u.email}) from ${u.from} to ${u.to}` +
          (kind === "renamed" ? " — canonical spelling, access unchanged" : ""),
        metadata: { targetUserId: u.id, targetEmail: u.email, from: u.from, to: u.to, kind, script: NAME },
      }).catch(() => {});
    }
  }

  for (const r of creates) {
    const user = await prisma.user.create({
      data: {
        name: r.name,
        email: r.email,
        department: r.department,
        extraDepartments: r.extras,
        role: "action_owner",
        active: true,
        sidebarAccess: [],
        // welcomeEmailSentAt left null — no email goes out from here.
      },
    });
    console.log(`  created  ${r.email.padEnd(28)} ${r.department}`);
    await writeAuditLog({
      user: null,
      action: "user.created",
      category: "user",
      summary: `Department roster: created action owner ${r.name} (${r.email}) for ${r.department} — active, no welcome email`,
      metadata: {
        targetUserId: user.id,
        targetEmail: r.email,
        role: "action_owner",
        active: true,
        emailSent: false,
        script: NAME,
      },
    }).catch(() => {});
  }

  for (const r of toDelete) {
    await prisma.user.delete({ where: { id: r.id } });
    console.log(`  removed  ${r.email.padEnd(28)} ${r.role}`);
    await writeAuditLog({
      user: null,
      action: "user.deleted",
      category: "user",
      summary: `Department roster: removed ${r.name} (${r.email}) — no longer on the roster, ${r.why}`,
      metadata: { targetUserId: r.id, targetEmail: r.email, role: r.role, script: NAME },
    }).catch(() => {});
  }

  console.log(
    "\n  No emails were sent. Newly created accounts are active and un-welcomed — tell those\n" +
      "  people out of band, as with the 2026-08-06 onboarding.",
  );
}

outcome(ctx, changes, NAME);

await prisma.$disconnect();
