/* eslint-disable @typescript-eslint/no-explicit-any --
   Fixtures are hand-built workspace documents, edited in place the way the client edits them. */

// Tests for lib/workspace-changes.ts — the audit trail of a workspace save.
// Run with: npm test   (or: npx tsx scripts/workspace-changes.test.mts)
//
// Two kinds of test. The first half drives describeWorkspaceChanges() directly: each workflow step
// must read as that step, once, without its stamps leaking out as "edited" fields. The second half
// runs whole saves through the same path app/api/data/route.ts uses — scope, authorize, graft,
// retain soft-deletes, then describe — because the trail's real promise is about THAT path: an
// unchanged save records nothing, and a change the server reverted is never recorded as made.
import fs from "node:fs";
import path from "node:path";
import { describeWorkspaceChanges } from "../lib/workspace-changes";
import { authorizeWorkspaceWrite } from "../lib/workspace-authz";
import { graftServerHeld, slimForClient } from "../lib/workspace-payload";
import { viewerFor } from "../lib/workspace-scope";
import { retainDeleted, withoutDeleted } from "../lib/workspace-tombstones";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, detail?: unknown) {
  if (cond) { pass++; console.log("  ok " + msg); }
  else { fail++; console.error("  x FAIL: " + msg + (detail !== undefined ? "\n      " + JSON.stringify(detail) : "")); }
}
const clone = (x: any) => JSON.parse(JSON.stringify(x));
const acts = (es: { action: string }[]) => es.map((e) => e.action);
const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

function base(): any {
  return {
    org: "CREDICORP",
    planYear: "2026",
    planYears: ["2026"],
    strictClosureCheck: false,
    departments: [
      { id: "d1", name: "Credit", headUserId: "own1", headName: "Ola", headEmail: "o@x.com" },
      { id: "d2", name: "Legal", headUserId: "own2", headName: "Bala", headEmail: "b@x.com" },
    ],
    audits: [
      {
        id: "a1", name: "Credit Audit", type: "Assurance", period: "Q1 2026", status: "In progress",
        leadAuditorId: "staff1", leadAuditor: "Sade",
        plan: {
          scope: "Origination",
          tests: [
            { id: "t1", ref: "T1", title: "Consent", name: "Consent", result: "Not Tested", resultNotes: "", notes: "" },
            { id: "t2", ref: "T2", title: "Limits", name: "Limits", result: "Not Tested" },
          ],
        },
        tor: { background: "orig" },
        reports: [
          {
            id: "r1", title: "Credit Report", status: "Draft",
            observations: [
              {
                id: "o1", ref: "1.1", title: "Weak access", criticality: "High", status: "Open", owner: "Ola",
                ownerUserId: "own1", departmentId: "d1", dueDate: "2026-09-30", obsApproval: "approved",
                raisedBy: "staff1", updates: [],
              },
              {
                id: "o2", ref: "1.2", title: "No reconciliation", criticality: "Moderate", status: "Open",
                owner: "Bala", ownerUserId: "own2", departmentId: "d2", obsApproval: "approved", updates: [],
              },
            ],
          },
          { id: "r2", title: "Follow-up", observations: [] },
        ],
      },
      {
        id: "a2", name: "IT Audit",
        reports: [{
          id: "r3", title: "IT Report",
          observations: [{ id: "o3", ref: "2.1", title: "Patch gaps", criticality: "Low", status: "Open", owner: "Ola", ownerUserId: "own1", departmentId: "d1", obsApproval: "approved" }],
        }],
      },
    ],
    extFindings: [
      { id: "e1", title: "Weak access (CBN)", status: "Open", severity: "High", ownerUserId: "own1", owner: "Ola", departmentId: "d1" },
    ],
    fraudRisks: [
      {
        id: "f1", scheme: "Ghost borrowers", likelihood: 4, impact: 4, status: "Identified", ownerUserId: "own1", departmentId: "d1",
        actions: [{ id: "fa1", text: "Monthly reconciliation", status: "Planned", ownerUserId: "own1", owner: "Ola" }],
      },
    ],
    auditUniverse: [{ id: "u1", name: "Credit Ops", plannedPeriod: "Q1, Q2", engStatus: "In progress", occDone: ["Q1"], factors: { impact: 3 } }],
    processReviews: [{ id: "p1", sopTitle: "Disbursement SOP", sopPdfBase64: "JVBERi0xLjQK", findings: [{ id: "pf1", title: "Gap" }] }],
    iaSAList: [
      { id: "ia1", period: "H1 2026", std: {}, items: {} },
      { id: "ia2", period: "H1 2026", userId: "staff1", assessor: "Sade", std: {}, items: {} },
    ],
    iaSAUserCurrent: { staff1: "ia2" },
    iaSACurrentId: "ia1",
    approvals: [
      {
        id: "ap1", kind: "observation_status_change", obsId: "o1", obsTitle: "Weak access", fromStatus: "Open",
        newStatus: "Closed", status: "pending", requestedBy: "staff1", requestedByName: "Sade",
      },
    ],
    notifications: [{ id: "n1", userId: "own1", kind: "x", text: "hi", link: "myobs", read: false, at: "2026-09-01" }],
    exco: {
      headline: "All good",
      recipientList: [{ id: "x1", name: "MD", email: "md@x.com" }],
      briefs: [{ id: "b1", period: "As at 1 Sep 2026", token: "tok", sentAt: "", sentTo: 0 }],
    },
  };
}

