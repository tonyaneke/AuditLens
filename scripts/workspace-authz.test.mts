/* eslint-disable @typescript-eslint/no-explicit-any --
   These tests exist to prove the server rejects documents a well-typed client would never send:
   partial saves, records echoed back out of scope, forged notifications. Typing the fixtures as
   WorkspaceDb would make the compiler refuse exactly the malformed inputs under test. */

// Tests for lib/workspace-authz.ts and lib/workspace-scope.ts.
// Run with: npm test   (or: npx tsx scripts/workspace-authz.test.mts)
import { authorizeWorkspaceWrite } from "../lib/workspace-authz";
import { scopeWorkspace } from "../lib/workspace-scope";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log("  ok " + msg); } else { fail++; console.error("  x FAIL: " + msg); } }
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function baseWorkspace(): any {
  return {
    org: "CREDICORP",
    departments: [{ id: "d1", name: "Credit", headUserId: "own1", headName: "Ola", headEmail: "o@x.com" }],
    fraudRisks: [
      {
        id: "f1", scheme: "Ghost borrowers", likelihood: 4, impact: 4, controlStrength: "Weak",
        status: "Identified", ownerUserId: "own1",
        actions: [{ id: "fa1", text: "Monthly reconciliation", status: "Planned", ownerUserId: "own1" }],
      },
      // Somebody else's risk — own1 must never see or write it.
      {
        id: "f2", scheme: "Fee skimming", likelihood: 3, impact: 3, controlStrength: "Moderate",
        status: "Identified", ownerUserId: "own2",
        actions: [{ id: "fa2", text: "Dual approval", status: "Planned", ownerUserId: "own2" }],
      },
    ],
    auditUniverse: [{ id: "u1", name: "Credit Ops", factors: {} }],
    iaSAList: [{ id: "ia1", period: "H1 2026", std: {}, items: {} }],
    extFindings: [
      { id: "e1", title: "Weak access", status: "Open", severity: "High", ownerUserId: "own1", owner: "Ola" },
      // Assigned to somebody else — the control for every scoping assertion below.
      { id: "e2", title: "CBN circular gap", status: "Open", severity: "Medium", ownerUserId: "own2", owner: "Bala" },
    ],
    approvals: [{ id: "ap1", kind: "observation_update", obsId: "o1", status: "pending", requestedBy: "staff1" }],
    notifications: [],
    audits: [
      {
        id: "a1", name: "Credit Audit", leadAuditorId: "staff1", area: "Credit", status: "In progress",
        reports: [{
          id: "r1", title: "Loan Controls", refNo: "IA/01", status: "Final", execSummary: "orig",
          observations: [
            {
              id: "o1", title: "Weak SoD", criticality: "High", status: "Open", obsApproval: "approved",
              ownerUserId: "own1", owner: "Ola", raisedBy: "staff1", isRepeat: false, repeatOf: "",
              description: "orig desc", updates: [], withdrawal: undefined,
            },
            // Same report, different owner — own1 must not receive or be able to write this.
            {
              id: "o2", title: "Stale limits", criticality: "Medium", status: "Open", obsApproval: "approved",
              ownerUserId: "own2", owner: "Bala", raisedBy: "staff1", description: "other desc", updates: [],
            },
          ],
        }],
      },
      // A whole audit own1 has nothing in — must not appear in their payload at all.
      {
        id: "a2", name: "Treasury Audit", leadAuditorId: "staff1", area: "Treasury", status: "In progress",
        reports: [{
          id: "r2", title: "Settlement", refNo: "IA/02", status: "Final", execSummary: "confidential",
          observations: [{
            id: "o3", title: "Unreconciled nostro", criticality: "High", status: "Open",
            obsApproval: "approved", ownerUserId: "own2", owner: "Bala", raisedBy: "staff1", updates: [],
          }],
        }],
      },
    ],
  };
}
const HEAD = { role: "head_of_audit", id: "head1" };
const STAFF = { role: "audit_staff", id: "staff1" };
const OWNER = { role: "action_owner", id: "own1" };
const findObs = (w: any, id: string) =>
  (w.audits || []).flatMap((a: any) => (a.reports || []).flatMap((r: any) => r.observations || []))
    .find((o: any) => o.id === id);
