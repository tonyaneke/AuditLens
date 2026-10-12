// Test account for walking through audit communications — notice → requests → conclusion — on the
// LIVE database, so that nobody but the tester is notified of anything.
//
//   npx tsx scripts/seed-comms-test.mts                      → DRY RUN of the set-up. Writes nothing.
//   npx tsx scripts/seed-comms-test.mts --apply              → sets the account up.
//   npx tsx scripts/seed-comms-test.mts --cleanup            → DRY RUN of the tear-down.
//   npx tsx scripts/seed-comms-test.mts --cleanup --apply    → tears it down.
//
// SET-UP changes the tester's account (TESTER) only:
//   - role → admin, so ONE account can act as Internal Audit (Head view) and switch to the
//     action-owner view to play the department;
//   - TEST_DEPT added to extraDepartments — a department nobody else belongs to. It then appears in
//     the notice / conclusion department list (commDepartmentOptions offers departments people
//     belong to), and addressing ONLY it means every notice, request and conclusion reaches only
//     the tester. Their home department, and everyone in it, is untouched.
// The account's previous role and extraDepartments are saved next to the snapshots so the
// tear-down restores them exactly. The test audit itself is created in the app by the tester.
//
// TEAR-DOWN soft-deletes every audit the test touched — any audit whose notice or conclusion names
// TEST_DEPT, or whose Process / Department is TEST_DEPT — and the requests on them (the app's usual
// delete: kept in storage, never served), removes the notifications about them, and restores the
// account.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrisma,
  heading,
  parseArgs,
  readWorkspaceVersioned,
  writeSnapshotFile,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";
import { normalizeDept } from "../lib/dept-scope";

const TESTER = "eanishe@credicorp.ng";
const TEST_DEPT = "AuditLens Test";
const STATE_FILE = "seed-comms-test-account.json";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const KEY = normalizeDept(TEST_DEPT);
const namesTestDept = (list: unknown) => Array.isArray(list) && list.some((d) => normalizeDept(d) === KEY);

const ctx = parseArgs();
const cleanup = ctx.argv.includes("--cleanup");
const prisma = await getPrisma();

const tester = await prisma.user.findUnique({ where: { email: TESTER } });
if (!tester) throw new Error(`No AuditLens user ${TESTER}.`);
const testerExtra = (Array.isArray(tester.extraDepartments) ? tester.extraDepartments : []).map(String);
const statePath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".snapshots", STATE_FILE);

heading(cleanup ? "Audit communications test — TEAR-DOWN" : "Audit communications test — SET-UP");
console.log(`  Tester: ${tester.name} <${tester.email}> — now ${tester.role}, ${tester.department}` +
  (testerExtra.length ? ` (+ ${testerExtra.join(", ")})` : ""));

if (!cleanup) {
  // Safety: the test department must have nobody else in it, or a notice to it would reach them.
  const everyone = await prisma.user.findMany({ select: { id: true, name: true, department: true, extraDepartments: true } });
  const others = everyone.filter((u) => u.id !== tester.id && (normalizeDept(u.department) === KEY || namesTestDept(u.extraDepartments)));
  if (others.length) {
    throw new Error(`"${TEST_DEPT}" already has members (${others.map((u) => u.name).join(", ")}) — pick another TEST_DEPT.`);
  }
  console.log(`  "${TEST_DEPT}" has no other members — addressed alone, it reaches only the tester.`);

  const wantExtra = namesTestDept(testerExtra) ? testerExtra : [...testerExtra, TEST_DEPT];
  const change = tester.role !== "admin" || wantExtra.length !== testerExtra.length;
  if (!change) {
    console.log("\n  Already set up. Nothing to do.");
  } else {
    console.log(`  ~ role ${tester.role} → admin; extra departments → ${wantExtra.join(", ")}`);
    if (ctx.apply) {
      // Saved only on the first set-up, so a second --apply cannot overwrite the original state.
      if (!fs.existsSync(statePath)) {
        writeSnapshotFile(STATE_FILE, JSON.stringify({ email: TESTER, role: tester.role, extraDepartments: testerExtra }, null, 2));
      }
      await prisma.user.update({ where: { id: tester.id }, data: { role: "admin", extraDepartments: wantExtra } });
      console.log("\n  Account updated. Sign out and back in so the session picks up the new role.");
    } else {
      console.log("\n  DRY RUN — nothing written. Re-run with --apply to set it up.");
    }
  }
} else {
  const { data: before, updatedAt } = await readWorkspaceVersioned();
  const after = structuredClone(before) as Workspace;
  const now = new Date().toISOString();
  const stamp = { deletedAt: now, deletedBy: tester.id, deletedByName: `${tester.name} (test clean-up)` };
  let changes = 0;

  const testAudits = arr(after.audits).filter(
    (a) =>
      !a.deletedAt &&
      (normalizeDept(a.area) === KEY ||
        namesTestDept((a.notice as Obj | undefined)?.departments) ||
        namesTestDept((a.closeout as Obj | undefined)?.departments)),
  );
  const ids = new Set(testAudits.map((a) => String(a.id)));
  for (const a of testAudits) {
    Object.assign(a, stamp);
    console.log(`  - audit "${a.name}" (soft-deleted)`);
    changes++;
  }
  for (const r of arr(after.auditRequests)) {
    if (!ids.has(String(r.auditId)) || r.deletedAt) continue;
    Object.assign(r, stamp);
    console.log(`  - request ${r.ref || r.id} "${r.subject}" (soft-deleted)`);
    changes++;
  }
  const notifs = arr(after.notifications);
  const kept = notifs.filter((n) => !ids.has(String(n.auditId || "")));
  if (kept.length !== notifs.length) {
    after.notifications = kept;
    console.log(`  - ${notifs.length - kept.length} notification(s) about the test audit(s)`);
    changes++;
  }

  const saved = fs.existsSync(statePath) ? (JSON.parse(fs.readFileSync(statePath, "utf8")) as Obj) : {};
  const prevRole = String(saved.role || "action_owner");
  const prevExtra = Array.isArray(saved.extraDepartments)
    ? (saved.extraDepartments as unknown[]).map(String)
    : testerExtra.filter((d) => normalizeDept(d) !== KEY);
  const userChange = tester.role !== prevRole || JSON.stringify(testerExtra) !== JSON.stringify(prevExtra);
  if (userChange) console.log(`  ~ role ${tester.role} → ${prevRole}; extra departments → ${prevExtra.join(", ") || "(none)"}`);
  if (!changes && !userChange) console.log("\n  Nothing to tear down.");

  if (ctx.apply) {
    if (changes) await writeWorkspace(before, after, "seed-comms-test-cleanup", { expectUpdatedAt: updatedAt });
    if (userChange) {
      await prisma.user.update({ where: { id: tester.id }, data: { role: prevRole, extraDepartments: prevExtra } });
      if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
      console.log("  Account restored.");
    }
  } else if (changes || userChange) {
    console.log("\n  DRY RUN — nothing written. Re-run with --cleanup --apply to tear it down.");
  }
}

await prisma.$disconnect();
