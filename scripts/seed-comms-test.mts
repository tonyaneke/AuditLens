// Test account for walking through audit communications — notice → requests → conclusion — on the
// LIVE database, so that nobody but the tester is notified of anything.
//
//   npx tsx scripts/seed-comms-test.mts                      → DRY RUN of the set-up. Writes nothing.
//   npx tsx scripts/seed-comms-test.mts --apply              → sets the account up.
//   npx tsx scripts/seed-comms-test.mts --cleanup            → DRY RUN of the tear-down.
//   npx tsx scripts/seed-comms-test.mts --cleanup --apply    → tears it down.
//
// SET-UP changes the tester's account (TESTER) and adds one workspace record:
//   - role → admin, so ONE account can act as Internal Audit (Head view) and switch to the
//     action-owner view to play the department;
//   - TEST_DEPT added to extraDepartments — a department nobody else belongs to. It then appears in
//     the notice / conclusion department list (commDepartmentOptions offers departments people
//     belong to), and addressing ONLY it means every notice, request and conclusion reaches only
//     the tester. Their home department, and everyone in it, is untouched;
//   - an action-owner record "<tester> · TEST_DEPT", so TEST_DEPT is in the owner dropdown and
//     observations can be raised against it (Settings → Add Action Owner offers only the roster's
//     departments). While it exists it is in EVERY owner dropdown, and approved test observations
//     count in the tracker and the dashboards like real ones — tear down when done.
// The account's previous role and extraDepartments are saved next to the snapshots so the
// tear-down restores them exactly. The test audit itself is created in the app by the tester.
//
// TEAR-DOWN soft-deletes every audit the test touched — any audit whose notice or conclusion names
// TEST_DEPT, or whose Process / Department is TEST_DEPT — and the requests on them (the app's usual
// delete: kept in storage, never served), the TEST_DEPT action-owner record and any observation
// raised against it in another audit; removes the notifications about the test audits; and
// restores the account.
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

  const { data: ws, updatedAt } = await readWorkspaceVersioned();
  const hasOwner = arr(ws.departments).some(
    (d) => !d.deletedAt && normalizeDept(d.name) === KEY && String(d.headUserId) === tester.id,
  );

  if (!change && hasOwner) {
    console.log("\n  Already set up. Nothing to do.");
  } else {
    if (change) console.log(`  ~ role ${tester.role} → admin; extra departments → ${wantExtra.join(", ")}`);
    if (!hasOwner) {
      console.log(`  + action owner "${tester.name} · ${TEST_DEPT}" — in every owner dropdown until the tear-down`);
    }
    if (ctx.apply) {
      if (change) {
        // Saved only on the first set-up, so a second --apply cannot overwrite the original state.
        if (!fs.existsSync(statePath)) {
          writeSnapshotFile(STATE_FILE, JSON.stringify({ email: TESTER, role: tester.role, extraDepartments: testerExtra }, null, 2));
        }
        await prisma.user.update({ where: { id: tester.id }, data: { role: "admin", extraDepartments: wantExtra } });
      }
      if (!hasOwner) {
        const after = structuredClone(ws) as Workspace;
        after.departments = [
          ...arr(after.departments),
          {
            id: `test-dept-${tester.id}`,
            name: TEST_DEPT,
            headName: tester.name,
            headEmail: tester.email,
            headUserId: tester.id,
            createdAt: new Date().toISOString(),
          },
        ];
        await writeWorkspace(ws, after, "seed-comms-test", { expectUpdatedAt: updatedAt });
      }
      console.log(
        change
          ? "\n  Account updated. Sign out and back in so the session picks up the new role."
          : "\n  Set up. Refresh AuditLens to see the new action owner.",
      );
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
  // The test action owner, and anything raised against it in an audit that is not itself a test
  // audit (those go with their audit above) — or it would sit in the tracker with no department.
  const testDeptIds = new Set(arr(after.departments).filter((d) => normalizeDept(d.name) === KEY).map((d) => String(d.id)));
  for (const a of arr(after.audits)) {
    if (a.deletedAt) continue;
    for (const r of arr(a.reports))
      for (const o of arr(r.observations)) {
        if (o.deletedAt || !testDeptIds.has(String(o.departmentId))) continue;
        Object.assign(o, stamp);
        console.log(`  - observation ${o.ref || o.id} "${o.title}" in "${a.name}" (soft-deleted)`);
        changes++;
      }
  }
  for (const d of arr(after.departments)) {
    if (d.deletedAt || !testDeptIds.has(String(d.id))) continue;
    Object.assign(d, stamp);
    console.log(`  - action owner "${d.headName} · ${d.name}" (soft-deleted)`);
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