const findExt = (w: any, id: string) => (w.extFindings || []).find((f: any) => f.id === id);
const findRisk = (w: any, id: string) => (w.fraudRisks || []).find((f: any) => f.id === id);

console.log("== Head is fully trusted ==");
{
  const cur = baseWorkspace(); const inc = clone(cur); inc.audits[0].reports[0].observations[0].title = "Head edited";
  const r = authorizeWorkspaceWrite(HEAD.role, HEAD.id, cur, inc);
  ok(findObs(r.data, "o1").title === "Head edited", "head can edit observation content directly");
  ok(r.violations.length === 0, "no violations for head");
}

console.log("\n== Staff cannot edit an observation's controlled fields ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].observations[0].title = "Sneaky edit";
  inc.audits[0].reports[0].observations[0].criticality = "Low";
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(findObs(r.data, "o1").title === "Weak SoD", "title reverted to stored");
  ok(findObs(r.data, "o1").criticality === "High", "criticality reverted to stored");
  ok(r.violations.some((v) => v.startsWith("obs_field:o1:")), "violation recorded");
}

console.log("\n== Staff cannot delete an observation directly ==");
{
  const cur = baseWorkspace(); const inc = clone(cur); inc.audits[0].reports[0].observations = [];
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(!!findObs(r.data, "o1"), "deleted observation is restored");
  ok(r.violations.includes("obs_delete_blocked:o1"), "delete-block violation recorded");
}

console.log("\n== Staff cannot change status / withdraw / close directly ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].observations[0].status = "Closed";
  const r1 = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(findObs(r1.data, "o1").status === "Open", "direct status change reverted");

  const inc2 = clone(cur);
  inc2.audits[0].reports[0].observations[0].withdrawn = true;
  inc2.audits[0].reports[0].observations[0].status = "Withdrawn";
  inc2.audits[0].reports[0].observations[0].withdrawal = { stage: "withdrawn", headReason: "self" };
  const r2 = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc2);
  ok(findObs(r2.data, "o1").withdrawn !== true && findObs(r2.data, "o1").status === "Open", "direct withdraw reverted");
  ok(r2.violations.includes("withdraw_finalize_blocked:o1"), "withdraw-finalize block recorded");
}

console.log("\n== Staff cannot self-approve an approval ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.approvals[0].status = "approved"; inc.approvals[0].decidedBy = "staff1";
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.data.approvals[0].status === "pending", "self-approval reverted to pending");
  ok(r.violations.includes("approval_decide_blocked:ap1"), "decide-block recorded");
}

console.log("\n== Staff cannot touch head-only sections ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  // NB: fraudRisks is deliberately NOT head-only. reconcileFraudRisks() returns the register
  // verbatim for audit staff, who maintain it alongside the Head — same trust as reports and the
  // external register. These two assertions used to claim otherwise and had been failing against
  // the implementation; corrected here to assert the behaviour the code actually specifies.
  inc.fraudRisks[0].status = "Mitigated";
  inc.auditUniverse.push({ id: "u2", name: "New", factors: {} });
  inc.iaSAList[0].period = "H2 2026";
  inc.departments.push({ id: "d2", name: "Legal" });
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.data.fraudRisks[0].status === "Mitigated", "staff may maintain the fraud register");
  ok(r.data.auditUniverse.length === 1, "audit universe addition reverted");
  ok(r.data.iaSAList[0].period === "H1 2026", "IA self-assessment change reverted");
  ok(r.data.departments.length === 1, "departments change reverted");
  ok(["section:auditUniverse", "section:iaSAList", "section:departments"].every((s) => r.violations.includes(s)), "locked-section violations recorded");
}

console.log("\n== Staff LEGITIMATE actions pass through ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  // comment (updates append) + verification field + a new pending approval + supersede own pending
  inc.audits[0].reports[0].observations[0].updates.push({ id: "u1", text: "reviewed", by: "staff1" });
  inc.audits[0].reports[0].observations[0].reportVerifiedAt = "2026-07-22T10:00:00Z";
  inc.approvals.push({ id: "ap2", kind: "observation_delete", obsId: "o1", status: "pending", requestedBy: "staff1" });
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(findObs(r.data, "o1").updates.length === 1, "comment/update appended");
  ok(findObs(r.data, "o1").reportVerifiedAt === "2026-07-22T10:00:00Z", "auditor verification passes for staff");
  ok(r.data.approvals.some((a: any) => a.id === "ap2" && a.status === "pending"), "new approval request passes");
  ok(!r.violations.some((v) => v.startsWith("obs_field") || v.startsWith("section")), "no field/section violations for legit save");
}

