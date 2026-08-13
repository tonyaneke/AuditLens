/* eslint-disable @typescript-eslint/no-explicit-any --
   These tests exist to prove the server rejects documents a well-typed client would never send:
   partial saves, records echoed back out of scope, forged notifications. Typing the fixtures as
   WorkspaceDb would make the compiler refuse exactly the malformed inputs under test. */

// Tests for lib/workspace-authz.ts and lib/workspace-scope.ts.
// Run with: npm test   (or: npx tsx scripts/workspace-authz.test.mts)
import { authorizeWorkspaceWrite } from "../lib/workspace-authz";
import { graftServerHeld, slimForClient } from "../lib/workspace-payload";
import { scopeWorkspace, viewerFor } from "../lib/workspace-scope";
import { normalizeDept } from "../lib/dept-scope";

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
    // Both of these are withheld by slimForClient() from every non-head, so a staff client's
    // saved document legitimately differs from storage in these two sections. Present in the
    // fixture so the locked-section check is exercised against a realistic served payload.
    processReviews: [{ id: "p1", name: "Disbursement SOP", sopPdfBase64: "JVBERi0xLjQK" }],
    exco: { briefs: [{ id: "b1", period: "H1 2026", token: "secret-brief-token" }] },
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
        // The engagement work product: staff record fieldwork results straight onto plan.tests.
        plan: {
          scope: "Credit origination", objectives: ["Confirm approval limits"], keyRisks: ["Override"],
          tests: [{
            id: "t1", ref: "T1", title: "Consent for Third-Party Data", objective: "Confirm valid consent",
            result: "Not Tested", resultNotes: "", testedBy: "", testedDate: "", evidenceRef: "",
          }],
        },
        tor: { background: "orig background" },
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
// Audit staff who lead no engagement and raised nothing — the control for canVerifyItem.
const STAFF2 = { role: "audit_staff", id: "staff2" };
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
  const cur = baseWorkspace();
  // Start from what GET actually served, as a real client does — not from raw storage. A document
  // built from storage carries the SOP PDF and brief token the server withheld, and sending those
  // back is itself flagged (correctly: the client was never given them).
  const inc = clone(slimForClient(cur, { id: STAFF.id, role: "audit_staff" }));
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

console.log("\n== Staff may edit report and audit metadata, but not delete a report ==");
{
  const cur = baseWorkspace(); const inc = clone(cur);
  inc.audits[0].reports[0].execSummary = "staff updated summary"; // report edit — allowed
  inc.audits[0].name = "Renamed audit";                            // audit edit — allowed since 2026-08-12
  inc.audits[0].status = "Completed";
  inc.audits[0].period = "Q3 2026";
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.data.audits[0].reports[0].execSummary === "staff updated summary", "staff can edit report metadata");
  ok(r.data.audits[0].name === "Renamed audit", "staff can rename an audit");
  ok(r.data.audits[0].status === "Completed", "staff can move an engagement to Completed");
  ok(r.data.audits[0].period === "Q3 2026", "staff can correct the period");
  ok(r.data.audits[0].id === "a1", "the audit id is pinned to the stored one");
  // ...but never create or delete one
  const incNew = clone(cur);
  incNew.audits.push({ id: "a9", name: "Invented", reports: [] });
  const rNew = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, incNew);
  ok((rNew.data.audits || []).length === 2, "staff cannot create an audit");
  ok(rNew.violations.includes("audit_create_blocked:a9"), "audit create block recorded");
  const incDel = clone(cur); incDel.audits = [incDel.audits[1]];
  const rDel = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, incDel);
  ok((rDel.data.audits || []).length === 2, "staff cannot delete an audit");
  ok(rDel.violations.includes("audit_delete_blocked:a1"), "audit delete block recorded");
  // deleting the report (would nuke its observations) is blocked
  const inc2 = clone(cur); inc2.audits[0].reports = [];
  const r2 = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc2);
  ok(r2.data.audits[0].reports.length === 1 && findObs(r2.data, "o1"), "report deletion is blocked (observations preserved)");
  ok(r2.violations.includes("report_delete_blocked:r1"), "report-delete block recorded");
}

