/* Add the provenance columns to "AuditLog" — who was really at the keyboard for each entry.
 *
 *   npx tsx scripts/add-audit-provenance.mts           → DRY RUN. Reports what is missing.
 *   npx tsx scripts/add-audit-provenance.mts --apply   → adds the columns and indexes.
 *
 * DEPLOY ORDER: RUN THIS FIRST, then deploy. It is the reverse of drop-local-password.mts, and for
 * the same reason. Prisma names every column it writes, so the new code's audit writes fail on a
 * table without these columns — and several routes (sign-out, user management) await that write.
 * The old code is unaffected by columns it does not know about: Prisma selects by name, so extra
 * nullable columns are invisible to it. Adding first is therefore safe while old instances serve.
 *
 * Why a script and not `prisma db push`: the schema no longer declares User.passwordHash and
 * User.mustChangePassword, but production still has them until drop-local-password.mts is applied.
 * `db push` would try to drop them as part of the same sync. This touches "AuditLog" only.
 *
 * Idempotent: every statement is IF NOT EXISTS, and a re-run reports nothing to do. Existing rows
 * are untouched — they keep null provenance, which the log viewer shows as "not recorded".
 *
 * Index names match what Prisma generates for the @@index lines in schema.prisma, so a future
 * `prisma db push` or `migrate diff` sees them as already in place.
 */

import { getPrisma, parseArgs } from "./_migration.mjs";

// Fixed names only — never input — so interpolating them into DDL below is safe.
const COLUMNS = ["userRole", "authMethod", "actorName", "sessionId", "ip", "userAgent"] as const;
const INDEXES = [
  ["AuditLog_sessionId_idx", "sessionId"],
  ["AuditLog_authMethod_idx", "authMethod"],
] as const;

async function main() {
  const ctx = parseArgs();
  const prisma = await getPrisma();

  const present = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'AuditLog' AND column_name = ANY(${[...COLUMNS]}::text[])
  `;
  const have = new Set(present.map((r) => r.column_name));
  const missingCols = COLUMNS.filter((c) => !have.has(c));

  const idx = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'AuditLog' AND indexname = ANY(${INDEXES.map(([n]) => n)}::text[])
  `;
  const haveIdx = new Set(idx.map((r) => r.indexname));
  const missingIdx = INDEXES.filter(([n]) => !haveIdx.has(n));

  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "AuditLog"
  `;

  console.log(`\nAdd provenance columns to "AuditLog"\n${"=".repeat(36)}`);
  console.log(`\n  Rows in table:     ${count} (untouched — they keep null provenance)`);
  console.log(`  Columns to add:    ${missingCols.join(", ") || "(none)"}`);
  console.log(`  Indexes to add:    ${missingIdx.map(([n]) => n).join(", ") || "(none)"}`);

  if (!missingCols.length && !missingIdx.length) {
    console.log("\nAlready applied. Nothing to do.");
    return;
  }
  if (!ctx.apply) {
    console.log(
      `\nDRY RUN — nothing written. Apply with:\n` +
        `  npx tsx scripts/add-audit-provenance.mts --apply\n` +
        `then deploy the code that writes these columns.`,
    );
    return;
  }

  // DDL cannot take bound parameters for identifiers, hence $executeRawUnsafe over fixed names.
  for (const col of missingCols) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    console.log(`  Added "AuditLog"."${col}"`);
  }
  for (const [name, col] of missingIdx) {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${name}" ON "AuditLog"("${col}")`);
    console.log(`  Added index ${name}`);
  }
  console.log(`\nApplied. Re-run without --apply to confirm it now reports nothing to do.`);
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