console.log("\n== Staff may raise a NEW observation but it is forced to pending ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].observations.push({ id: "oNew", title: "New finding", status: "Closed", obsApproval: "approved", raisedBy: "someoneElse", withdrawn: true });
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  const n = findObs(r.data, "oNew");
  ok(!!n, "new observation is kept");
  ok(n.obsApproval === "pending", "forced to pending approval");
  ok(n.status === "Open" && n.withdrawn === false, "cannot arrive pre-closed / withdrawn");
  ok(n.raisedBy === "staff1", "raisedBy forced to the actual author");
}

console.log("\n== Action owner: remediation passes, verification blocked, cannot create obs ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].observations[0].ownerRectifiedAt = "2026-07-22T09:00:00Z"; // ready for closure (allowed)
  inc.audits[0].reports[0].observations[0].reportVerifiedAt = "2026-07-22T09:00:00Z"; // auditor-only (blocked)
  inc.audits[0].reports[0].observations[0].withdrawal = { stage: "owner_requested", ownerReason: "invalid" }; // allowed
  inc.audits[0].reports[0].observations.push({ id: "oX", title: "owner-created", obsApproval: "approved" }); // blocked
  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  ok(findObs(r.data, "o1").ownerRectifiedAt === "2026-07-22T09:00:00Z", "owner ready-for-closure passes");
  ok(findObs(r.data, "o1").reportVerifiedAt == null, "owner cannot set auditor verification");
  ok(findObs(r.data, "o1").withdrawal?.stage === "owner_requested", "owner review request passes");
  ok(!findObs(r.data, "oX"), "owner cannot create an observation");
  ok(r.violations.includes("obs_create_blocked:oX"), "owner obs-create block recorded");
}

console.log("\n== Staff may edit report metadata, but not delete a report or edit the audit ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].execSummary = "staff updated summary"; // report edit — allowed
  inc.audits[0].name = "Renamed audit";                            // audit edit — head only
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.data.audits[0].reports[0].execSummary === "staff updated summary", "staff can edit report metadata");
  ok(r.data.audits[0].name === "Credit Audit", "audit metadata is locked for staff");
  // deleting the report (would nuke its observations) is blocked
  const inc2 = clone(cur); inc2.audits[0].reports = [];
  const r2 = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc2);
  ok(r2.data.audits[0].reports.length === 1 && findObs(r2.data, "o1"), "report deletion is blocked (observations preserved)");
  ok(r2.violations.includes("report_delete_blocked:r1"), "report-delete block recorded");
}

console.log("\n== External-finding remediation stays writable for non-head ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.extFindings[0].ownerResponse = "we fixed it";
  inc.extFindings[0].ownerRectifiedAt = "2026-07-30T10:00:00.000Z";
  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  ok(findExt(r.data, "e1").ownerResponse === "we fixed it", "owner can remediate their own external finding");
  ok(findExt(r.data, "e1").status === "In Progress", "status transition is derived server-side");
}

/* ---------------- SEC-01 / SEC-02 — read scope and its write-side inverse ---------------- */

console.log("\n== SEC-01: GET is scoped to the viewer ==");
{
  const db = baseWorkspace();
  const full = scopeWorkspace(db, { id: STAFF.id, role: "audit_staff" });
  ok(full === db, "audit staff get the document unchanged (identity, not a copy)");
  ok(scopeWorkspace(db, { id: HEAD.id, role: "head_of_audit" }) === db, "head gets the document unchanged");

  const mine = scopeWorkspace(db, { id: OWNER.id, role: "action_owner" }) as any;
  ok(!!findObs(mine, "o1"), "owner receives their own observation");
  ok(!findObs(mine, "o2"), "owner does NOT receive a colleague's observation in the same report");
  ok(!findObs(mine, "o3"), "owner does NOT receive an observation in an audit they have nothing in");
  ok(mine.audits.length === 1 && mine.audits[0].id === "a1", "audits with nothing visible are dropped entirely");
  ok(mine.audits[0].reports[0].execSummary === undefined, "report exec summary is withheld from owners");
  ok(!!findExt(mine, "e1") && !findExt(mine, "e2"), "external findings are scoped to the owner");
  ok(!!findRisk(mine, "f1") && !findRisk(mine, "f2"), "fraud risks are scoped to the owner");
  ok(mine.auditUniverse === undefined, "audit universe is not sent to owners");
  ok(mine.iaSAList === undefined, "IA self-assessments are not sent to owners");
  ok(mine.exco === undefined && mine.processReviews === undefined, "exco and process reviews are not sent to owners");
  ok(mine.departments[0].headEmail === undefined, "department head contact details are stripped");
  ok(mine.approvals.length === 1 && mine.approvals[0].id === "ap1", "owner sees only approvals about their own records");
}