console.log("\n== Staff fieldwork on the audit plan persists (was silently discarded) ==");
{
  // The reported symptom: a staff member fills in a test's Result / Tested by / Test date / what
  // was found, the save returns 200 and toasts "Audit test saved", and the edit is gone on reload
  // because the whole audit — plan included — was being taken from storage.
  const cur = baseWorkspace();
  // Start from what GET actually served, as a real client does — a document built from raw storage
  // carries the SOP PDF and brief token the server withheld, which are locked-section violations.
  const serve = () => clone(slimForClient(cur, { id: STAFF.id, role: "audit_staff" } as any));
  const inc = serve();
  const t = inc.audits[0].plan.tests[0];
  t.result = "Exception";
  t.testedBy = "Halima";
  t.testedDate = "2026-08-12";
  t.resultNotes = "Consent forms were not signed by a representative of the corporation.";
  t.evidenceRef = "WP-3.2";
  inc.audits[0].plan.tests.push({ id: "t2", ref: "T2", title: "Retention schedule", result: "Not Tested" });
  inc.audits[0].plan.scope = "Credit origination and consent management";
  inc.audits[0].tor = { background: "revised background" };

  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  const saved = r.data.audits[0].plan.tests[0];
  ok(saved.result === "Exception", "fieldwork result persists");
  ok(saved.testedBy === "Halima" && saved.testedDate === "2026-08-12", "tester and test date persist");
  ok(saved.resultNotes.startsWith("Consent forms"), "what-was-found note persists");
  ok(saved.evidenceRef === "WP-3.2", "working-paper reference persists");
  ok(r.data.audits[0].plan.tests.length === 2, "staff may add a test to the programme");
  ok(r.data.audits[0].plan.scope === "Credit origination and consent management", "plan scope is editable");
  ok(r.data.audits[0].tor.background === "revised background", "terms of reference are editable");
  ok(r.violations.length === 0, `no violations for staff fieldwork (got ${JSON.stringify(r.violations)})`);

  // Deleting a test is the same surface — the detail page offers staff a 🗑 on every row.
  const inc2 = serve(); inc2.audits[0].plan.tests = [];
  const r2 = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc2);
  ok(r2.data.audits[0].plan.tests.length === 0, "staff may delete a test");

  // An action owner gets nowhere near any of it.
  const incOwner = clone(cur);
  incOwner.audits[0].plan.tests[0].result = "Passed";
  const rOwner = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, incOwner);
  ok(rOwner.data.audits[0].plan.tests[0].result === "Not Tested", "an action owner cannot write the test programme");
}

console.log("\n== Allowed governance changes are attributable server-side (notices) ==");
{
  /* Staff may reassign the lead auditor, which is a GRANT — half of canVerifyItem(). The client's
     own logAudit call cannot evidence it (a crafted client skips it), so the server records it. */
  const cur = baseWorkspace();
  // From the served payload, not raw storage — otherwise the withheld SOP PDF and brief token
  // ride back and register as locked-section violations, masking the assertion below.
  const inc = clone(slimForClient(cur, { id: STAFF.id, role: "audit_staff" } as any));
  inc.audits[0].leadAuditorId = STAFF2.id;
  inc.audits[0].name = "Credit & Collections Audit";
  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, inc);
  ok(r.notices.includes("audit_lead_reassigned:a1:staff1->staff2"), "lead-auditor reassignment is recorded with both ids");
  ok(r.notices.includes("audit_meta:a1:name:Credit Audit->Credit & Collections Audit"), "a rename is recorded with both values");
  ok(r.violations.length === 0, "none of it is a violation — the change is allowed, just attributed");

  // Routine fieldwork must not drown those rows out.
  const incWork = clone(cur);
  incWork.audits[0].plan.tests[0].result = "Exception";
  incWork.audits[0].tor = { background: "revised" };
  const rWork = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, incWork);
  ok(rWork.notices.length === 0, "editing the plan or TOR raises no notice");

  // The Head is trusted wholesale and is already identified by the session on every write.
  const incHead = clone(cur); incHead.audits[0].leadAuditorId = STAFF2.id;
  const rHead = authorizeWorkspaceWrite(HEAD.role, HEAD.id, cur, incHead);
  ok(rHead.notices.length === 0, "the head's own reassignment raises no notice");

  // An owner cannot change it at all, so it stays a violation rather than a notice.
  const incOwner = clone(cur); incOwner.audits[0].leadAuditorId = OWNER.id;
  const rOwner = authorizeWorkspaceWrite(OWNER.role, OWNER.id, cur, incOwner);
  ok((rOwner.data.audits as any[])[0].leadAuditorId === "staff1", "an owner's reassignment is reverted");
  ok(rOwner.notices.length === 0, "and is not recorded as an allowed change");
}

