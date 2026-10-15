// Seed one CONCLUDED engagement for the tester's action-owner view — notice issued, Terms of
// Reference filled, an information request and a department comment (both answered and closed), a
// Final report and the audit conclusion issued — so the Audits tab can be seen end to end without
// walking the whole flow. Content: scripts/_comms-sample.mts.
//
//   npx tsx scripts/seed-concluded-audit.mts           → DRY RUN. Writes nothing.
//   npx tsx scripts/seed-concluded-audit.mts --apply   → adds it.
//   … --refresh [--apply]   → when it is already there: brings its report's 1.4 opinion and assurance
//                             rating up to the sample, and re-snapshots the conclusion from the report
//                             the way a re-issue would (so it carries 1.4) — still without notifying.
//
// Nobody is notified: the script writes the workspace directly — no bells, no e-mail. It is
// addressed only to TEST_DEPT, which must have no member but the tester (scripts/seed-comms-test.mts
// adds the tester to it). Remove it with `npx tsx scripts/seed-comms-test.mts --cleanup --apply`,
// which soft-deletes every audit addressed to TEST_DEPT, with its requests.
import { getPrisma, heading, parseArgs, readWorkspaceVersioned, writeWorkspace, type Workspace } from "./_migration.mjs";
import { SAMPLE_AUDIT_ID, TEST_DEPT, sampleConcludedAudit } from "./_comms-sample.mjs";
import { normalizeDept } from "../lib/dept-scope";
import { closeoutFromReport } from "../lib/workspace/audit-comms";
import type { Report } from "../lib/workspace/types";

const TESTER = "eanishe@credicorp.ng";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

const ctx = parseArgs();
const refresh = ctx.argv.includes("--refresh");
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
if (existing && !refresh) {
  console.log(`\n  Already there: "${existing.name}". Nothing to do. (--refresh updates its 1.4 and conclusion.)`);
} else if (existing) {
  const sample = sampleConcludedAudit({ id: tester.id, name: tester.name }).audit.reports[0];
  const after = structuredClone(before) as Workspace;
  const a = arr(after.audits).find((x) => x.id === SAMPLE_AUDIT_ID && !x.deletedAt)!;
  const r = arr(a.reports).find((x) => x.id === sample.id);
  const c = a.closeout as Obj | undefined;
  if (!r) throw new Error(`"${a.name}" no longer has its report "${sample.title}" — not refreshing.`);
  if (!c?.issuedAt) throw new Error(`"${a.name}" has no issued conclusion — not refreshing.`);

  let changes = 0;
  for (const k of ["assuranceLevel", "auditOpinion"] as const) {
    if (r[k] === sample[k]) continue;
    console.log(`  ~ report ${k === "auditOpinion" ? "1.4 opinion" : "assurance rating"}: "${String(r[k] || "").slice(0, 60)}…" → "${String(sample[k]).slice(0, 60)}…"`);
    r[k] = sample[k];
    changes++;
  }
  // Rebuilt from the report as a re-issue rebuilds it (CloseoutDialog): who issued it, when and to
  // whom are kept; the content is the report's now — which drops 1.1 and areas out of scope.
  const { reportId, departments, issuedAt, issuedBy, issuedByName, revisedAt, revisedBy, revisedByName } = c;
  const next: Obj = {
    ...closeoutFromReport(r as unknown as Report),
    ...Object.fromEntries(
      Object.entries({ departments, issuedAt, issuedBy, issuedByName, revisedAt, revisedBy, revisedByName }).filter(([, v]) => v !== undefined),
    ),
  };
  if (reportId !== next.reportId) throw new Error("The conclusion was issued from another report — not refreshing.");
  if (JSON.stringify(next) !== JSON.stringify(c)) {
    a.closeout = next;
    console.log(`  ~ conclusion re-snapshotted: 1.2, 1.3, 1.4 [${next.assuranceLevel || "no rating"}], 1.5 — issued ${String(issuedAt).slice(0, 10)}, unchanged`);
    changes++;
  }

  if (!changes) console.log(`\n  "${a.name}" is up to date. Nothing to do.`);
  else if (ctx.apply) {
    await writeWorkspace(before, after, "seed-concluded-audit-refresh", { expectUpdatedAt: updatedAt });
    console.log(`\n  Done — nobody notified. Refresh AuditLens: Action Owner view → Audit Reports → "${a.name}".`);
  } else {
    console.log("\n  DRY RUN — nothing written. Re-run with --refresh --apply to update it.");
  }
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
