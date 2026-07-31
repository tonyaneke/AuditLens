/* SEC-01 verification — run a real workspace document through the scoping and write paths.
 *
 *   npx tsx scripts/verify-scope.mts                       (live database)
 *   npx tsx scripts/verify-scope.mts --file=<snapshot.json> (offline, e.g. in CI)
 *
 * READ-ONLY. Never writes. Reports, for every action owner in the document:
 *   - the size of the payload GET /api/data would now send them
 *   - what they can still see
 *   - whether feeding that scoped payload straight back through authorizeWorkspaceWrite()
 *     produces any violations (it must not) or loses any record (it must not)
 *
 * The fixture tests in scripts/workspace-authz.test.mts prove the rules. This proves them against
 * production shapes and volumes — the case the fixtures cannot cover.
 */

import fs from "node:fs";
import { getPrisma, loadEnv, readWorkspace, heading, table, type Workspace } from "./_migration.mjs";
import { authorizeWorkspaceWrite } from "../lib/workspace-authz";
import { slimForClient } from "../lib/workspace-payload";
import { type Viewer } from "../lib/workspace-scope";

type Subject = { id: string; name: string; role: string };
type Node = Record<string, unknown>;

/** The stored document is untyped JSON; walk it structurally rather than pretending otherwise. */
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);

const kb = (v: unknown) => `${(JSON.stringify(v).length / 1024).toFixed(1)} KB`;

function countObs(db: Workspace): number {
  let n = 0;
  for (const a of arr(db.audits)) {
    for (const r of arr(a.reports)) n += arr(r.observations).length;
  }
  return n;
}

function allIds(db: Workspace): Set<string> {
  const ids = new Set<string>();
  for (const a of arr(db.audits)) {
    ids.add(`audit:${a.id}`);
    for (const r of arr(a.reports)) {
      ids.add(`report:${r.id}`);
      for (const o of arr(r.observations)) ids.add(`obs:${o.id}`);
    }
  }
  for (const f of arr(db.extFindings)) ids.add(`ext:${f.id}`);
  for (const f of arr(db.fraudRisks)) ids.add(`fraud:${f.id}`);
  for (const a of arr(db.approvals)) ids.add(`approval:${a.id}`);
  return ids;
}

/** Every user id the document assigns work to — the action-owner population, derived from the
 *  data itself so this runs without a database. */
function ownersInDocument(db: Workspace): Subject[] {
  const byId = new Map<string, string>();
  const note = (id: unknown, name: unknown) => {
    if (typeof id === "string" && id) byId.set(id, String(name || id));
  };
  for (const a of arr(db.audits)) {
    for (const r of arr(a.reports)) {
      for (const o of arr(r.observations)) {
        note(o.ownerUserId, o.owner);
        note(o.secondaryOwnerUserId, o.secondaryOwner);
      }
    }
  }
  for (const f of arr(db.extFindings)) {
    note(f.ownerUserId, f.owner);
    note(f.secondaryOwnerUserId, f.secondaryOwner);
  }
  for (const f of arr(db.fraudRisks)) {
    note(f.ownerUserId, f.owner);
    for (const act of arr(f.actions)) note(act.ownerUserId, act.owner);
  }
  return [...byId].map(([id, name]) => ({ id, name, role: "action_owner" }));
}

async function main() {
  loadEnv();
  const fileArg = process.argv.slice(2).find((a) => a.startsWith("--file="));

  let db: Workspace;
  let users: Subject[];

  if (fileArg) {
    const path = fileArg.slice("--file=".length);
    db = JSON.parse(fs.readFileSync(path, "utf8")) as Workspace;
    users = ownersInDocument(db);
    console.log(`\nSource: ${path} (offline)`);
  } else {
    const prisma = await getPrisma();
    db = await readWorkspace();
    users = await prisma.user.findMany({
      where: { active: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true },
    });
    console.log(`\nSource: live database`);
  }

  if (!users.length) {
    console.log("\nNo users to check.");
    return;
  }

  heading("SEC-01 — payload delivered by GET /api/data, per user");
  console.log(
    `\n  Stored document: ${kb(db)}, ${countObs(db)} observations, ` +
      `${arr(db.extFindings).length} external findings, ` +
      `${arr(db.fraudRisks).length} fraud risks\n`,
  );

  const storedIds = allIds(db);
  const rows: Record<string, string>[] = [];
  let failures = 0;

  for (const u of users) {
    /* The scope is decided by effectiveRole(), not the stored role: an `admin` who has not picked
       a view acts as Head of Audit. activeRole lives only in the JWT, so this script cannot know
       which view an admin is currently in — it reports the WIDEST scope they can hold, which is
       the one worth checking. Both roles are shown so an admin is never mistaken for a head. */
    const role = u.role === "admin" ? "head_of_audit" : u.role;
    const viewer: Viewer = { id: u.id, role };
    // The exact payload GET /api/data builds — scope + SOP/notification/brief-token trims.
    const served = slimForClient(db as never, viewer) as Workspace;

    // Feed the scoped payload straight back, as an untouched client save would.
    const roundTrip = authorizeWorkspaceWrite(
      u.role,
      u.id,
      db as never,
      JSON.parse(JSON.stringify(served)) as never,
      undefined,
    );
    const afterIds = allIds(roundTrip.data as Workspace);
    const lost = [...storedIds].filter((id) => !afterIds.has(id));

    if (roundTrip.violations.length || lost.length) failures++;

    rows.push({
      user: u.name,
      "db role": u.role,
      "scoped as": u.role === "admin" ? `${role} (widest)` : role,
      payload: kb(served),
      obs: String(countObs(served)),
      ext: String(arr(served.extFindings).length),
      fraud: String(arr(served.fraudRisks).length),
      violations: roundTrip.violations.length ? `!! ${roundTrip.violations.length}` : "0",
      "records lost": lost.length ? `!! ${lost.length}` : "0",
    });
  }

  table(rows, { user: 26 });

  console.log("");
  if (failures) {
    console.log(
      `FAILED — ${failures} user(s) produced violations or lost records on an untouched round trip.\n` +
        `A scoped GET and the write reconciler disagree; check lib/workspace-scope.ts.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "OK — every user's scoped payload round-trips with zero violations and zero record loss.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    // Only opened when running against the live database.
    if (process.argv.some((a) => a.startsWith("--file="))) return;
    const prisma = await getPrisma();
    await prisma.$disconnect();
  });
