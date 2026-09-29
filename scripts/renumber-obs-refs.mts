// Move every observation reference still on an old scheme to DEPT/YEAR/NNN.
//
// New raises have been numbered DEPT/YEAR/NNN since 2026-09-29 (nextObsRef in
// lib/workspace/obs-validation.ts). This brings the rest onto the same scheme: the 1.1 … 105.1
// counter from the go-live backlog, and the stray references raised before anything enforced one —
// test refs copied from the programme (T3) and ones the AI drafter made up (TPRM-2024-001).
//
// WHAT IT CHANGES  (the logic is in scripts/_renumber-refs.mts)
//   ref          → DEPT/YEAR/NNN, numbered per department per year in the order the findings were
//                  raised, oldest first. The old counter breaks ties, so the backlog — loaded with
//                  one date per report — keeps its workbook order.
//   legacyRef    ← the old reference, kept: reports and Board papers already issued cite it. The
//                  observation page shows it ("formerly 42.1"), every search matches it, and the
//                  tracker exports carry it as "Former ref".
//   repeatOf     → rewritten where it cites an old reference: "22.1", "[23.1]", "22.1 — title".
//   pending edit proposals → a stale `ref` in their changes is updated (approving one no longer
//                  applies a ref at all — components/approvals/decisions.tsx — this is for a
//                  browser still running the old code).
//
// WHAT IT LEAVES ALONE
//   references already in the new format — never renumbered, whenever they were issued. A lookalike
//                  is not one: the AI's "P2P/2024/001" has the shape but a code the scheme never
//                  issues and a year before it existed, so it is renumbered like any other stray.
//   deleted observations — hidden everywhere; numbering them would only leave gaps
//   external findings (EF-NNN), audit tests (T1 …), report references (IA/2026/NNN)
//   the audit trail and EXCO brief snapshots — they record what was true at the time
//
// SAFETY
//   --apply first saves a full database backup to SharePoint (the same file Settings → Back up now
//   makes) and a local snapshot, then writes only if nobody has saved since the document was read.
//   The old → new mapping is saved as a CSV beside the backup, and in the audit trail.
//
//   Idempotent: a second run finds nothing — except observations raised meanwhile from a browser
//   still running the old code, which it then picks up. Run the dry run again a day or so after.
//
//   npx tsx scripts/renumber-obs-refs.mts                       (dry run — writes nothing)
//   npx tsx scripts/renumber-obs-refs.mts --apply
//   npx tsx scripts/renumber-obs-refs.mts --apply --skip-sharepoint-backup
//                                        (only when you already hold a backup from Settings)
//   Undo: npx tsx scripts/restore-workspace.mts --sharepoint <backup name> --apply

