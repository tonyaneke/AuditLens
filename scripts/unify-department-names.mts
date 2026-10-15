// One name per department across its action-owner records.
//
// Settings → "Add Action Owner" creates a department record per action owner, so a department
// with several owners has several records — that is intended: whoever the Head of Audit made an
// action owner stays one, and stays selectable. What is NOT intended is the same department under
// two names: Procurement had "Procurement Department" (Imoh Usoro, the head) and "Procurement"
// (Opeyemi Ayediran); Legal had "Legal Department" and "Legal". Every list that shows record names
// then shows the department twice. (User's call, 2026-10-15: one department, every owner kept.)
//
// This renames each live record to its department's roster spelling (DEPARTMENTS in
// components/settings/staff.ts — the list the Add Action Owner dialog offers, so new records already
// use it). Renaming is display only: normalizeDept() already treats every spelling as the same
// department, so nobody's access, ownership or notifications change. No record is removed and no
// login is touched. A record whose name matches no roster department is listed and left alone.
//
//   npx tsx scripts/unify-department-names.mts            (dry run)
//   npx tsx scripts/unify-department-names.mts --apply

import { DEPARTMENTS } from "../components/settings/staff";
import { normalizeDept } from "../lib/dept-scope";
import {
  getPrisma,
  heading,
  outcome,
  parseArgs,
  readWorkspaceVersioned,
  section,
  table,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "unify-department-names";

type Obj = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "");

async function main() {
  const ctx = parseArgs();
  heading(`One name per department${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const { data: db, updatedAt } = await readWorkspaceVersioned();
  const before: Workspace = JSON.parse(JSON.stringify(db));
  const records = (Array.isArray(db.departments) ? (db.departments as Obj[]) : []).filter((d) => !d.deletedAt);
  const roster = new Map(DEPARTMENTS.map((d) => [normalizeDept(d), d]));

  const renamed: Record<string, string>[] = [];
  const unmatched: Record<string, string>[] = [];

  for (const d of records) {
    const name = str(d.name);
    const target = roster.get(normalizeDept(name));
    if (!target) {
      unmatched.push({ record: name, owner: str(d.headName), id: str(d.id) });
      continue;
    }
    if (name === target) continue;
    renamed.push({ department: target, owner: str(d.headName), from: name });
    d.name = target;
  }

  renamed.sort((x, y) => x.department.localeCompare(y.department) || x.owner.localeCompare(y.owner));
  section("Action-owner records renamed to the roster spelling", renamed.length);
  table(renamed);
  if (unmatched.length) {
    section("Records matching no roster department — left as they are", unmatched.length);
    table(unmatched);
  }

  // Each department, as it will read afterwards: one name, every owner under it.
  const after = new Map<string, string[]>();
  for (const d of records) after.set(str(d.name), [...(after.get(str(d.name)) || []), str(d.headName)]);
  section("Departments afterwards", after.size);
  table([...after].sort(([a], [b]) => a.localeCompare(b)).map(([department, owners]) => ({ department, owners: owners.join(", ") })), {
    owners: 80,
  });

  const changes = renamed.length;

  if (ctx.apply && changes) {
    await getPrisma();
    const { writeAuditLog } = await import("../lib/audit-log");
    await writeWorkspace(before, db, NAME, { expectUpdatedAt: updatedAt });
    await writeAuditLog({
      user: null,
      action: "department.names_unified",
      category: "workspace",
      summary:
        `Gave every department one name across its action-owner records (${renamed.length} renamed, ` +
        `e.g. ${renamed.slice(0, 3).map((r) => `"${r.from}" → "${r.department}"`).join(", ")}); no owner removed`,
      metadata: { script: NAME, renamed },
    }).catch((e) => console.warn(`  (Audit-trail entry failed: ${e instanceof Error ? e.message : e})`));
    console.log("\n  Ask anyone with AuditLens open to refresh.");
  }

  outcome(ctx, changes, NAME);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
