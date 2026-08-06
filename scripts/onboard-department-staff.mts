/* Onboard the rest of the organisation as action owners.
 *
 *   npx tsx scripts/onboard-department-staff.mts            DRY RUN — prints the plan, writes nothing
 *   npx tsx scripts/onboard-department-staff.mts --apply    creates the accounts
 *
 * Flags:
 *   --active                    create the accounts able to sign in immediately (see below)
 *   --include-exco-recipients   also create accounts for the MD/EXCO brief recipients (see below)
 *
 * WHY THIS EXISTS. Observations are visible to a whole DEPARTMENT now (lib/dept-scope.ts), not
 * just to the one person they are assigned to — but only for people who actually hold an account.
 * Eleven of the organisation's forty-two staff do. This provisions the rest from the same
 * STAFF_DIRECTORY the Add-user dialog autocompletes against, so the two cannot drift.
 *
 * NO EMAIL IS SENT, deliberately (requested 2026-08-05: "don't send their mail yet"). It writes
 * to the database directly rather than through POST /api/users, which sends a welcome email to
 * every active account it creates. `welcomeEmailSentAt` is left null, so the Head of Audit
 * activating an account in Settings still sends that person their one welcome email, exactly as
 * it does for the accounts loaded at go-live.
 *
 *   default        active: false — provisioned, sign-in blocked, nobody told. Activating them in
 *                  Settings is what both opens sign-in AND sends the welcome email.
 *   --active       active: true — they can sign in and see their department's observations today.
 *                  The cost: activation is the trigger for the welcome email, so an account
 *                  created already-active will never fire it (PATCH /api/users/:id only sends on
 *                  an inactive→active transition). Those people have to be told out of band.
 *
 * THE MD AND EXCO ARE SKIPPED BY DEFAULT. `exco.recipientList` is the population that receives the
 * Board assurance brief as a tokenised link precisely so they do NOT need to be inside the app —
 * scripts/verify-backlog.mts asserts on how many of them hold accounts. Giving them one is a
 * governance decision for the Head of Audit, not a side effect of an onboarding script, so they
 * are listed and skipped unless --include-exco-recipients says otherwise.
 *
 * Idempotent: anyone whose email already exists is skipped and reported. Existing accounts are
 * NEVER modified — where the live department disagrees with STAFF_DIRECTORY (Michael Ojo sits in
 * "Corporate Communications" live and "Strategy Department" in the directory) the mismatch is
 * reported for a human to settle, because that one field now decides what they can see.
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
import { STAFF_DIRECTORY, staffEmail } from "../components/settings/staff";
import { deptScopeFor, inDeptScope, normalizeDept } from "../lib/dept-scope";
import type { WorkspaceDb } from "../lib/workspace/types";

const NAME = "onboard-department-staff";
const ctx = parseArgs();
const wantActive = ctx.argv.includes("--active");
const includeExco = ctx.argv.includes("--include-exco-recipients");

const prisma = await getPrisma();
const db = (await readWorkspace()) as unknown as WorkspaceDb;

const existing = await prisma.user.findMany({
  select: { id: true, name: true, email: true, department: true, role: true, active: true },
});
const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

const excoEmails = new Set(
  (db.exco?.recipientList || [])
    .map((r) => String(r.email || "").toLowerCase())
    .filter(Boolean),
);

/** Approved observations this department would see, so the dry run shows what the account is for. */
const approvedObs = (db.audits || [])
  .flatMap((a) => (a.reports || []).flatMap((r) => r.observations || []))
  .filter((o) => o.obsApproval !== "pending" && o.obsApproval !== "rejected");

function obsCountFor(department: string): number {
  const scope = deptScopeFor(db, department);
  return approvedObs.filter((o) => inDeptScope(o, scope)).length;
}

type Plan = { name: string; email: string; department: string; title: string; obs: number };

const toCreate: Plan[] = [];
const skippedExisting: Record<string, string>[] = [];
const skippedExco: Record<string, string>[] = [];
const noEmail: string[] = [];