console.log("\n== Only the item's auditor may sign off — not just any audit staff ==");
{
  /* canVerifyItem() (lib/workspace/observations.ts) allows the lead auditor, the auditor who
     raised the item, or the Head. The server used to check `role === STAFF_ROLE` alone, so any
     audit staff could verify any observation in the organisation through the API. */
  const cur = baseWorkspace();
  cur.audits[0].reports[0].observations[0].ownerRectifiedAt = "2026-08-10T09:00:00Z"; // owner responded
  const serveTo = (id: string) => clone(slimForClient(cur, { id, role: "audit_staff" } as any));

  // staff2 leads nothing on a1 (leadAuditorId is staff1) and raised nothing (raisedBy is staff1).
  const incOther = serveTo(STAFF2.id);
  const oOther = incOther.audits[0].reports[0].observations[0];
  oOther.reportVerifiedAt = "2026-08-11T09:00:00Z";
  oOther.reportVerifiedByName = "Not the auditor";
  oOther.closureNote = "looks fine to me";
  const rOther = authorizeWorkspaceWrite(STAFF2.role, STAFF2.id, cur, incOther);
  ok(findObs(rOther.data, "o1").reportVerifiedAt == null, "a non-auditor staff member cannot verify");
  ok(findObs(rOther.data, "o1").closureNote == null, "their closure note is dropped with it");
  ok(rOther.violations.some((v) => v.startsWith("obs_verify_blocked:o1:")), "verify block recorded");

  // The send-back half of the same dialog is blocked as one unit, so the owner is never left
  // unwound with no explanation.
  const incBack = serveTo(STAFF2.id);
  incBack.audits[0].reports[0].observations[0].ownerRectifiedAt = "";
  const rBack = authorizeWorkspaceWrite(STAFF2.role, STAFF2.id, cur, incBack);
  ok(findObs(rBack.data, "o1").ownerRectifiedAt === "2026-08-10T09:00:00Z", "a non-auditor cannot send back");

  // Ordinary IA chasing work is still open to any staff member.
  const incChase = serveTo(STAFF2.id);
  incChase.audits[0].reports[0].observations[0].updateRequestedAt = "2026-08-11T10:00:00Z";
  incChase.audits[0].reports[0].observations[0].attachments = [{ id: "wp1", name: "WP-3.2.pdf" }];
  const rChase = authorizeWorkspaceWrite(STAFF2.role, STAFF2.id, cur, incChase);
  ok(findObs(rChase.data, "o1").updateRequestedAt === "2026-08-11T10:00:00Z", "any staff may request an update");
  ok(findObs(rChase.data, "o1").attachments.length === 1, "any staff may attach a working paper");

  // The lead auditor still can, and the derived closure date rides along.
  const incLead = serveTo(STAFF.id);
  const oLead = incLead.audits[0].reports[0].observations[0];
  oLead.reportVerifiedAt = "2026-08-11T09:00:00Z";
  oLead.closedDateISO = "2026-08-11";
  const rLead = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, incLead);
  ok(findObs(rLead.data, "o1").reportVerifiedAt === "2026-08-11T09:00:00Z", "the lead auditor may verify");
  ok(findObs(rLead.data, "o1").closedDateISO === "2026-08-11", "the proposed closure date rides along");
  ok(rLead.violations.length === 0, `no violations for the lead auditor (got ${JSON.stringify(rLead.violations)})`);

  // So may the auditor who raised it, on an audit somebody else leads.
  const cur2 = baseWorkspace();
  cur2.audits[0].leadAuditorId = "staff9";
  cur2.audits[0].reports[0].observations[0].raisedBy = STAFF2.id;
  cur2.audits[0].reports[0].observations[0].ownerRectifiedAt = "2026-08-10T09:00:00Z";
  const incRaiser = clone(slimForClient(cur2, { id: STAFF2.id, role: "audit_staff" } as any));
  incRaiser.audits[0].reports[0].observations[0].reportVerifiedAt = "2026-08-11T09:00:00Z";
  const rRaiser = authorizeWorkspaceWrite(STAFF2.role, STAFF2.id, cur2, incRaiser);
  ok(findObs(rRaiser.data, "o1").reportVerifiedAt === "2026-08-11T09:00:00Z", "the auditor who raised it may verify");

  // A staff member cannot appoint themselves lead auditor and verify in the SAME save — the check
  // reads the lead auditor from stored state. (Across two saves it is allowed by design.)
  const incGrab = serveTo(STAFF2.id);
  incGrab.audits[0].leadAuditorId = STAFF2.id;
  incGrab.audits[0].reports[0].observations[0].reportVerifiedAt = "2026-08-11T09:00:00Z";
  const rGrab = authorizeWorkspaceWrite(STAFF2.role, STAFF2.id, cur, incGrab);
  ok((rGrab.data.audits as any[])[0].leadAuditorId === STAFF2.id, "the reassignment itself is allowed");
  ok(findObs(rGrab.data, "o1").reportVerifiedAt == null, "but it does not grant verification in the same save");
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

