/* The Admin profile: a dedicated account that views AuditLens as any role — and as any
 * department's action owner — so nobody's own account has to carry the admin role, and testing a
 * flow never means signing in as a real person. It signs in with its email and a password at
 * /admin/login; see lib/admin-credential.ts for every limit on that and why.
 *
 *   npx tsx scripts/seed-admin-profile.mts                            → DRY RUN. Writes nothing.
 *   npx tsx scripts/seed-admin-profile.mts --apply                    → creates what is missing.
 *   npx tsx scripts/seed-admin-profile.mts --email=x@y.com --apply    → the same, with that sign-in
 *                                                                       email (or changes it later).
 *   npx tsx scripts/seed-admin-profile.mts --reset-password --apply   → new password. Signs out every
 *                                                                       Admin session and clears a lock-out.
 *   npx tsx scripts/seed-admin-profile.mts --unlock --apply           → clears a lock-out only.
 *
 * THE EMAIL is what you sign in with. Without --email it is ADMIN_PROFILE_EMAIL (admin@credicorp.org),
 * which lib/email.ts never sends to — it is a sign-in name, not a mailbox. Give another address and
 * that inbox receives the Head-level e-mails the Admin profile is sent (it counts as a Head for
 * approvals). It must not be any person's account: the script refuses an address another account
 * already uses. A re-run moves an existing Admin profile onto the address, keeping its password.
 *
 * THE PASSWORD is typed at a hidden prompt (twice), so it is never echoed, never in shell history,
 * and never in this file. Run it in your own terminal — a non-interactive shell has no prompt, and
 * the script stops rather than guess. `--generate` instead makes a random one and prints it ONCE.
 *
 * WHAT IT WRITES (all idempotent — a re-run reports nothing to do):
 *   1. the "AdminCredential" table, if missing. A script rather than `prisma db push` for the same
 *      reason as add-audit-provenance.mts: db push would also try to sync unrelated drift.
 *   2. the Admin account (User row): role admin, Internal Audit, active, every assessment section.
 *   3. its credential: the scrypt hash of the password.
 *
 * Nothing else to set: the sign-in is on by default. ADMIN_LOGIN_ENABLED=false where the app runs
 * is the emergency off switch.
 */

import { randomBytes } from "node:crypto";
import { getPrisma, heading, parseArgs } from "./_migration.mjs";
import { ADMIN_PROFILE_EMAIL, hashPassword, LOCKOUT_MINUTES, normalizeEmail, passwordProblem } from "../lib/admin-credential";
import { ASSESSMENT_VIEWS } from "../lib/permissions";

const ADMIN = {
  name: "AuditLens Admin",
  email: ADMIN_PROFILE_EMAIL,
  department: "Internal Audit",
};

const ctx = parseArgs();
const resetPassword = ctx.argv.includes("--reset-password");
const unlock = ctx.argv.includes("--unlock");
const generate = ctx.argv.includes("--generate");
const emailArg = ctx.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
const wantEmail = normalizeEmail(emailArg ?? ADMIN.email);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wantEmail)) throw new Error(`"${wantEmail}" is not an email address.`);
const prisma = await getPrisma();

/* ---------------------------------------------------------------- password input */

function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buf = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new Error("Cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function obtainPassword(): Promise<string> {
  if (generate) {
    const pw = randomBytes(18).toString("base64url");
    console.log(`\n  Generated password (shown once — store it now):  ${pw}\n`);
    return pw;
  }
  if (!process.stdin.isTTY) {
    throw new Error(
      "No terminal to prompt in. Run this in your own terminal (VS Code → Terminal → New Terminal) " +
        "so the password is typed at a hidden prompt — or add --generate to have one made and printed once.",
    );
  }
  for (;;) {
    const pw = await promptHidden("  New Admin password: ");
    const problem = passwordProblem(pw);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    if ((await promptHidden("  Type it again:      ")) !== pw) {
      console.log("  They did not match.");
      continue;
    }
    return pw;
  }
}

/* ---------------------------------------------------------------- what is there */

const [{ exists: tableExists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'AdminCredential') AS exists
`;

/* The first version of this script (2026-10-12, same day) signed in by a separate username and gave
   the table a required "username" column. The sign-in name is now the account's email; the column
   is dropped so it cannot block the next credential row from being written. */
const [{ exists: legacyUsername }] = await prisma.$queryRaw<{ exists: boolean }[]>`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'AdminCredential' AND column_name = 'username'
  ) AS exists
`;

// The Admin profile already set up, if any: the account holding a credential. There is only one.
const creds = tableExists ? await prisma.adminCredential.findMany({ include: { user: true } }) : [];
if (creds.length > 1) {
  throw new Error(`${creds.length} accounts hold an Admin password (${creds.map((c) => c.user.email).join(", ")}). Resolve that by hand.`);
}
const cred = creds[0] ?? null;
let user = cred?.user ?? null;

/* The chosen email must not be a person's account. The only existing account it may adopt is one
   this script created on an earlier run that stopped before the password was set. */
const holder = await prisma.user.findUnique({ where: { email: wantEmail } });
if (holder && holder.id !== user?.id) {
  if (user) throw new Error(`${wantEmail} already belongs to ${holder.name}. The Admin profile is ${user.email}; choose another address.`);
  if (holder.name !== ADMIN.name) {
    throw new Error(`${wantEmail} is ${holder.name}'s account (${holder.role}). The Admin profile needs an address no account uses.`);
  }
  user = holder;
}

