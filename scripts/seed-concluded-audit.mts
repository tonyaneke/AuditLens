// Seed one CONCLUDED engagement for the tester's action-owner view — notice issued, Terms of
// Reference filled, an information request and a department comment (both answered and closed), a
// Final report and the audit conclusion issued — so the Audits tab can be seen end to end without
// walking the whole flow. Content: scripts/_comms-sample.mts.
//
//   npx tsx scripts/seed-concluded-audit.mts           → DRY RUN. Writes nothing.
//   npx tsx scripts/seed-concluded-audit.mts --apply   → adds it.
//
// Nobody is notified: the script writes the workspace directly — no bells, no e-mail. It is
// addressed only to TEST_DEPT, which must have no member but the tester (scripts/seed-comms-test.mts
// adds the tester to it). Remove it with `npx tsx scripts/seed-comms-test.mts --cleanup --apply`,
// which soft-deletes every audit addressed to TEST_DEPT, with its requests.
import { getPrisma, heading, parseArgs, readWorkspaceVersioned, writeWorkspace, type Workspace } from "./_migration.mjs";
import { SAMPLE_AUDIT_ID, TEST_DEPT, sampleConcludedAudit } from "./_comms-sample.mjs";
import { normalizeDept } from "../lib/dept-scope";

const TESTER = "eanishe@credicorp.ng";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

const ctx = parseArgs();
const prisma = await getPrisma();
const tester = await prisma.user.findUnique({ where: { email: TESTER } });
if (!tester) throw new Error(`No AuditLens user ${TESTER}.`);

heading("Seed a concluded engagement — " + TEST_DEPT);

// Safety: only the tester may be in the department this engagement is addressed to.
const key = normalizeDept(TEST_DEPT);
const everyone = await prisma.user.findMany({ select: { id: true, name: true, department: true, extraDepartments: true } });
const inDept = (u: (typeof everyone)[number]) =>
  normalizeDept(u.department) === key ||
  (Array.isArray(u.extraDepartments) && u.extraDepartments.some((d) => normalizeDept(d) === key));
const others = everyone.filter((u) => u.id !== tester.id && inDept(u));
if (others.length) throw new Error(`"${TEST_DEPT}" has other members (${others.map((u) => u.name).join(", ")}) — not seeding.`);
if (!inDept(everyone.find((u) => u.id === tester.id)!)) {
  console.log(`  ! ${tester.name} is not in "${TEST_DEPT}" yet — run scripts/seed-comms-test.mts --apply first, or the`);
  console.log("    engagement will not show on their Audits tab.");
}

const { data: before, updatedAt } = await readWorkspaceVersioned();
const existing = arr(before.audits).find((a) => a.id === SAMPLE_AUDIT_ID && !a.deletedAt);
if (existing) {
  console.log(`\n  Already there: "${existing.name}". Nothing to do.`);
} else {
  const { audit, requests } = sampleConcludedAudit({ id: tester.id, name: tester.name });
  const after = structuredClone(before) as Workspace;
  // A torn-down copy (soft-deleted) is replaced, so re-seeding after a clean-up works.
  after.audits = [...arr(after.audits).filter((a) => a.id !== SAMPLE_AUDIT_ID), audit as unknown as Obj];
  const ids = new Set(requests.map((r) => r.id));
  after.auditRequests = [...arr(after.auditRequests).filter((r) => !ids.has(String(r.id))), ...(requests as unknown as Obj[])];

  console.log(`\n  + audit    "${audit.name}" — Completed, lead auditor ${tester.name}`);
  console.log(`  + notice   issued ${audit.notice?.issuedAt?.slice(0, 10)} to ${TEST_DEPT}`);
  console.log(`  + report   "${audit.reports[0].title}" — Final, executive summary written`);
  console.log(`  + conclusion issued ${audit.closeout?.issuedAt.slice(0, 10)} to ${TEST_DEPT}`);
  for (const r of requests) console.log(`  + ${r.ref}    "${r.subject}" — ${(r.messages || []).length} repl${(r.messages || []).length === 1 ? "y" : "ies"}, closed`);

  if (ctx.apply) {
    await writeWorkspace(before, after, "seed-concluded-audit", { expectUpdatedAt: updatedAt });
    console.log(`\n  Done. ${tester.name} → Action Owner view → Audits → Concluded engagements.`);
  } else {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply to add it.");
  }
}

await prisma.$disconnect();