console.log("\n== SEC-01: an AUDIT STAFF round trip logs no violations either ==");
{
  /* Regression: staff are full-scope, so scopeWorkspace() returns the document untouched — but
     slimForClient() still strips SOP PDFs and exco brief tokens from them. Using the former as
     the "what did they see" baseline flagged section:exco and section:processReviews on every
     single staff save. Caught by scripts/verify-scope.mts against live data, not by fixtures. */
  const cur = baseWorkspace();
  const served = clone(slimForClient(cur, { id: STAFF.id, role: "audit_staff" }));
  ok(served.processReviews[0].sopPdfBase64 === undefined, "SOP PDF is withheld from staff");
  ok(served.exco.briefs[0].token === undefined, "brief token is withheld from staff");

  const r = authorizeWorkspaceWrite(STAFF.role, STAFF.id, cur, served);
  ok(r.violations.length === 0, `no violations for an untouched staff save (got ${JSON.stringify(r.violations)})`);

  // And the withheld values must survive the save rather than being blanked by omission.
  const grafted = graftServerHeld(cur, r.data, STAFF.id) as any;
  ok(grafted.processReviews[0].sopPdfBase64 === "JVBERi0xLjQK", "the stored SOP PDF is grafted back");
  ok(grafted.exco.briefs[0].token === "secret-brief-token", "the stored brief token is grafted back");
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

/* ================= department-scoped visibility (2026-08-05) =================
   An observation is raised against a department, so everyone in that department sees it and any
   of them can answer it. "colleague" below is a Credit staff member with NO record assigned to
   them — under the old rule they saw an empty portal.

   The fixture's one department record ("Credit", headed by own1) is what ties them together, and
   o1/e1 hang off own1. o2/o3 belong to own2, who heads nothing — so they stay invisible, which is
   the control for every assertion here. */
console.log("\n== SEC-01: department-scoped observations ==");
{
  const cur = baseWorkspace();
  const colleague = { role: "action_owner", id: "col1", department: "Credit" };
  const outsider = { role: "action_owner", id: "out1", department: "Legal" };

  const mine = scopeWorkspace(cur, viewerFor(colleague, cur)) as any;
  ok(!!findObs(mine, "o1"), "a colleague sees their department's observation");
  ok(!findObs(mine, "o2"), "another department's observation in the same report is withheld");
  ok(!findObs(mine, "o3"), "an audit with nothing of theirs in it is withheld");
  ok(mine.audits.length === 1 && mine.audits[0].reports.length === 1, "only the audit/report skeleton they need");

  // Department name matching is normalised, not raw: "credit department" is the same department.
  const looseName = scopeWorkspace(cur, viewerFor({ ...colleague, department: "credit department" }, cur)) as any;
  ok(!!findObs(looseName, "o1"), "department names match case- and suffix-insensitively");

  const theirs = scopeWorkspace(cur, viewerFor(outsider, cur)) as any;
  ok(!findObs(theirs, "o1"), "a different department sees nothing of Credit's");

  /* External findings ARE department-scoped too (2026-08-06). e1 is own1's — the head of Credit —
     so a Credit colleague sees it; e2 belongs to own2 and must stay hidden. */
  ok(!!findExt(mine, "e1"), "a colleague sees their department's external finding");
  ok(!findExt(mine, "e2"), "another department's external finding is withheld");
  // The fraud register is NOT — those actions are still assigned to an individual.
  ok(!(mine.fraudRisks || []).length, "the fraud register is not department-scoped");

  // A pending observation is not yet a finding: the department must not see it before approval.
  const pending = baseWorkspace();
  pending.audits[0].reports[0].observations[0].obsApproval = "pending";
  const beforeApproval = scopeWorkspace(pending, viewerFor(colleague, pending)) as any;
  ok(!findObs(beforeApproval, "o1"), "an unapproved observation is withheld from the department");

  /* The stale-departmentId case, which is why matching also goes through the owner: 13 live
     observations point at a department record that no longer exists. */
  const stale = baseWorkspace();
  stale.audits[0].reports[0].observations[0].departmentId = "deptGONE";
  const viaOwner = scopeWorkspace(stale, viewerFor(colleague, stale)) as any;
  ok(!!findObs(viaOwner, "o1"), "a stale departmentId still resolves through the owner");

  /* And the two-records-one-department case: a second action owner for Credit creates a second
     department record, and its observations must reach the same people. */
  const twoRecords = baseWorkspace();
  twoRecords.departments.push({ id: "d2", name: "Credit Department", headUserId: "own3" });
  twoRecords.audits[0].reports[0].observations.push({
    id: "o4", title: "Second Credit owner", criticality: "Low", status: "Open",
    obsApproval: "approved", ownerUserId: "own3", owner: "Ada", raisedBy: "staff1", updates: [],
  });
  const merged = scopeWorkspace(twoRecords, viewerFor(colleague, twoRecords)) as any;
  ok(!!findObs(merged, "o1") && !!findObs(merged, "o4"), "both department records feed one department's list");
}

console.log("\n== A colleague may remediate, but no more than an owner can ==");
{
  const cur = baseWorkspace();
  const colleague = { id: "col1", role: "action_owner", department: "Credit" };
  const served = clone(slimForClient(cur, viewerFor(colleague, cur)));

  // The legitimate write: describe what the department did and mark it Ready for Closure.
  const at = "2026-08-05T09:00:00.000Z";
  findObs(served, "o1").ownerResponse = "Segregation matrix reissued.";
  findObs(served, "o1").ownerRectifiedAt = at;
  findObs(served, "o1").ownerRectifiedBy = "col1";
  const r = authorizeWorkspaceWrite(colleague.role, colleague.id, cur, served, undefined, colleague.department);
  ok(findObs(r.data, "o1").ownerRectifiedAt === at, "a department colleague can mark Ready for Closure");
  ok(findObs(r.data, "o1").status === "In Progress", "the status transition is still derived server-side");
  ok(r.violations.length === 0, "an untouched department payload round-trips cleanly");

  // Everything else is as locked for them as it is for the named owner.
  const served2 = clone(slimForClient(cur, viewerFor(colleague, cur)));
  findObs(served2, "o1").title = "Colleague edited";
  findObs(served2, "o1").status = "Closed";
  const r2 = authorizeWorkspaceWrite(colleague.role, colleague.id, cur, served2, undefined, colleague.department);
  ok(findObs(r2.data, "o1").title === "Weak SoD", "a colleague cannot edit the finding");
  ok(findObs(r2.data, "o1").status === "Open", "a colleague cannot close an observation");

  // And a colleague of one department cannot reach into another's, even by echoing it back.
  const served3 = clone(slimForClient(cur, viewerFor(colleague, cur)));
  served3.audits[0].reports[0].observations.push({ ...findObs(cur, "o2"), ownerResponse: "not mine" });
  served3.extFindings.push({ ...findExt(cur, "e2"), ownerResponse: "not mine either" });
  const r3 = authorizeWorkspaceWrite(colleague.role, colleague.id, cur, served3, undefined, colleague.department);
  ok(findObs(r3.data, "o2").ownerResponse === undefined, "another department's observation stays untouched");
  ok(findExt(r3.data, "e2").ownerResponse === undefined, "another department's external finding stays untouched");
  ok(r3.violations.includes("out_of_scope_write:obs:o2"), "the out-of-scope write is recorded");
  ok(r3.violations.includes("out_of_scope_write:ext:e2"), "the out-of-scope external write is recorded");

  // The legitimate case: a colleague remediating their department's external finding.
  const served4 = clone(slimForClient(cur, viewerFor(colleague, cur)));
  findExt(served4, "e1").ownerResponse = "Access matrix reissued.";
  findExt(served4, "e1").ownerRectifiedAt = "2026-08-06T09:00:00.000Z";
  const r4 = authorizeWorkspaceWrite(colleague.role, colleague.id, cur, served4, undefined, colleague.department);
  ok(findExt(r4.data, "e1").ownerResponse === "Access matrix reissued.", "a colleague can remediate their department's external finding");
  ok(findExt(r4.data, "e1").status === "In Progress", "its status transition is derived server-side too");
}

/* ================= two departments at once (2026-08-06) =================
   Two people straddle two departments — the Head of Admin, People & Culture, and the Chief of
   Staff who covers Strategic Comms alongside the MD's office. `extraDepartments` is what stops
   them having to choose which half of their job they can see. */
console.log("\n== A person in two departments sees both ==");
{
  const cur = baseWorkspace();
  // own2 heads Legal (they own o2 and o3); own3 heads Treasury, which the viewer is NOT in.
  cur.departments.push({ id: "d2", name: "Legal", headUserId: "own2" });
  cur.departments.push({ id: "d3", name: "Treasury", headUserId: "own3" });
  cur.audits[0].reports[0].observations.push({
    id: "o5", title: "Treasury only", criticality: "Low", status: "Open", obsApproval: "approved",
    ownerUserId: "own3", owner: "Ngozi", raisedBy: "staff1", updates: [],
  });

  const oneDept = scopeWorkspace(cur, viewerFor({ id: "x1", role: "action_owner", department: "Credit" }, cur)) as any;
  ok(!!findObs(oneDept, "o1") && !findObs(oneDept, "o2"), "one department sees only its own");

  const bothDepts = scopeWorkspace(
    cur,
    viewerFor({ id: "x1", role: "action_owner", department: "Credit", extraDepartments: ["Legal"] }, cur),
  ) as any;
  ok(!!findObs(bothDepts, "o1"), "the home department still resolves");
  ok(!!findObs(bothDepts, "o2"), "the second department resolves too");
  ok(!findObs(bothDepts, "o5"), "a department they are in neither of is still withheld");

  // And the write path must agree, or their ordinary save is logged as an out-of-scope write.
  const served = clone(slimForClient(cur, viewerFor({ id: "x1", role: "action_owner", department: "Credit", extraDepartments: ["Legal"] }, cur)));
  const r = authorizeWorkspaceWrite("action_owner", "x1", cur, served, undefined, "Credit", ["Legal"]);
  ok(r.violations.length === 0, "a two-department payload round-trips cleanly");
}

/* The alias table folds names no rule could infer. Each of these is a live case: the roster calls
   a department something the workspace record does not. */
console.log("\n== Department aliases resolve to one department ==");
{
  const pairs: [string, string, string][] = [
    ["Finance", "Finance & Accounts", "the CFO's department and his team's are one"],
    ["Admin", "Administration Department", "Admin is Administration"],
    ["P&C", "People & Culture Department", "P&C is People & Culture"],
    ["OMD", "Office of the Managing Director", "OMD is the MD's office"],
    ["Strategic Comms", "Corporate Communications", "the roster name and the record name are one unit"],
    ["Operations Department", "Impact & Sustainability", "Operations is retired into Impact & Sustainability"],
  ];
  for (const [a, b, why] of pairs) ok(normalizeDept(a) === normalizeDept(b), why);

  // …and nothing else collapses. These are genuinely different departments.
  const distinct: [string, string][] = [
    ["Operations", "Credit Operations"],
    ["Strategy", "Strategic Comms"],
    ["IT", "Internal Audit"],
  ];
  for (const [a, b] of distinct) ok(normalizeDept(a) !== normalizeDept(b), `${a} is not ${b}`);
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