console.log("\n== SEC-01: the scoped round-trip logs NO violations ==");
{
  // The whole reason read scope and write scope share lib/workspace-scope.ts. An owner's ordinary
  // save omits every record they were never given; if the reconcilers could not tell that apart
  // from a deletion, this would report a violation for each one.
  const cur = baseWorkspace();
  const served = clone(scopeWorkspace(cur, { id: OWNER.id, role: "action_owner" }));
  served.audits[0].reports[0].observations[0].ownerRectifiedAt = "2026-07-30T10:00:00.000Z";

  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, served);
  ok(r.violations.length === 0, `no violations for a legitimate scoped save (got ${JSON.stringify(r.violations)})`);
  ok(findObs(r.data, "o1").ownerRectifiedAt === "2026-07-30T10:00:00.000Z", "the owner's own change persists");
  ok(findObs(r.data, "o1").status === "In Progress", "derived stage transition still applies");

  // Nothing the owner never saw may be lost by omission.
  ok(!!findObs(r.data, "o2"), "a colleague's observation survives an omitted save");
  ok(!!findObs(r.data, "o3"), "an unrelated audit's observation survives");
  ok(r.data.audits.length === 2, "the audit the owner never saw is still there");
  ok(findExt(r.data, "e2").title === "CBN circular gap", "another owner's external finding survives");
  ok(findRisk(r.data, "f2").scheme === "Fee skimming", "another owner's fraud risk survives");
  ok(r.data.auditUniverse.length === 1 && r.data.iaSAList.length === 1, "head-only sections survive");
  ok(r.data.departments[0].headEmail === "o@x.com", "department head details survive the stripped copy");
  ok(r.data.audits[0].reports[0].execSummary === "orig", "exec summary survives the stripped copy");
}

console.log("\n== SEC-01: echoing back a record that was never served is refused ==");
{
  const cur = baseWorkspace();
  const served = clone(scopeWorkspace(cur, { id: OWNER.id, role: "action_owner" })) as any;
  // A crafted client re-adds a colleague's observation with edits.
  served.audits[0].reports[0].observations.push({
    id: "o2", title: "Rewritten by an owner", criticality: "Low", status: "Closed",
    obsApproval: "approved", ownerUserId: "own2", updates: [],
  });
  served.extFindings.push({ id: "e2", title: "Rewritten", status: "Closed", ownerUserId: "own2" });
  served.fraudRisks.push({ id: "f2", scheme: "Rewritten", status: "Mitigated", ownerUserId: "own2", actions: [] });

  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, served);
  ok(findObs(r.data, "o2").title === "Stale limits", "the colleague's observation is unchanged");
  ok(findExt(r.data, "e2").title === "CBN circular gap", "the colleague's external finding is unchanged");
  ok(findRisk(r.data, "f2").scheme === "Fee skimming", "the colleague's fraud risk is unchanged");
  ok(r.violations.includes("out_of_scope_write:obs:o2"), "out-of-scope observation write recorded");
  ok(r.violations.includes("out_of_scope_write:ext:e2"), "out-of-scope external write recorded");
  ok(r.violations.includes("out_of_scope_write:fraud:f2"), "out-of-scope fraud write recorded");
}

