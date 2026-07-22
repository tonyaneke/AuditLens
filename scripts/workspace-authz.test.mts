// Tests for lib/workspace-authz.ts — run with: npx tsx scripts/workspace-authz.test.mts
import { authorizeWorkspaceWrite } from "../lib/workspace-authz";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log("  ok " + msg); } else { fail++; console.error("  x FAIL: " + msg); } }
const clone = (x: any) => JSON.parse(JSON.stringify(x));

function baseWorkspace(): any {
  return {
    org: "CREDICORP",
    departments: [{ id: "d1", name: "Credit", headUserId: "own1", headName: "Ola", headEmail: "o@x.com" }],
    fraudRisks: [{ id: "f1", scheme: "Ghost borrowers", likelihood: 4, impact: 4, controlStrength: "Weak", status: "Identified" }],
    auditUniverse: [{ id: "u1", name: "Credit Ops", factors: {} }],
    iaSAList: [{ id: "ia1", period: "H1 2026", std: {}, items: {} }],
    extFindings: [{ id: "e1", title: "Weak access", status: "Open", severity: "High" }],
    approvals: [{ id: "ap1", kind: "observation_update", obsId: "o1", status: "pending", requestedBy: "staff1" }],
    notifications: [],
    audits: [{
      id: "a1", name: "Credit Audit", leadAuditorId: "staff1", area: "Credit", status: "In progress",
      reports: [{
        id: "r1", title: "Loan Controls", refNo: "IA/01", status: "Final", execSummary: "orig",
        observations: [{
          id: "o1", title: "Weak SoD", criticality: "High", status: "Open", obsApproval: "approved",
          ownerUserId: "own1", owner: "Ola", raisedBy: "staff1", isRepeat: false, repeatOf: "",
          description: "orig desc", updates: [], withdrawal: undefined,
        }],
      }],
    }],
  };
}
const HEAD = { role: "head_of_audit", id: "head1" };
const STAFF = { role: "audit_staff", id: "staff1" };
const OWNER = { role: "action_owner", id: "own1" };
const obs = (w: any) => w.audits[0].reports[0].observations;
const findObs = (w: any, id: string) => obs(w).find((o: any) => o.id === id);

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
  inc.fraudRisks[0].status = "Mitigated";
  inc.auditUniverse.push({ id: "u2", name: "New", factors: {} });
  inc.iaSAList[0].period = "H2 2026";
  inc.departments.push({ id: "d2", name: "Legal" });
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.data.fraudRisks[0].status === "Identified", "fraud risk change reverted");
  ok(r.data.auditUniverse.length === 1, "audit universe addition reverted");
  ok(r.data.iaSAList[0].period === "H1 2026", "IA self-assessment change reverted");
  ok(r.data.departments.length === 1, "departments change reverted");
  ok(["section:fraudRisks", "section:auditUniverse", "section:iaSAList", "section:departments"].every((s) => r.violations.includes(s)), "locked-section violations recorded");
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
  const r = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, inc);
  ok(r.data.extFindings[0].ownerResponse === "we fixed it", "owner can remediate an external finding");
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