for (const [name, title, department] of STAFF_DIRECTORY) {
  const email = staffEmail(name);
  if (!email) {
    noEmail.push(name);
    continue;
  }
  const hit = byEmail.get(email);
  if (hit) {
    const mismatch = normalizeDept(hit.department) !== normalizeDept(department);
    skippedExisting.push({
      name: hit.name,
      email,
      role: hit.role,
      "live department": hit.department + (mismatch ? `  (directory says: ${department})` : ""),
      sees: String(obsCountFor(hit.department)),
    });
    continue;
  }
  if (excoEmails.has(email) && !includeExco) {
    skippedExco.push({ name, email, department, why: "MD/EXCO brief recipient" });
    continue;
  }
  toCreate.push({ name, email, department, title, obs: obsCountFor(department) });
}

/* ------------------------------------------------------------------ report */

heading(`${NAME} — provision the organisation as action owners`);

console.log(
  `\n  ${STAFF_DIRECTORY.length} staff in the directory · ${existing.length} already hold an account\n` +
    `  New accounts would be created: role=action_owner, active=${wantActive}, welcome email NOT sent\n`,
);

section("Already have an account — skipped, never modified", skippedExisting.length);
table(skippedExisting, { name: 22, "live department": 46 });

if (skippedExco.length) {
  section("MD / EXCO brief recipients — skipped", skippedExco.length);
  table(skippedExco, { name: 22 });
  console.log(
    "\n  These receive the Board assurance brief as a tokenised link and hold no account by design.\n" +
      "  Re-run with --include-exco-recipients if the Head of Audit wants them inside the app.",
  );
}

if (noEmail.length) {
  section("No derivable email — skipped", noEmail.length);
  for (const n of noEmail) console.log(`  ${n}`);
}

section("To create", toCreate.length);
table(
  toCreate.map((p) => ({
    name: p.name,
    email: p.email,
    department: p.department,
    "job title": p.title,
    "observations they will see": String(p.obs),
  })),
  { name: 22, department: 32, "job title": 40 },
);

/* A department with no observations is not an error — it means Internal Audit has raised nothing
   against it yet. A department whose name matches NO department record is worth knowing about:
   nothing will ever reach those people until one exists under that name. */
const unmatched = [...new Set(toCreate.filter((p) => !deptScopeFor(db, p.department).deptIds.size).map((p) => p.department))];
if (unmatched.length) {
  section("Departments with no matching department record in the workspace", unmatched.length);
  for (const d of unmatched) console.log(`  ${d}`);
  console.log(
    "\n  Staff in these departments will see nothing until Internal Audit adds an action owner for\n" +
      "  a department of that name (Settings → Action Owners), which is what creates the record.",
  );
}

/* ------------------------------------------------------------------ apply */

if (ctx.apply && toCreate.length) {
  const { writeAuditLog } = await import("../lib/audit-log");
  console.log("");
  for (const p of toCreate) {
    const user = await prisma.user.create({
      data: {
        name: p.name,
        email: p.email,
        department: p.department,
        role: "action_owner",
        active: wantActive,
        sidebarAccess: [],
        // welcomeEmailSentAt deliberately left null — see the header.
      },
    });
    console.log(`  created  ${p.email.padEnd(28)} ${p.department}`);
    await writeAuditLog({
      user: null,
      action: "user.created",
      category: "user",
      summary:
        `Provisioned action owner ${p.name} (${p.email}) for ${p.department} — ` +
        `${wantActive ? "active" : "inactive"}, welcome email deferred`,
      metadata: {
        targetUserId: user.id,
        targetEmail: p.email,
        role: "action_owner",
        active: wantActive,
        emailSent: false,
        script: NAME,
      },
    }).catch(() => {});
  }
  if (!wantActive) {
    console.log(
      "\n  These accounts are INACTIVE. Activate each in Settings → Users when you are ready —\n" +
        "  that is what unblocks sign-in and sends them their one welcome email.",
    );
  } else {
    console.log(
      "\n  These accounts are ACTIVE and no email went out. Because activation is what releases the\n" +
        "  welcome email, it will not fire for them later — tell them out of band.",
    );
  }
}

outcome(ctx, toCreate.length, NAME);

await prisma.$disconnect();
