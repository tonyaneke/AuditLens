/* The Admin profile: a dedicated account that views AuditLens as any role — and as any
 * department's action owner — so nobody's own account has to carry the admin role, and testing a
 * flow never means signing in as a real person. It signs in with a password at /admin/login; see
 * lib/admin-credential.ts for every limit on that and why.
 *
 *   npx tsx scripts/seed-admin-profile.mts                            → DRY RUN. Writes nothing.
 *   npx tsx scripts/seed-admin-profile.mts --apply                    → creates what is missing.
 *   npx tsx scripts/seed-admin-profile.mts --reset-password --apply   → new password. Signs out every
 *                                                                       Admin session and clears a lock-out.
 *   npx tsx scripts/seed-admin-profile.mts --unlock --apply           → clears a lock-out only.
 *
 * THE PASSWORD is typed at a hidden prompt (twice), so it is never echoed, never in shell history,
 * and never in this file. Run it in your own terminal — a non-interactive shell has no prompt, and
 * the script stops rather than guess. `--generate` instead makes a random one and prints it ONCE.
 *
 * WHAT IT WRITES (all idempotent — a re-run reports nothing to do):
 *   1. the "AdminCredential" table, if missing. A script rather than `prisma db push` for the same
 *      reason as add-audit-provenance.mts: db push would also try to sync unrelated drift.
 *   2. the Admin account (User row): role admin, Internal Audit, active, every assessment section.
 *      Its address is on the reserved .invalid TLD — it has no mailbox, and lib/email.ts skips it.
 *   3. its credential: username "admin" and the scrypt hash of the password.
 *
 * Nothing else to set: the sign-in is on by default. ADMIN_LOGIN_ENABLED=false where the app runs
 * is the emergency off switch.
 */

import { randomBytes } from "node:crypto";
import { getPrisma, heading, parseArgs } from "./_migration.mjs";
import { hashPassword, LOCKOUT_MINUTES, passwordProblem } from "../lib/admin-credential";
import { ASSESSMENT_VIEWS } from "../lib/permissions";

const ADMIN = {
  username: "admin",
  name: "AuditLens Admin",
  email: "admin@auditlens.invalid",
  department: "Internal Audit",
};

const ctx = parseArgs();
const resetPassword = ctx.argv.includes("--reset-password");
const unlock = ctx.argv.includes("--unlock");
const generate = ctx.argv.includes("--generate");
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
const user = await prisma.user.findUnique({ where: { email: ADMIN.email } });
const cred = tableExists
  ? await prisma.adminCredential.findUnique({ where: { username: ADMIN.username } })
  : null;
if (cred && user && cred.userId !== user.id) {
  throw new Error(`The username "${ADMIN.username}" belongs to another account (${cred.userId}). Resolve that by hand.`);
}

const sidebarAccess = [...ASSESSMENT_VIEWS];
const userFix: string[] = [];
if (user) {
  if (user.role !== "admin") userFix.push(`role ${user.role} → admin`);
  if (user.active === false) userFix.push("inactive → active");
}
const locked = !!cred?.lockedUntil && cred.lockedUntil > new Date();

heading("Admin profile");
console.log(`  Table "AdminCredential":  ${tableExists ? "present" : "MISSING — will be created"}`);
console.log(
  `  Account ${ADMIN.email}:  ` +
    (!user ? "MISSING — will be created" : userFix.length ? `needs ${userFix.join(", ")}` : `present (${user.name})`),
);
console.log(
  `  Sign-in "${ADMIN.username}":  ` +
    (!cred
      ? "MISSING — a password will be set"
      : resetPassword
        ? "present — the password will be REPLACED and every Admin session signed out"
        : `present, last used ${cred.lastLoginAt?.toISOString() ?? "never"}` +
          (locked ? `, LOCKED until ${cred.lockedUntil!.toISOString()}` : "")),
);
if (unlock && cred) console.log(`  Lock-out:  ${locked || cred.failedAttempts ? "will be cleared" : "none to clear"}`);

const work = !tableExists || !user || userFix.length || !cred || resetPassword || (unlock && cred && (locked || cred.failedAttempts));
if (!work) {
  console.log("\nNothing to do.");
  if (locked) console.log(`It is locked for up to ${LOCKOUT_MINUTES} minutes; --unlock --apply clears that now.`);
  await prisma.$disconnect();
  process.exit(0);
}
if (!ctx.apply) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply, in your own terminal, to be asked for the password.");
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
      "username" TEXT NOT NULL,
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
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AdminCredential_username_key" ON "AdminCredential"("username")`);
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminCredential_userId_fkey') THEN
        ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END $$`);
  console.log(`  Created table "AdminCredential"`);
}

const admin = user
  ? userFix.length
    ? await prisma.user.update({ where: { id: user.id }, data: { role: "admin", active: true } })
    : user
  : await prisma.user.create({
      data: {
        name: ADMIN.name,
        email: ADMIN.email,
        department: ADMIN.department,
        role: "admin",
        sidebarAccess,
        active: true,
        // There is no mailbox; stamping this keeps the activation e-mail from ever being attempted.
        welcomeEmailSentAt: new Date(),
      },
    });
if (!user) console.log(`  Created the account ${ADMIN.email}`);
else if (userFix.length) console.log(`  Updated the account: ${userFix.join(", ")}`);

const now = new Date();
if (password) {
  const passwordHash = await hashPassword(password);
  await prisma.adminCredential.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, username: ADMIN.username, passwordHash, passwordChangedAt: now },
    // passwordChangedAt is what voids every session signed before it (lib/auth.ts).
    update: { passwordHash, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null },
  });
  console.log(cred ? "  Password replaced; every Admin session is signed out." : `  Password set for "${ADMIN.username}".`);
} else if (unlock && cred) {
  await prisma.adminCredential.update({ where: { id: cred.id }, data: { failedAttempts: 0, lockedUntil: null } });
  console.log("  Lock-out cleared.");
}

console.log(
  `\nDone. Sign in at /admin/login as "${ADMIN.username}".`,
);
await prisma.$disconnect();