const obs = (db: any, id: string) => {
  for (const a of db.audits) for (const r of a.reports) for (const o of r.observations) if (o.id === id) return o;
  throw new Error("no obs " + id);
};

/** A describe of one edit: clone, edit, diff. */
function after(edit: (db: any) => void, from: any = base()): { events: any[]; actions: string[] } {
  const b = clone(from);
  const a = clone(from);
  edit(a);
  const events = describeWorkspaceChanges(b, a);
  return { events, actions: acts(events) };
}

/** A whole save through the /api/data PUT path. */
type Who = { id: string; role: string; activeRole?: string; department?: string; extraDepartments?: string[]; name?: string };
function save(stored: any, who: Who, edit?: (doc: any) => void) {
  const served = withoutDeleted(stored);
  const incoming = clone(slimForClient(served, viewerFor(who, served)));
  edit?.(incoming);
  const { data: authorized } = authorizeWorkspaceWrite(
    who.role, who.id, served, incoming, who.activeRole, who.department, who.extraDepartments,
  );
  const payload = retainDeleted(stored, graftServerHeld(served, authorized, who.id), { id: who.id, name: who.name || who.id });
  const events = describeWorkspaceChanges(served, withoutDeleted(payload));
  return { events, actions: acts(events), payload };
}

const HEAD: Who = { id: "head1", role: "head_of_audit", name: "Awa" };
const STAFF: Who = { id: "staff1", role: "audit_staff", name: "Sade" };
const OWNER1: Who = { id: "own1", role: "action_owner", department: "Credit", name: "Ola" };
const OWNER2: Who = { id: "own2", role: "action_owner", department: "Legal", name: "Bala" };
const EXEC: Who = { id: "exec1", role: "executive", name: "MD" };
const ADMIN: Who = { id: "adm1", role: "admin", name: "Admin" };
const ADMIN_AS_OWNER: Who = { id: "own1", role: "admin", activeRole: "action_owner", department: "Credit", name: "Admin" };

console.log("\n== Nothing changed → nothing recorded ==");
{
  ok(describeWorkspaceChanges(base(), base()).length === 0, "an identical document records nothing");
  const r = after((db) => {
    obs(db, "o1").description = ""; // blank where the field was absent
    const o2 = obs(db, "o2");
    const reordered = Object.fromEntries(Object.entries(o2).reverse());
    db.audits[0].reports[0].observations[1] = reordered; // same record, keys in another order
  });
  ok(r.events.length === 0, "re-serialising a record (blank fields, key order) is not a change", r.actions);
  const v = after((db) => {
    db.planYear = "2027";
    db.iaSACurrentId = "ia2";
    db.iaSAUserCurrent = { staff1: "ia1" };
    db.notifications[0].read = true;
    db.lastBackup = "2026-09-26";
  });
  ok(v.events.length === 0, "view state (plan year on screen, open assessment, read flags) is a click, not a change", v.actions);
}

