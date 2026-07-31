// Post-load check for the go-live backlog import (scripts/migrate-backlog.mts).
//
//   npx tsx scripts/verify-backlog.mts     (read-only — never writes)
//
// Reads the loaded workspace back through the app's OWN selectors rather than re-reading the
// JSON its own way. That is the point: a loader that verifies itself only proves it is
// self-consistent. Routing an observation through allObs/approvedObs/myObsList is what shows it
// will actually reach the Tracker and the owner's portal, since those are the functions the
// screens call. Everything a bad load would break is asserted here — reference uniqueness,
// owner ids that resolve to real accounts, department ids that resolve to real departments,
// and no notifications.
import { getPrisma, readWorkspace } from "./_migration.mjs";
import { allObs, approvedObs, isOverdueObs, effectiveClose } from "../lib/workspace/selectors";
import { myObsList, myExtList } from "../lib/workspace/portal";
import { usedObsRefs } from "../lib/workspace/obs-validation";
import type { WorkspaceDb } from "../lib/workspace/types";

const prisma = await getPrisma();
const db = (await readWorkspace()) as unknown as WorkspaceDb;

const users = await prisma.user.findMany({
  orderBy: { createdAt: "asc" },
  select: { id: true, name: true, email: true, department: true, role: true, active: true, welcomeEmailSentAt: true },
});

console.log(`USERS (${users.length})`);
for (const u of users) {
  console.log(`  ${u.active ? "ACTIVE  " : "inactive"} ${u.role.padEnd(13)} ${u.email.padEnd(26)} ${u.name.padEnd(20)} welcomed=${u.welcomeEmailSentAt ? "yes" : "no"}`);
}
console.log(`\nAUDIT LOG ROWS: ${await prisma.auditLog.count()}`);

const all = allObs(db);
const approved = approvedObs(db);
console.log(`\nOBSERVATIONS: ${all.length} total · ${approved.length} approved (both must be 86)`);
console.log(`  Open ${approved.filter((o) => o.status !== "Closed").length} · Closed ${approved.filter((o) => o.status === "Closed").length}`);
console.log(`  Overdue (by the app's own rule): ${approved.filter((o) => isOverdueObs(o, o._r)).length}`);
console.log(`  With a resolvable expected-close date: ${approved.filter((o) => !!effectiveClose(o, o._r)).length}`);
console.log(`  Unique refs: ${usedObsRefs(db).size} (must equal 86 — no duplicate citations)`);

const crit: Record<string, number> = {};
for (const o of approved) crit[o.criticality] = (crit[o.criticality] || 0) + 1;
console.log(`  Criticality: ${Object.entries(crit).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

// The closure trail: a closed observation must be dated and signed off, and an OPEN one must
// carry none of those stamps — a stray one would put it in a queue nobody put it in.
const closed = approved.filter((o) => o.status === "Closed");
const open = approved.filter((o) => o.status !== "Closed");
console.log(`  Closed with a closure date: ${closed.filter((o) => o.closedDateISO).length}/${closed.length}`);
console.log(`  Closed with a Head sign-off: ${closed.filter((o) => o.headVerifiedAt && o.headVerifiedByName).length}/${closed.length}`);
console.log(`  Closed whose sign-off resolves to a real user: ${closed.filter((o) => users.some((u) => u.id === o.headVerifiedBy)).length}/${closed.length}`);
console.log(`  Closed whose closure date != its target date: ${closed.filter((o) => o.closedDateISO !== o.dueDate).length} (must be 0)`);
console.log(`  OPEN observations wrongly carrying a closure stamp: ${open.filter((o) => o.closedDateISO || o.headVerifiedAt || o.ownerRectifiedAt).length} (must be 0)`);
console.log(`  Falsely sitting in the Ready-for-closure queue: ${approved.filter((o) => !!o.ownerRectifiedAt && o.status !== "Closed").length} (must be 0)`);

const noOwner = approved.filter((o) => !o.ownerUserId);
const badOwner = approved.filter((o) => o.ownerUserId && !users.some((u) => u.id === o.ownerUserId));
console.log(`  Observations with no owner: ${noOwner.length} · pointing at a non-existent user: ${badOwner.length}`);

const deptIds = new Set((db.departments || []).map((d) => d.id));
console.log(`  Observations whose departmentId is not a real department: ${approved.filter((o) => o.departmentId && !deptIds.has(o.departmentId)).length}`);

console.log("\nWHAT EACH ACTION OWNER WILL SEE IN THEIR PORTAL");
for (const u of users.filter((x) => x.role === "action_owner")) {
  const obs = myObsList(db, u.id);
  const ext = myExtList(db, u.id);
  const open = obs.filter((o) => o.status !== "Closed").length + ext.filter((f) => f.status !== "Closed").length;
  console.log(`  ${u.name.padEnd(20)} ${String(obs.length).padStart(3)} observations · ${String(ext.length).padStart(2)} external · ${open} still open`);
}

console.log("\nOBSERVATION ROUTING — audit › report › count");
for (const a of db.audits || []) {
  for (const r of a.reports || []) {
    console.log(`  ${String(r.refNo).padEnd(12)} ${String(r.reportDateISO || "—").padEnd(11)} ${String(r.observations.length).padStart(3)} obs   ${a.period} · ${a.name}`);
  }
}
const noReport = (db.audits || []).filter((a) => !(a.reports || []).length).length;
console.log(`  (${noReport} planned/completed engagements carry no report — no report content in the workbook)`);

console.log(`\nEXTERNAL FINDINGS: ${(db.extFindings || []).length}`);
console.log(`  Unowned: ${(db.extFindings || []).filter((f) => !f.ownerUserId).length}`);

const recips = db.exco?.recipientList || [];
console.log(`\nMD & EXCO BRIEF RECIPIENTS: ${recips.length}`);
for (const r of recips) console.log(`  ${String(r.name || "").padEnd(20)} ${String(r.email || "").padEnd(26)} ${r.role || ""}`);
// A recipient with an account would be a quiet access grant — the brief is meant to reach them
// as a tokenised link, not to put them inside the app.
const withAccounts = recips.filter((r) => users.some((u) => u.email.toLowerCase() === String(r.email || "").toLowerCase()));
console.log(`  Recipients who also hold an AuditLens account: ${withAccounts.length}`);
console.log(`  Duplicate recipient emails: ${recips.length - new Set(recips.map((r) => String(r.email || "").toLowerCase())).size} (must be 0)`);

console.log("\nNOTIFICATIONS: " + (db.notifications || []).length + "  (must be 0 — owners are not to be alerted)");
console.log("APPROVALS: " + (db.approvals || []).length);
console.log("FRAUD RISKS: " + (db.fraudRisks || []).length + " · PROCESS REVIEWS: " + (db.processReviews || []).length + " · IA SELF-ASSESSMENTS: " + (db.iaSAList || []).length);
console.log("AUDIT UNIVERSE: " + (db.auditUniverse || []).length + " (carried over)");
const dangling = (db.auditUniverse || []).flatMap((u) => (u.linkedAuditIds || []).filter((id) => !(db.audits || []).some((a) => a.id === id)));
console.log("  Universe links pointing at a deleted audit: " + dangling.length);

await prisma.$disconnect();