import path from "node:path";
import { renumberObservationRefs, type Renumbered } from "./_renumber-refs.mjs";
import {
  getPrisma,
  heading,
  outcome,
  parseArgs,
  readWorkspaceVersioned,
  section,
  table,
  writeSnapshotFile,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "renumber-obs-refs";

const str = (v: unknown) => String(v ?? "").trim();

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function mappingCsv(items: Renumbered[]): string {
  const rows = [
    ["Old ref", "New ref", "Observation", "Audit", "Report", "Department", "Raised"],
    ...items.map((it) => [
      it.old || "(none)",
      it.next,
      str(it.o.title),
      it.audit,
      it.report,
      it.dept || "—",
      it.when.slice(0, 10),
    ]),
  ];
  // BOM so Excel reads it as UTF-8 (names and dashes survive), CRLF for Windows.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function main() {
  const ctx = parseArgs();
  const skipBackup = ctx.argv.includes("--skip-sharepoint-backup");
  heading(`Renumber observation references to DEPT/YEAR/NNN${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const { data: db, updatedAt } = await readWorkspaceVersioned();
  const before: Workspace = JSON.parse(JSON.stringify(db));
  const res = renumberObservationRefs(db);
  const list = res.renumbered;

  console.log(
    `\n  ${res.live} live observation(s): ${list.length} to renumber, ` +
      `${res.live - list.length} already in the new format (kept), ${res.deleted} deleted (left alone).`,
  );

  if (res.groups.length) {
    section("Numbering by department and year", res.groups.length);
    table(
      res.groups.map((g) => ({
        department: g.department,
        sequence: g.sequence,
        renumbered: String(g.count),
        range: `${g.first.slice(-3)}–${g.last.slice(-3)}`,
        "already new-format": g.alreadyIssued ? String(g.alreadyIssued) : "",
      })),
      { department: 34 },
    );
  }
  if (list.length) {
    section("References to renumber", list.length);
    table(
      list.map((it) => ({
        from: it.old || "(none)",
        to: it.next,
        observation: str(it.o.title),
        report: it.report,
        raised: it.when.slice(0, 10) || "—",
      })),
      { observation: 44, report: 30 },
    );
  }
  if (res.repeatOf.length) {
    section("Repeat-of links rewritten", res.repeatOf.length);
    table(res.repeatOf, { from: 40, to: 40 });
  }
  if (res.repeatOfKept.length) {
    section("Repeat-of text left as written (cites no old reference)", res.repeatOfKept.length);
    table(res.repeatOfKept, { text: 70 });
  }
  if (res.proposals.length) {
    section("Pending edit proposals updated", res.proposals.length);
    table(res.proposals, { observation: 40 });
  }
  const noDept = list.filter((it) => !it.dept);
  if (noDept.length) {
    section("No department found — numbered under GEN", noDept.length);
    table(noDept.map((it) => ({ from: it.old, to: it.next, observation: str(it.o.title) })), { observation: 50 });
    console.log("\n  Reassign these to their department's owner first if GEN is not wanted, then re-run.");
  }
  if (res.ambiguous.length) {
    section("Old references used by more than one observation", res.ambiguous.length);
    table(res.ambiguous.map((it) => ({ old: it.old, to: it.next, observation: str(it.o.title) })), { observation: 50 });
    console.log("\n  Each still gets its own new reference; a repeat-of citing one of these is left as written.");
  }

  const changes = list.length + res.repeatOf.length + res.proposals.length;

  if (ctx.apply && changes) {
    const prisma = await getPrisma();
    const { machineOperator, writeAuditLog } = await import("../lib/audit-log");
    const sp = await import("../lib/sharepoint");

    let backupName = "";
    if (!skipBackup) {
      if (!sp.sharepointConfigured()) {
        throw new Error(
          "SharePoint is not configured in .env (AZURE_AD_TENANT_ID / CLIENT_ID / CLIENT_SECRET), so the " +
            "pre-migration backup cannot be saved. Nothing was written. Take a backup from Settings → " +
            "Back up now, then re-run with --skip-sharepoint-backup.",
        );
      }
      const { buildBackup } = await import("../lib/backup");
      console.log("\n  Saving a full database backup to SharePoint first…");
      const backup = await buildBackup(prisma, `${machineOperator()}, before ${NAME}`);
      const saved = await sp.uploadBackupToSharePoint(backup.fileName, toArrayBuffer(backup.zip));
      backupName = saved.name;
      console.log(`  Backup saved: AuditLens/Backups/${saved.name} (${Math.round(saved.size / 1024)} KB)`);
    }

    await writeWorkspace(before, db, NAME, { expectUpdatedAt: updatedAt });

    const stamp = new Date().toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
    const csvName = `${NAME}-${stamp}-mapping.csv`;
    const csv = mappingCsv(list);
    console.log(`  Old → new mapping: ${path.relative(process.cwd(), writeSnapshotFile(csvName, csv))}`);
    if (!skipBackup) {
      await sp
        .uploadBackupToSharePoint(csvName, toArrayBuffer(Buffer.from(csv, "utf8")), "text/csv")
        .then(() => console.log(`  …and in SharePoint: AuditLens/Backups/${csvName}`))
        .catch((e) => console.warn(`  (Could not copy the mapping to SharePoint: ${e instanceof Error ? e.message : e})`));
    }

    await writeAuditLog({
      user: null,
      action: "obs.refs_renumbered",
      category: "workspace",
      summary:
        `Renumbered ${list.length} observation reference(s) to department/year/number` +
        (list[0] ? ` (e.g. ${list[0].old || "(none)"} → ${list[0].next})` : "") +
        `; each keeps its old reference as "formerly"`,
      metadata: {
        script: NAME,
        backup: backupName || null,
        mapping: list.map((it) => ({ id: str(it.o.id), from: it.old, to: it.next })),
        repeatOfRewritten: res.repeatOf.length,
        proposalsUpdated: res.proposals.length,
      },
    }).catch((e) => console.warn(`  (Audit-trail entry failed: ${e instanceof Error ? e.message : e})`));

    console.log(
      "\n  Ask everyone to refresh AuditLens. A page left open from before keeps its old copy until it" +
        "\n  refreshes (its next save is refused and reloads it), and a tab still running the old code can" +
        "\n  raise one more old-style reference — re-run the dry run tomorrow to catch any.",
    );
  }

  outcome(ctx, changes, NAME);
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