console.log("\n== Observations: each workflow step reads as that step, once ==");
{
  const raised = after((db) => db.audits[0].reports[1].observations.push({ id: "o9", ref: "3.1", title: "New gap", criticality: "Critical", status: "Open", owner: "Ola", obsApproval: "approved" }));
  ok(sameList(raised.actions, ["obs.raised"]), "the Head raising an observation → obs.raised", raised.actions);
  ok(/Raised observation 3\.1 “New gap” in “Credit Audit”/.test(raised.events[0].summary), "…named with its ref, title and audit", raised.events[0].summary);

  const pending = after((db) => db.audits[0].reports[1].observations.push({ id: "o9", title: "New gap", criticality: "High", obsApproval: "pending" }));
  ok(sameList(pending.actions, ["obs.raise_requested"]), "staff raising one for approval → obs.raise_requested", pending.actions);

  const b = base();
  obs(b, "o1").obsApproval = "pending";
  const approved = after((db) => (obs(db, "o1").obsApproval = "approved"), b);
  ok(sameList(approved.actions, ["obs.approved"]), "the Head approving it → obs.approved", approved.actions);
  const rejected = after((db) => (obs(db, "o1").obsApproval = "rejected"), b);
  ok(sameList(rejected.actions, ["obs.rejected"]), "…or rejecting it → obs.rejected (it is kept, not deleted)", rejected.actions);

  const responded = after((db) => {
    Object.assign(obs(db, "o1"), {
      ownerRectifiedAt: "2026-09-20T10:00:00Z", ownerRectifiedBy: "own1", ownerRectifiedByName: "Ola",
      ownerResponse: "Access reviewed and revoked", ownerResponseEvidence: [{ itemId: "i1", name: "review.pdf" }],
      status: "In Progress", progressReport: null,
    });
  });
  ok(sameList(responded.actions, ["obs.ready_for_closure"]), "the owner's closure response → one entry, its status change and stamps folded in", responded.actions);
  ok(/with 1 evidence file: “Access reviewed and revoked”/.test(responded.events[0].summary), "…quoting the response and counting the evidence", responded.events[0].summary);

  const withResponse = clone(base());
  Object.assign(obs(withResponse, "o1"), { ownerRectifiedAt: "2026-09-20T10:00:00Z", ownerResponse: "Done", status: "In Progress" });
  const verified = after((db) => {
    Object.assign(obs(db, "o1"), {
      reportVerifiedAt: "2026-09-21T10:00:00Z", reportVerifiedBy: "staff1", reportVerifiedByName: "Sade",
      closureNote: "Evidence sighted", closedDateISO: "2026-09-21",
    });
  }, withResponse);
  ok(sameList(verified.actions, ["obs.report_verified"]), "the auditor verifying → obs.report_verified only", verified.actions);
  ok(/proposed closure date 21 Sep 2026/.test(verified.events[0].summary), "…with the proposed closure date", verified.events[0].summary);

  const withVerify = clone(withResponse);
  Object.assign(obs(withVerify, "o1"), { reportVerifiedAt: "2026-09-21T10:00:00Z", reportVerifiedByName: "Sade", closedDateISO: "2026-09-21" });
  const closed = after((db) => {
    Object.assign(obs(db, "o1"), { headVerifiedAt: "2026-09-22T10:00:00Z", headVerifiedByName: "Awa", headComment: "Agreed", status: "Closed" });
  }, withVerify);
  ok(sameList(closed.actions, ["obs.closed"]), "the Head signing off → obs.closed only", closed.actions);

  const returned = after((db) => {
    const o = obs(db, "o1");
    delete o.reportVerifiedAt;
    delete o.reportVerifiedByName;
    o.closureRejection = { target: "auditor", note: "Need the access log extract", byRole: "head_of_audit" };
  }, withVerify);
  ok(sameList(returned.actions, ["obs.closure_rejected"]), "the Head returning it to the auditor → obs.closure_rejected", returned.actions);
  ok(/to the auditor for more work: “Need the access log extract”/.test(returned.events[0].summary), "…saying to whom and why", returned.events[0].summary);

  const toOwner = after((db) => {
    const o = obs(db, "o1");
    delete o.ownerRectifiedAt;
    o.closureRejection = { target: "owner", note: "Attach the review" };
  }, withResponse);
  ok(sameList(toOwner.actions, ["obs.closure_rejected"]) && /to the action owner/.test(toOwner.events[0].summary), "the auditor returning it to the owner → obs.closure_rejected (owner)", toOwner.events.map((e) => e.summary));

  const reassigned = after((db) => Object.assign(obs(db, "o1"), { owner: "Bala", ownerUserId: "own2", departmentId: "d2" }));
  ok(sameList(reassigned.actions, ["obs.reassigned"]), "a reassignment → obs.reassigned", reassigned.actions);
  ok(/owner Ola → Bala; department Credit → Legal/.test(reassigned.events[0].summary), "…by name, department resolved from its id", reassigned.events[0].summary);

  const comment = after((db) => obs(db, "o1").updates.push({ id: "c1", by: "own1", byName: "Ola", at: "2026-09-20", text: "Working on it", audience: "" }));
  ok(sameList(comment.actions, ["obs.update"]) && /Commented on observation 1\.1 “Weak access”: “Working on it”/.test(comment.events[0].summary), "a comment → obs.update, quoted", comment.events.map((e) => e.summary));
  const note = after((db) => obs(db, "o1").updates.push({ id: "c2", by: "own1", text: "Between us", audience: "owner" }));
  ok(/private co-owner note/.test(note.events[0]?.summary || ""), "a private co-owner note says so", note.events.map((e) => e.summary));

  const edited = after((db) => Object.assign(obs(db, "o1"), { criticality: "Critical", description: "Longer text\nover lines" }));
  ok(sameList(edited.actions, ["obs.edited"]), "a content edit → obs.edited", edited.actions);
  ok(/criticality High → Critical; description/.test(edited.events[0].summary), "…short values inline, long text named", edited.events[0].summary);
  ok(edited.events[0].metadata.changes.some((c: any) => c.field === "criticality" && c.from === "High" && c.to === "Critical"), "…with before/after kept for the viewer");

  const status = after((db) => (obs(db, "o1").status = "In Progress"));
  ok(sameList(status.actions, ["obs.status_changed"]), "a bare status change → obs.status_changed", status.actions);

  const reqW = after((db) => (obs(db, "o1").withdrawal = { stage: "owner_requested", ownerReason: "Duplicate of 1.2" }));
  ok(sameList(reqW.actions, ["obs.review_requested"]) && /Duplicate of 1\.2/.test(reqW.events[0].summary), "the owner asking to withdraw → obs.review_requested with the reason", reqW.events.map((e) => e.summary));
  const w1 = clone(base());
  obs(w1, "o1").withdrawal = { stage: "forwarded", ownerReason: "Dup" };
  const withdrawn = after((db) => {
    Object.assign(obs(db, "o1"), { withdrawn: true, withdrawnAt: "2026-09-25" });
    obs(db, "o1").withdrawal = { stage: "withdrawn", ownerReason: "Dup", headReason: "Agreed" };
  }, w1);
  ok(sameList(withdrawn.actions, ["obs.withdrawn"]), "the Head approving the withdrawal → obs.withdrawn, once", withdrawn.actions);
}

