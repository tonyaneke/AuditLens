/* eslint-disable @typescript-eslint/no-explicit-any --
   Fixtures are hand-built database states, edited in place the way the app edits them. */

// Tests for change-only backups — lib/backup-delta.ts (what changed, and replaying it) and the
// packaging in lib/backup.ts (full and change-only ZIPs, read back, chains rebuilt).
// Run with: npm test   (or: npx tsx scripts/backup-delta.test.mts)
//
// The promise under test: a full backup plus the change files after it rebuild the database
// EXACTLY — every table, every row, the workspace document key for key and in order — and a
// change file carries only what changed.
import { applyDelta, diffState, indexOf, type DbState } from "../lib/backup-delta";
import { packChanges, packFull, parseBackup, reconstruct, type BackupParent } from "../lib/backup";
import { createZip, readZip } from "../lib/zip";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string, detail?: unknown) {
  if (cond) { pass++; console.log("  ok " + msg); }
  else { fail++; console.error("  x FAIL: " + msg + (detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 400) : "")); }
}
function throws(fn: () => unknown, msg: string) {
  try { fn(); ok(false, msg, "did not throw"); } catch { ok(true, msg); }
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const roll = (base: DbState, next: DbState) => applyDelta(base, diffState(indexOf(base), next).delta);

// Prose that compresses like real findings do — repeated filler would make every ZIP tiny and
// the size comparison meaningless.
let seed = 7;
const WORDS = ["control", "vendor", "approval", "loan", "review", "policy", "monthly", "access", "risk", "board", "evidence", "ledger", "limit", "exception", "reconciliation", "segregation"];
const prose = (n: number) => Array.from({ length: n }, () => WORDS[(seed = (seed * 1103515245 + 12345) % 2147483648) % WORDS.length] + (seed % 97)).join(" ");

function audit(id: string, obs = 3): any {
  return {
    id, name: `Audit ${id}`, area: "Credit", period: "Q3 2026",
    reports: [{ id: `${id}-r1`, title: "Report", status: "Draft",
      observations: Array.from({ length: obs }, (_, i) => ({ id: `${id}-o${i}`, title: `Finding ${i}`, status: "Open", criticality: "High", description: prose(60) })) }],
  };
}

function base(): DbState {
  return {
    tables: {
      AdminCredential: { columns: ["id", "hash"], rows: [{ id: "c1", hash: "abc" }] },
      AuditLog: {
        columns: ["id", "createdAt", "action", "summary"],
        rows: [
          { id: "l1", createdAt: "2026-10-14T08:00:00.000Z", action: "a", summary: "one" },
          { id: "l2", createdAt: "2026-10-15T07:55:00.000Z", action: "b", summary: "two" },
          { id: "l3", createdAt: "2026-10-15T08:00:00.000Z", action: "c", summary: "three" },
        ],
      },
      User: {
        columns: ["id", "name", "role", "createdAt"],
        rows: [
          { id: "u1", name: "Awa", role: "head_of_audit", createdAt: "2026-07-01T00:00:00.000Z" },
          { id: "u2", name: "Imoh", role: "action_owner", createdAt: "2026-07-02T00:00:00.000Z" },
        ],
      },
      UserDraft: { columns: ["id", "userId", "body"], rows: [] },
      Settings: { columns: ["key", "value"], rows: [{ key: "theme", value: "light" }] },
      WorkspaceData: {
        columns: ["id", "data", "updatedAt"],
        rows: [{
          id: "default",
          data: {
            org: "CREDICORP",
            audits: [audit("a1"), audit("a2"), audit("a3")],
            notifications: [{ id: "n1", text: "hello" }, { id: "n2", text: "there" }],
            numericIds: [{ id: 10, v: "ten" }, { id: 2, v: "two" }, { id: "1", v: "one" }],
            exco: { subject: "", lastSentAt: "2026-10-15T08:27:11.956Z" },
            emptyList: [],
            strings: ["a", "b"],
          },
          updatedAt: "2026-10-15T09:00:00.000Z",
        }],
      },
    },
  };
}

const doc = (s: DbState) => (s.tables.WorkspaceData.rows[0] as any).data;

console.log("\n== nothing changed ==");
{
  const s = base();
  const { delta, empty } = diffState(indexOf(s), clone(s));
  ok(empty && !Object.keys(delta.tables).length, "an unchanged database is an empty change", delta);
}

console.log("\n== one observation changed ==");
{
  const a = base();
  const b = clone(a);
  doc(b).audits[1].reports[0].observations[2].status = "Closed";
  (b.tables.WorkspaceData.rows[0] as any).updatedAt = "2026-10-15T10:00:00.000Z";
  const { delta } = diffState(indexOf(a), b);
  const w = delta.tables.WorkspaceData as any;
  ok(Object.keys(delta.tables).join() === "WorkspaceData", "only the workspace table is in the change", Object.keys(delta.tables));
  ok(Object.keys(w.keys).join() === "audits" && w.keys.audits.items.length === 1 && w.keys.audits.items[0].id === "a2",
    "…only the one audit that changed is carried, not all of them", w.keys);
  ok(same(applyDelta(a, delta), b), "…and replaying it rebuilds the database exactly");
}

console.log("\n== everything at once ==");
{
  const a = base();
  const b = clone(a);
  const d = doc(b);
  d.audits.splice(0, 1);                                   // audit deleted
  d.audits.push(audit("a4", 5));                           // audit added
  d.audits[0].name = "Renamed";                            // audit edited
  [d.notifications[0], d.notifications[1]] = [d.notifications[1], d.notifications[0]]; // reordered only
  d.numericIds.push({ id: 7, v: "seven" });                // numeric-looking ids keep their order
  d.exco.subject = "Brief";                                // a value key changed
  d.newKey = { added: true };                              // key added
  delete d.strings;                                        // key removed
  d.emptyList = [{ id: "e1" }];                            // empty list became records
  b.tables.User.rows[1].role = "admin";                    // user edited
  b.tables.User.rows.push({ id: "u3", name: "Opeyemi", role: "action_owner", createdAt: "2026-10-15T09:00:00.000Z" });
  b.tables.AdminCredential.rows = [];                      // row deleted
  b.tables.Settings.rows[0].value = "dark";                // table without ids
  b.tables.AuditLog.rows.push({ id: "l4", createdAt: "2026-10-15T09:30:00.000Z", action: "d", summary: "four" });
  b.tables.NewTable = { columns: ["id", "x"], rows: [{ id: "t1", x: 1 }] };
  delete (b.tables as any).UserDraft;                      // table dropped
  const { delta, empty } = diffState(indexOf(a), b);
  ok(!empty, "a change is not empty");
  ok(same(applyDelta(a, delta), b), "every kind of change at once rebuilds exactly", { got: applyDelta(a, delta), want: b });
  ok((delta.tables.AuditLog as any).rows.length === 1, "…the audit trail carries only the new entry", delta.tables.AuditLog);
  ok((delta.tables.User as any).rows.length === 2, "…users carry only the edited and the new one", delta.tables.User);
  ok(!(delta.tables.WorkspaceData as any).keys.notifications.items.length, "…a reorder carries the order, not the records");
}

console.log("\n== the audit trail: an entry that committed late ==");
{
  const a = base();
  const b = clone(a);
  // Written at 07:58 but committed after the last backup read the table: older than the newest
  // entry the backup saw (08:00), within the overlap, and not among the ids it saw.
  b.tables.AuditLog.rows.splice(2, 0, { id: "late", createdAt: "2026-10-15T07:58:00.000Z", action: "x", summary: "late" });
  const { delta } = diffState(indexOf(a), b);
  ok(same((delta.tables.AuditLog as any)?.rows.map((r: any) => r.id), ["late"]), "a late-committing entry is caught, nothing else re-sent", delta.tables.AuditLog);
  ok(same(applyDelta(a, delta), b), "…and lands in createdAt order");
}

console.log("\n== a week of change files ==");
{
  let s = base();
  const states = [clone(s)];
  for (let day = 1; day <= 6; day++) {
    s = clone(s);
    doc(s).audits[day % 3].reports[0].observations[0].title = `edited on day ${day}`;
    doc(s).notifications.push({ id: `n-day${day}`, text: `day ${day}` });
    s.tables.AuditLog.rows.push({ id: `l-day${day}`, createdAt: `2026-10-${15 + day}T08:00:00.000Z`, action: "e", summary: `day ${day}` });
    states.push(clone(s));
  }
  let rebuilt = states[0];
  for (let i = 1; i < states.length; i++) rebuilt = roll(rebuilt, states[i]);
  ok(same(rebuilt, states[states.length - 1]), "six days of changes on a full backup rebuild the last day exactly");
}

console.log("\n== a change replayed on the wrong backup ==");
{
  const a = base();
  const b = clone(a);
  doc(b).audits.push(audit("a9"));
  const { delta } = diffState(indexOf(a), b);
  const wrong = clone(a);
  doc(wrong).audits = [audit("zz")];
  throws(() => applyDelta(wrong, delta), "a change file that does not fit the backup before it is refused, not half-applied");
}

console.log("\n== packaged as ZIPs ==");
const t0 = new Date("2026-10-11T01:00:00.000Z");
const t1 = new Date("2026-10-12T01:00:00.000Z");
const t2 = new Date("2026-10-13T01:00:00.000Z");
{
  const a = base();
  const full = packFull(a, ["User.passwordHash"], "test", t0);
  const pf = parseBackup(full.zip);
  ok(full.fileName === "auditlens-backup-2026-10-11-010000.zip" && full.manifest.kind === "full", "a full backup keeps its name and says it is full");
  ok(same(pf.state, a), "a full backup reads back exactly");
  ok(same(pf.index, indexOf(a)), "…with the fingerprints the next change is compared against");

  const parentOf = (name: string, zip: Buffer): BackupParent => {
    const p = parseBackup(zip);
    return { name, manifest: p.manifest, index: p.index };
  };
  ok(packChanges(a, [], "test", parentOf(full.fileName, full.zip), t1) === null, "no change since the last backup → no change file");

  const b = clone(a);
  doc(b).audits[2].reports[0].observations[0].status = "Closed";
  const c1 = packChanges(b, [], "test", parentOf(full.fileName, full.zip), t1)!;
  const c = clone(b);
  doc(c).audits.push(audit("a5"));
  c.tables.User.rows.push({ id: "u9", name: "New", role: "action_owner", createdAt: "2026-10-12T12:00:00.000Z" });
  const c2 = packChanges(c, [], "test", parentOf(c1.fileName, c1.zip), t2)!;
  ok(c1.fileName.endsWith("-changes.zip") && c1.manifest.kind === "changes", "a change file is named and marked as one");
  ok(c2.manifest.parent === c1.fileName && c2.manifest.base === full.fileName && c2.manifest.chainDepth === 2,
    "…and names the backup before it and the full one its chain starts from", c2.manifest);
  ok(!readZip(c1.zip).has("tables/WorkspaceData.json"), "…and does not carry the whole workspace again");

  // Size, at a realistic volume (the fixture above is tiny, so a change file's fixed README and
  // manifest would outweigh it): 40 audits of 10 observations, one observation closed.
  const big = base();
  doc(big).audits = Array.from({ length: 40 }, (_, i) => audit(`b${i}`, 10));
  const bigFull = packFull(big, [], "test", t0);
  const bigNext = clone(big);
  doc(bigNext).audits[7].reports[0].observations[3].status = "Closed";
  const bigChange = packChanges(bigNext, [], "test", parentOf(bigFull.fileName, bigFull.zip), t1)!;
  ok(bigChange.zip.length < bigFull.zip.length / 4,
    `…and is a fraction of a full backup (${bigChange.zip.length} vs ${bigFull.zip.length} bytes)`);

  const store = new Map([[full.fileName, full.zip], [c1.fileName, c1.zip], [c2.fileName, c2.zip]]);
  const load = async (n: string) => store.get(n) ?? Promise.reject(new Error(`no ${n}`));
  const r2 = await reconstruct(c2.fileName, load);
  ok(same(r2.state, c), "full + two change files rebuild the database exactly", { got: r2.state.tables.User, want: c.tables.User });
  ok(same(r2.chain, [full.fileName, c1.fileName, c2.fileName]), "…through the chain in order", r2.chain);
  const r1 = await reconstruct(c1.fileName, load);
  ok(same(r1.state, (() => { const x = clone(a); doc(x).audits[2].reports[0].observations[0].status = "Closed"; return x; })()),
    "an earlier point in the chain can be restored too");

  store.delete(c1.fileName);
  let broke = false;
  try { await reconstruct(c2.fileName, load); } catch { broke = true; }
  ok(broke, "a missing link in the chain fails loudly rather than restoring something wrong");

  // A backup made before index.json existed: the next change is still worked out from it.
  const files = readZip(full.zip);
  const old = createZip([...files].filter(([n]) => n !== "index.json").map(([name, data]) => ({ name, data })), t0);
  const po = parseBackup(old);
  ok(same(po.index, indexOf(a)), "an older full backup without fingerprints still serves as a starting point");
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