const sidebarAccess = [...ASSESSMENT_VIEWS];
const userFix: string[] = [];
if (user) {
  if (user.email !== wantEmail) userFix.push(`email ${user.email} → ${wantEmail}`);
  if (user.role !== "admin") userFix.push(`role ${user.role} → admin`);
  if (user.active === false) userFix.push("inactive → active");
}
const locked = !!cred?.lockedUntil && cred.lockedUntil > new Date();

heading("Admin profile");
console.log(
  `  Table "AdminCredential":  ${tableExists ? "present" : "MISSING — will be created"}` +
    (legacyUsername ? ` — its old "username" column will be dropped (you now sign in with the email)` : ""),
);
console.log(
  `  Account:   ` +
    (!user
      ? `MISSING — ${wantEmail} will be created`
      : userFix.length
        ? `${user.email} needs ${userFix.join(", ")}`
        : `${user.email} (${user.name})`),
);
console.log(
  `  Password:  ` +
    (!cred
      ? "MISSING — you will be asked for one"
      : resetPassword
        ? "will be REPLACED, and every Admin session signed out"
        : `set; last sign-in ${cred.lastLoginAt?.toISOString() ?? "never"}` +
          (locked ? `; LOCKED until ${cred.lockedUntil!.toISOString()}` : "")),
);
if (unlock && cred) console.log(`  Lock-out:  ${locked || cred.failedAttempts ? "will be cleared" : "none to clear"}`);
if (wantEmail !== ADMIN_PROFILE_EMAIL) {
  console.log(`\n  Note: ${wantEmail} is a real address — it will receive the Head-level e-mails the Admin profile is sent.`);
}

const work =
  !tableExists || legacyUsername || !user || userFix.length || !cred || resetPassword ||
  (unlock && cred && (locked || cred.failedAttempts));
if (!work) {
  console.log("\nNothing to do.");
  if (locked) console.log(`It is locked for up to ${LOCKOUT_MINUTES} minutes; --unlock --apply clears that now.`);
  await prisma.$disconnect();
  process.exit(0);
}
if (!ctx.apply) {
  console.log(
    !cred || resetPassword
      ? "\nDRY RUN — nothing written. Re-run with --apply, in your own terminal, to be asked for the password."
      : "\nDRY RUN — nothing written. Re-run with --apply (no password needed for this)."
  );
  await prisma.$disconnect();
  process.exit(0);
}

/* ---------------------------------------------------------------- apply */

// Asked for before anything is written, so cancelling the prompt leaves the database untouched.
const password = !cred || resetPassword ? await obtainPassword() : null;

if (!tableExists) {
  // Fixed DDL, no input — mirrors the model in prisma/schema.prisma, with Prisma's own index names
  // so a later `prisma db push` sees it as already in place.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AdminCredential" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "failedAttempts" INTEGER NOT NULL DEFAULT 0,
      "lockedUntil" TIMESTAMP(3),
      "lastLoginAt" TIMESTAMP(3),
      "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
    )`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AdminCredential_userId_key" ON "AdminCredential"("userId")`);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminCredential_userId_fkey') THEN
        ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`);
  console.log(`  Created table "AdminCredential"`);
}
if (legacyUsername) {
  // Takes its unique index with it.
  await prisma.$executeRawUnsafe(`ALTER TABLE "AdminCredential" DROP COLUMN IF EXISTS "username"`);
  console.log(`  Dropped the old "username" column`);
}

const admin = user
  ? userFix.length
    ? await prisma.user.update({ where: { id: user.id }, data: { email: wantEmail, role: "admin", active: true } })
    : user
  : await prisma.user.create({
      data: {
        name: ADMIN.name,
        email: wantEmail,
        department: ADMIN.department,
        role: "admin",
        sidebarAccess,
        active: true,
        // Stamped so the "your account is ready" e-mail is never sent for it.
        welcomeEmailSentAt: new Date(),
      },
    });
if (!user) console.log(`  Created the account ${wantEmail}`);
else if (userFix.length) console.log(`  Updated the account: ${userFix.join(", ")}`);

const now = new Date();
if (password) {
  const passwordHash = await hashPassword(password);
  await prisma.adminCredential.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, passwordHash, passwordChangedAt: now },
    // passwordChangedAt is what voids every session signed before it (lib/auth.ts).
    update: { passwordHash, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null },
  });
  console.log(cred ? "  Password replaced; every Admin session is signed out." : "  Password set.");
} else if (unlock && cred) {
  await prisma.adminCredential.update({ where: { id: cred.id }, data: { failedAttempts: 0, lockedUntil: null } });
  console.log("  Lock-out cleared.");
}

console.log(`\nDone. Sign in at /admin/login with ${admin.email}.`);
await prisma.$disconnect();