console.log("\n== Deletions and moves ==");
{
  const del = after((db) => (db.audits[0].reports[0].observations = db.audits[0].reports[0].observations.filter((o: any) => o.id !== "o2")));
  ok(sameList(del.actions, ["obs.deleted"]), "deleting an observation → obs.deleted", del.actions);
  ok(del.events[0].metadata.snapshot?.title === "No reconciliation", "…keeping what it was");

  const audit = after((db) => (db.audits = db.audits.filter((a: any) => a.id !== "a2")));
  ok(sameList(audit.actions, ["audit.deleted"]), "deleting an audit is one entry, not one per report and observation", audit.actions);
  ok(/with 1 report and 1 observation/.test(audit.events[0].summary) && audit.events[0].metadata.observations.length === 1, "…which says, and lists, what went with it", audit.events[0].summary);

  const report = after((db) => (db.audits[0].reports = db.audits[0].reports.filter((r: any) => r.id !== "r1")));
  ok(sameList(report.actions, ["report.deleted"]), "deleting a report is one entry", report.actions);

  const moved = after((db) => {
    const [o] = db.audits[0].reports[0].observations.splice(0, 1);
    db.audits[0].reports[1].observations.push(o);
  });
  ok(sameList(moved.actions, ["obs.moved"]), "moving an observation between reports → obs.moved, not delete + raise", moved.actions);
}

console.log("\n== Audits and their test programme ==");
{
  const details = after((db) => Object.assign(db.audits[0], { status: "Completed", leadAuditorId: "staff2", leadAuditor: "Tolu" }));
  ok(sameList(details.actions, ["audit.updated"]), "audit details → audit.updated", details.actions);
  ok(/status In progress → Completed; lead auditor Sade → Tolu/.test(details.events[0].summary) && !/lead auditor id/.test(details.events[0].summary), "…the lead auditor reported once, by name", details.events[0].summary);

  const tor = after((db) => (db.audits[0].tor.background = "revised"));
  ok(sameList(tor.actions, ["audit.tor_updated"]), "terms of reference → audit.tor_updated", tor.actions);

  const added = after((db) => db.audits[0].plan.tests.push({ id: "t3", ref: "T3", title: "Pricing" }));
  ok(sameList(added.actions, ["audit.test_added"]), "adding a test → audit.test_added", added.actions);

  const result = after((db) => Object.assign(db.audits[0].plan.tests[0], { result: "Exception", resultNotes: "2 of 25 lacked consent", notes: "2 of 25 lacked consent" }));
  ok(sameList(result.actions, ["audit.test_result"]), "recording a result → one audit.test_result", result.actions);
  ok(/Not Tested → Exception/.test(result.events[0].summary), "…saying what the result became", result.events[0].summary);

  const renamed = after((db) => Object.assign(db.audits[0].plan.tests[1], { title: "Credit limits", name: "Credit limits" }));
  ok(sameList(renamed.actions, ["audit.test_updated"]) && renamed.events[0].metadata.changes.length === 1, "a mirrored field pair (title/name) is reported once", renamed.events[0]?.metadata.changes);

  const dropped = after((db) => db.audits[0].plan.tests.pop());
  ok(sameList(dropped.actions, ["audit.test_deleted"]), "deleting a test → audit.test_deleted", dropped.actions);
}

