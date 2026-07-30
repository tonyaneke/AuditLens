/* SEC-03 — drop the vestigial local-password columns from "User".
 *
 *   npx tsx scripts/drop-local-password.mts           → DRY RUN. Reports what it would do.
 *   npx tsx scripts/drop-local-password.mts --apply   → drops the columns.
 *
 * DEPLOY ORDER MATTERS. Run this only AFTER the code that stops reading the columns is live on
 * every instance. Prisma's generated client selects all scalar columns by default, so an instance
 * still running the previous build would fail every `prisma.user.findUnique` — i.e. every
 * authenticated request — the moment the columns disappear.
 *
 *   1. Deploy the code (columns still present, simply unused). Old and new instances coexist.
 *   2. Confirm nothing is serving the old build.
 *   3. Run this with --apply.
 *
 * Existing session cookies carry a now-ignored `mustChangePassword` claim; getSession() no longer
 * reads it, so nobody is signed out by this change.
 *
 * What is being dropped:
 *   passwordHash        — non-null, held bcrypt(randomToken()) for every in-app-created user and
 *                         bcrypt(HEAD_AUDIT_PASSWORD) for the seeded head. Nothing ever compared
 *                         against it: verifyPassword() had no call sites in the repo.
 *   mustChangePassword  — set false by every code path that created a user, and no UI or endpoint
 *                         could set a password to clear it.
 */

import { getPrisma, parseArgs } from "./_migration.mjs";

const COLUMNS = ["passwordHash", "mustChangePassword"] as const;

async function main() {
  const ctx = parseArgs();
  const prisma = await getPrisma();

  const present = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = ANY(${[...COLUMNS]}::text[])
  `;
  const found = present.map((r) => r.column_name);

  console.log(`\nDrop local-password columns from "User"\n${"=".repeat(38)}`);
  if (!found.length) {
    console.log("\nNeither column is present — already applied. Nothing to do.");
    return;
  }

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "User"
  `;
  console.log(`\n  Users in table:      ${count}`);
  console.log(`  Columns to drop:     ${found.join(", ")}`);
  console.log(`  Columns already gone: ${COLUMNS.filter((c) => !found.includes(c)).join(", ") || "(none)"}`);

  if (!ctx.apply) {
    console.log(
      `\nDRY RUN — nothing written.\n` +
        `Confirm no instance is still running the pre-SEC-03 build, then re-run with:\n` +
        `  npx tsx scripts/drop-local-password.mts --apply`,
    );
    return;
  }

  // Column names are from the fixed COLUMNS list above, never from input, so the interpolation
  // here cannot be influenced by anything external. $executeRawUnsafe is required because DDL
  // cannot take bound parameters for identifiers.
  for (const col of found) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP COLUMN "${col}"`);
    console.log(`  Dropped "User"."${col}"`);
  }
  console.log(
    `\nApplied. Re-run without --apply to confirm it now reports nothing to do.\n` +
      `Remember to delete HEAD_AUDIT_PASSWORD from .env and the deployment environment.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const prisma = await getPrisma();
    await prisma.$disconnect();
  });