console.log("\n== SEC-02: external findings are no longer taken wholesale ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  // Before this change `next.extFindings = inc.extFindings` — so this wiped the register.
  inc.extFindings = [];
  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  ok(r.data.extFindings.length === 2, "an owner cannot delete the external register");
  ok(r.violations.includes("ext_delete_blocked:e1"), "deleting a finding they hold is a violation");
  ok(!r.violations.includes("ext_delete_blocked:e2"), "omitting one they never held is not");

  const inc2 = clone(cur);
  inc2.extFindings[0].severity = "Low";
  inc2.extFindings[0].status = "Closed";
  const r2 = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc2);
  ok(findExt(r2.data, "e1").severity === "High", "an owner cannot re-rate a finding");
  ok(findExt(r2.data, "e1").status === "Open", "an owner cannot close a finding");
  ok(r2.violations.some((v) => v.startsWith("ext_field:e1:")), "ext field violation recorded");

  const inc3 = clone(cur);
  inc3.extFindings.push({ id: "e9", title: "Invented", status: "Open" });
  const r3 = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc3);
  ok(!findExt(r3.data, "e9"), "an owner cannot raise an external finding");
  ok(r3.violations.includes("ext_create_blocked:e9"), "ext create block recorded");

  const incStaff = clone(cur);
  incStaff.extFindings[0].severity = "Low";
  const rStaff = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, incStaff);
  ok(findExt(rStaff.data, "e1").severity === "Low", "audit staff still maintain the external register");
}

console.log("\n== SEC-02: notifications are create-but-not-modify ==");
{
  const cur = baseWorkspace();
  cur.notifications = [
    { id: "n1", userId: "own1", kind: "info", text: "yours", link: "myobs", read: false, at: "2026-07-01T00:00:00.000Z" },
    { id: "n2", userId: "own2", kind: "info", text: "theirs", link: "myobs", read: false, at: "2026-07-01T00:00:00.000Z" },
  ];

  const inc = clone(cur);
  inc.notifications[0].read = true;                       // legitimate: mark my own as read
  inc.notifications[1].text = "phishing link";            // forbidden: rewrite someone else's
  inc.notifications.push({ id: "n3", userId: "own2", kind: "info", text: "assigned to you", link: "myobs", read: false, at: "1970-01-01T00:00:00.000Z" });

  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  const byId = (id: string) => r.data.notifications.find((n: any) => n.id === id);
  ok(byId("n1").read === true, "a user may mark their own notification read");
  ok(byId("n2").text === "theirs", "a user cannot rewrite someone else's notification");
  ok(r.violations.includes("notif_foreign_write_blocked:n2"), "foreign notification write recorded");
  ok(byId("n3") && byId("n3").text === "assigned to you", "creating a notification for another user is allowed");
  ok(byId("n3").byUserId === "own1", "a created notification is stamped with its real author");
  ok(byId("n3").at !== "1970-01-01T00:00:00.000Z", "a created notification is stamped with the server time");

  const inc2 = clone(cur);
  inc2.notifications[0].text = "self-serving rewrite";
  const r2 = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc2);
  ok(r2.data.notifications.find((n: any) => n.id === "n1").text === "yours", "only the read flag moves on your own row");
  ok(r2.violations.includes("notif_field:n1:text"), "own-notification field violation recorded");
}

console.log("\n== SEC-02: owners cannot rewrite report metadata ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].title = "Renamed by an owner";
  inc.audits[0].reports[0].execSummary = "overwritten";
  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  ok(r.data.audits[0].reports[0].title === "Loan Controls", "report title is locked for owners");
  ok(r.data.audits[0].reports[0].execSummary === "orig", "exec summary is not blanked by an owner save");

  const inc2 = clone(cur);
  inc2.audits[0].reports.push({ id: "r9", title: "Invented", observations: [] });
  const r2 = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc2);
  ok(r2.data.audits[0].reports.length === 1, "an owner cannot create a report");
  ok(r2.violations.includes("report_create_blocked:r9"), "report create block recorded");
}

console.log("\n== Admin acts as their switched role ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].observations[0].title = "Admin edited";
  // No activeRole → head of audit → fully trusted.
  const asHead = authorizeWorkspaceWrite("admin", "admin1", cur, clone(inc));
  ok(findObs(asHead.data, "o1").title === "Admin edited", "admin with no activeRole is trusted as head");
  // Viewing as an action owner → scoped and reconciled like one.
  const asOwner = authorizeWorkspaceWrite("admin", "own1", cur, clone(inc), "action_owner");
  ok(findObs(asOwner.data, "o1").title === "Weak SoD", "admin viewing as an owner is reconciled like one");
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