console.log("\n== Registers, plan, reviews, assessments ==");
{
  const act = after((db) => {
    db.fraudRisks[0].actions[0].status = "In Progress";
    db.fraudRisks[0].status = "Mitigating"; // the roll-up the server derives
  });
  ok(sameList(act.actions, ["fraud.action_status_updated"]), "an action's status → one entry; the risk's roll-up is not news", act.actions);
  const upd = after((db) => (db.fraudRisks[0].actions[0].ownerUpdates = [{ at: "2026-09-20", by: "own1", byName: "Ola", text: "Recon done for Aug" }]));
  ok(sameList(upd.actions, ["fraud.action_update"]) && /Recon done for Aug/.test(upd.events[0].summary), "an implementation update → fraud.action_update, quoted", upd.events.map((e) => e.summary));

  const done = after((db) => Object.assign(db.auditUniverse[0], { engStatus: "Completed", occDone: ["Q1", "Q2"] }));
  ok(sameList(done.actions, ["plan.completed"]), "completing an engagement → plan.completed only", done.actions);
  const q = after((db) => db.auditUniverse[0].occDone.push("Q2"));
  ok(sameList(q.actions, ["plan.unit_updated"]) && /Q2 marked done/.test(q.events[0].summary), "ticking a quarter reads as such", q.events.map((e) => e.summary));

  const sop = after((db) => {
    delete db.processReviews[0].sopPdfBase64;
    db.processReviews[0].sopPdfStored = true;
  });
  ok(sop.events.length === 0, "the SOP PDF being held server-side is not an edit", sop.actions);
  const finding = after((db) => db.processReviews[0].findings.push({ id: "pf2", title: "Second gap" }));
  ok(sameList(finding.actions, ["process.review_updated"]) && /findings \(1 added\)/.test(finding.events[0].summary), "a new review finding is counted", finding.events.map((e) => e.summary));

  const ia = after((db) => Object.assign(db.iaSAList[0], { status: "completed", completedAt: "2026-09-26" }));
  ok(sameList(ia.actions, ["iasa.completed"]), "completing a self-assessment → iasa.completed", ia.actions);
  const std = after((db) => (db.iaSAList[1].std["1.1"] = { conf: "Conforms" }));
  ok(sameList(std.actions, ["iasa.updated"]) && /1 standard updated/.test(std.events[0].summary), "rating a standard is counted", std.events.map((e) => e.summary));

  const ext = after((db) => Object.assign(db.extFindings[0], { ownerRectifiedAt: "2026-09-20", ownerResponse: "Fixed", status: "In Progress" }));
  ok(sameList(ext.actions, ["ext.ready_for_closure"]), "external findings share the workflow → ext.ready_for_closure", ext.actions);
}

console.log("\n== Approvals, settings, the brief ==");
{
  const req = after((db) => db.approvals.push({ id: "ap2", kind: "observation_delete", obsId: "o2", obsTitle: "No reconciliation", status: "pending", reason: "Raised in error" }));
  ok(sameList(req.actions, ["obs.delete_requested"]) && /Raised in error/.test(req.events[0].summary), "a deletion request → obs.delete_requested with its reason", req.events.map((e) => e.summary));
  const decided = after((db) => Object.assign(db.approvals[0], { status: "approved", decidedBy: "head1" }));
  ok(sameList(decided.actions, ["obs.status_change_approved"]), "the Head approving it → obs.status_change_approved", decided.actions);
  ok(!/Sade/.test(decided.events[0].summary), "…without quoting the requester the request itself names — the browser wrote that", decided.events[0].summary);
  const raiseReq = after((db) => db.approvals.push({ id: "ap3", kind: "observation_raise", obsId: "o9", status: "pending" }));
  ok(raiseReq.events.length === 0, "a raise request is not reported twice (the observation's own entry is it)", raiseReq.actions);

  const dept = after((db) => Object.assign(db.departments[0], { headName: "Kemi", headUserId: "own9" }));
  ok(sameList(dept.actions, ["settings.department_updated"]) && /head Ola → Kemi/.test(dept.events[0].summary), "a department's head → settings.department_updated", dept.events.map((e) => e.summary));

  const strict = after((db) => (db.strictClosureCheck = true));
  ok(sameList(strict.actions, ["settings.updated"]) && /strict closure check No → Yes/.test(strict.events[0].summary), "a setting → settings.updated", strict.events.map((e) => e.summary));
  const year = after((db) => db.planYears.push("2027"));
  ok(sameList(year.actions, ["plan.year_created"]), "opening a plan year → plan.year_created", year.actions);

  const gen = after((db) => db.exco.briefs.unshift({ id: "b2", period: "As at 1 Oct 2026", token: "t2", sentAt: "2026-10-01T08:00:00Z", sentTo: 4 }));
  ok(sameList(gen.actions, ["exco.generated", "exco.sent"]), "the scheduler generating and sending in one save → both", gen.actions);
  const sent = after((db) => Object.assign(db.exco.briefs[0], { sentAt: "2026-09-02T08:00:00Z", sentTo: 3 }));
  ok(sameList(sent.actions, ["exco.sent"]) && /to 3 recipients/.test(sent.events[0].summary), "sending a brief → exco.sent", sent.events.map((e) => e.summary));
  const who = after((db) => db.exco.recipientList.push({ id: "x2", name: "ED Ops", email: "ed@x.com" }));
  ok(sameList(who.actions, ["settings.exco_recipients_updated"]) && /added ED Ops <ed@x\.com>/.test(who.events[0].summary), "a new brief recipient → named with their e-mail", who.events.map((e) => e.summary));
}

console.log("\n== Volume ==");
{
  const bulk = after((db) => {
    for (let i = 0; i < 12; i++) db.audits[0].reports[1].observations.push({ id: "imp" + i, title: "Imported " + i, obsApproval: "approved" });
  });
  ok(sameList(bulk.actions, ["obs.raised"]) && bulk.events[0].metadata.count === 12, "12 observations in one save → one entry listing them", bulk.actions);
  const few = after((db) => {
    for (let i = 0; i < 3; i++) db.audits[0].reports[1].observations.push({ id: "imp" + i, title: "Imported " + i, obsApproval: "approved" });
  });
  ok(few.events.length === 3, "…while a handful stay individual");

  // 200 distinct entries of a kind that does not collapse: 149 are kept, the 150th counts the rest.
  const flood = after((db) => {
    for (let i = 0; i < 200; i++) db.departments.push({ id: "dx" + i, name: "Dept " + i });
  });
  const last = flood.events[flood.events.length - 1];
  ok(flood.events.length === 150 && last.action === "workspace.changes_truncated", "a migration-sized save is capped at 150 entries", flood.events.length);
  ok(last.metadata.count === 51 && last.summary.includes("51 more changes"), "…the last one saying how many were left out", last.summary);
}

console.log("\n== Stamps and notes that move without their step are seen ==");
{
  const closed = clone(base());
  Object.assign(obs(closed, "o1"), { status: "Closed", headVerifiedAt: "2026-09-22", headVerifiedByName: "Awa", reportVerifiedByName: "Sade" });
  const rewritten = after((db) => Object.assign(obs(db, "o1"), { raisedBy: "own1", raisedByName: "Ola", headVerifiedByName: "Ola", reportVerifiedByName: "Ola" }), closed);
  ok(sameList(rewritten.actions, ["obs.edited"]), "rewriting who raised / verified / signed off a closed finding → obs.edited", rewritten.actions);
  ok(/raised by/.test(rewritten.events[0]?.summary || "") && /signed off by/.test(rewritten.events[0]?.summary || ""), "…naming each rewritten stamp", rewritten.events[0]?.summary);

  const w = clone(base());
  obs(w, "o1").withdrawal = { stage: "owner_requested", ownerReason: "Duplicate" };
  const note = after((db) => (obs(db, "o1").withdrawal.ownerReason = "Duplicate of 1.2, see memo"), w);
  ok(sameList(note.actions, ["obs.edited"]) && /withdrawal request/.test(note.events[0].summary), "editing a withdrawal reason within its stage → obs.edited", note.events.map((e) => e.summary));

  const asked = clone(base());
  Object.assign(obs(asked, "o1"), { updateRequestedAt: "2026-09-20T09:00:00Z", updateRequestedBy: "staff1" });
  const again = after((db) => Object.assign(obs(db, "o1"), { updateRequestedAt: "2026-09-26T09:00:00Z" }), asked);
  ok(sameList(again.actions, ["obs.owner_update_requested"]), "asking again while a request is outstanding → a new request, not an edit", again.actions);
  const replied = after((db) => {
    Object.assign(obs(db, "o1"), { updateRequestedAt: "", updateRequestedBy: "" });
    obs(db, "o1").updates.push({ id: "c9", by: "own1", text: "Update: 80% done" });
  }, asked);
  ok(sameList(replied.actions, ["obs.update"]), "the owner's reply clearing the request → just the comment", replied.actions);

  const failed = after((db) => Object.assign(db.exco.briefs[0], { sentAt: "2026-09-02T08:00:00Z", sentTo: 3, delivered: false }));
  ok(sameList(failed.actions, ["exco.sent"]) && /Tried to send/.test(failed.events[0].summary), "a brief whose e-mail failed reads as an attempt, not a send", failed.events.map((e) => e.summary));
}

console.log("\n== Hostile documents never silence the trail ==");
{
  const noThrow = (label: string, edit: (db: any) => void, from: any = base()) => {
    let r: { events: any[]; actions: string[] } | null = null;
    let err = "";
    try {
      r = after(edit, from);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    ok(!!r && r.events.every((e) => typeof e.action === "string" && typeof e.summary === "string" && !e.action.includes("undefined")), label, err || r?.actions);
    return r;
  };
  const trap = { toString: 0, valueOf: 0 };
  noThrow("an approval whose kind is an object", (db) => db.approvals.push({ id: "h1", kind: trap, status: "pending" }));
  const ctor = noThrow("an approval whose kind is \"constructor\"", (db) => db.approvals.push({ id: "h2", kind: "constructor", status: "pending" }));
  ok(!!ctor && sameList(ctor.actions, ["approval.requested"]), "…read as a request like any other", ctor?.actions);
  noThrow("a title that is an object, on an audit, report and fraud risk", (db) => {
    db.audits[0].name = trap;
    db.audits[0].reports[0].title = trap;
    db.fraudRisks[0].scheme = trap;
  });
  const vo = noThrow("an observation with its own \"valueOf\" key", (db) => (obs(db, "o1").valueOf = "x"));
  ok(!!vo && sameList(vo.actions, ["obs.edited"]), "…reported as an edit", vo?.actions);
  noThrow("a comment whose text is an object", (db) => obs(db, "o1").updates.push({ id: "c1", text: trap }));
  noThrow("a test with a \"toString\" field", (db) => (db.audits[0].plan.tests[0].toString = "x"));
  const st = noThrow("a withdrawal stage named \"toString\"", (db) => (obs(db, "o1").withdrawal = { stage: "toString" }));
  ok(!!st && sameList(st.actions, ["obs.edited"]) && /withdrawal stage/.test(st.events[0].summary), "…reported as an unknown stage, not obs.undefined", st?.events.map((e) => e.summary));
  noThrow("a brief with an object recipient count", (db) => Object.assign(db.exco.briefs[0], { sentAt: "2026-09-02", sentTo: trap }));
  noThrow("plan years that are not a list", (db) => (db.planYears = "2026"));
  noThrow("arrays nested 3000 deep", (db) => {
    let deep: any = [];
    for (let i = 0; i < 3000; i++) deep = [deep];
    obs(db, "o1").attachments = deep;
  });

  // The net: a section that fails outright still leaves a visible entry, and the rest is recorded.
  const b = base();
  const a = clone(base());
  obs(a, "o2").criticality = "Critical";
  Object.defineProperty(a.fraudRisks[0], "scheme", { get() { throw new Error("boom"); }, enumerable: true });
  a.fraudRisks[0].likelihood = 5;
  let net: any[] = [];
  try {
    net = describeWorkspaceChanges(b, a);
  } catch {
    net = [];
  }
  ok(acts(net).includes("obs.edited") && acts(net).includes("security.changes_unreadable"), "a section that throws → its failure is recorded and the other sections still are", acts(net));

  // Seeded fuzz: random hostile mutations of the fixture, none may throw or emit a malformed entry.
  let seed = 20260926;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const weird = () => pick<unknown>([null, 0, -1, "", "x", true, [], {}, [null], { toString: 0 }, { valueOf: 0 }, "toString", "constructor", "__proto__", [[[]]], { stage: "withdrawn" }]);
  const nodes = (x: any, out: any[] = []): any[] => {
    if (x && typeof x === "object") { out.push(x); for (const v of Object.values(x)) nodes(v, out); }
    return out;
  };
  let bad = "";
  for (let i = 0; i < 1500 && !bad; i++) {
    const before = base();
    const afterDoc = clone(before);
    for (let k = 0; k < 3; k++) {
      const target = pick(nodes(afterDoc));
      const keys = Array.isArray(target) ? [String(Math.floor(rnd() * (target.length + 1)))] : [...Object.keys(target), "toString", "valueOf", "status", "title", "kind", "stage"];
      target[pick(keys)] = weird();
    }
    try {
      const es = describeWorkspaceChanges(rnd() < 0.5 ? before : afterDoc, rnd() < 0.5 ? afterDoc : before);
      const broken = es.find((e) => typeof e.action !== "string" || typeof e.summary !== "string" || e.action.includes("undefined") || e.summary.includes("[object Object]"));
      if (broken) bad = `iteration ${i}: ${JSON.stringify(broken).slice(0, 200)}`;
    } catch (e) {
      bad = `iteration ${i}: threw ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  ok(!bad, "1,500 randomly corrupted documents: nothing throws, no malformed entry", bad);
}

console.log("\n== Whole saves: unchanged saves record nothing, for every role ==");
{
  const stored = base();
  for (const who of [HEAD, STAFF, OWNER1, OWNER2, EXEC, ADMIN, ADMIN_AS_OWNER]) {
    const r = save(stored, who);
    ok(r.events.length === 0, `an unchanged ${who.role}${who.activeRole ? " as " + who.activeRole : ""} save records nothing`, r.actions);
  }
}

console.log("\n== Whole saves: the trail is what persisted ==");
{
  const responded = save(base(), OWNER1, (doc) => {
    const o = obs(doc, "o1");
    Object.assign(o, { ownerRectifiedAt: "2026-09-20T10:00:00Z", ownerRectifiedBy: "own1", ownerRectifiedByName: "Ola", ownerResponse: "Revoked" });
  });
  ok(sameList(responded.actions, ["obs.ready_for_closure"]), "an owner's response through the real path → obs.ready_for_closure (the server-derived status is folded in)", responded.actions);

  const forbidden = save(base(), OWNER1, (doc) => (obs(doc, "o1").criticality = "Low"));
  ok(forbidden.events.length === 0, "an owner's edit the server reverted is NOT recorded as made", forbidden.actions);

  const closeAttempt = save(base(), OWNER1, (doc) => (obs(doc, "o1").status = "Closed"));
  ok(closeAttempt.events.length === 0, "…nor an owner writing Closed directly", closeAttempt.actions);

  const headDel = save(base(), HEAD, (doc) => (doc.audits[0].reports[0].observations = doc.audits[0].reports[0].observations.filter((o: any) => o.id !== "o2")));
  ok(sameList(headDel.actions, ["obs.deleted"]), "a delete — now a soft-delete in storage — still reads as a deletion", headDel.actions);
  const tomb = obs(headDel.payload, "o2");
  ok(!!tomb.deletedAt && tomb.deletedBy === "head1", "…and the record is kept, stamped with who removed it");
  const again = save(headDel.payload, HEAD);
  ok(again.events.length === 0, "an unchanged save after it records nothing (the deleted record is not news twice)", again.actions);
  const ownerAgain = save(headDel.payload, OWNER2);
  ok(ownerAgain.events.length === 0, "…nor for a scoped owner whose record it was", ownerAgain.actions);
}

console.log("\n== Real document (local snapshots, if present) ==");
{
  const dir = path.join(process.cwd(), "scripts", ".snapshots");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) console.log("  (no snapshots under scripts/.snapshots — skipped; they hold production data and are not in git)");
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const stored = j && Array.isArray(j.audits) ? j : j?.workspace?.data ?? j?.workspace ?? j?.data;
    if (!stored || !Array.isArray(stored.audits)) continue;
    const owners: Who[] = (stored.departments || [])
      .filter((d: any) => d.headUserId && d.name)
      .map((d: any) => ({ id: d.headUserId, role: "action_owner", department: d.name }));
    const people: Who[] = [HEAD, STAFF, EXEC, ...owners];
    const noisy = people
      .map((who) => ({ who: `${who.role}:${who.id}`, events: save(stored, who).events }))
      .filter((r) => r.events.length);
    ok(!noisy.length, `${f}: unchanged saves by ${people.length} people record nothing`, noisy.slice(0, 3).map((n) => [n.who, n.events.slice(0, 3).map((e: any) => e.summary)]));

    // …and a real change on the real document is still caught, as exactly one entry.
    const first = stored.audits.flatMap((a: any) => a.reports || []).flatMap((r: any) => r.observations || [])[0];
    if (first) {
      const edited = save(stored, HEAD, (doc) => {
        for (const a of doc.audits) for (const r of a.reports || []) for (const o of r.observations || []) {
          if (o.id === first.id) o.criticality = o.criticality === "Critical" ? "Low" : "Critical";
        }
      });
      ok(sameList(edited.actions, ["obs.edited"]), `${f}: the Head changing one criticality → one obs.edited`, edited.actions);
    }
  }
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
