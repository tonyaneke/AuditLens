// Put the workspace document back from a backup — the undo for a migration.
//
// Takes a backup made by Settings → Back up now (or by a migration just before it wrote) straight
// from SharePoint, a downloaded copy of one, or a snapshot JSON from scripts/.snapshots/.
//
// Restores the workspace document only: every audit, report, observation (with its responses,
// comments and closure details), external finding, fraud risk, approval and setting. User accounts
// and the audit trail are never overwritten — the trail is append-only by design, and accounts move
// on their own (sign-ins, activations) in ways a restore must not roll back.
//
//   npx tsx scripts/restore-workspace.mts --sharepoint latest                        (dry run)
//   npx tsx scripts/restore-workspace.mts --sharepoint auditlens-backup-2026-09-29-181502.zip --apply
//   npx tsx scripts/restore-workspace.mts C:\path\to\auditlens-backup-….zip --apply
//   npx tsx scripts/restore-workspace.mts scripts\.snapshots\renumber-obs-refs-….json --apply
//
// The current document is snapshotted to scripts/.snapshots/ before it is replaced, so a restore
// can be undone the same way.

import fs from "node:fs";
import { readZip } from "../lib/zip";
import {
  getPrisma,
  heading,
  parseArgs,
  readWorkspaceVersioned,
  section,
  table,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "restore-workspace";

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown) => String(v ?? "").trim();

type Source = { label: string; data: Workspace; takenAt?: string; takenBy?: string };

/** The workspace row out of a backup's tables/WorkspaceData.json (an array of rows), or a bare
 *  document as a snapshot stores it. */
function documentFrom(parsed: unknown, label: string): Workspace {
  if (Array.isArray(parsed)) {
    const row = (parsed as Obj[]).find((r) => r.id === "default");
    if (!row || !row.data || typeof row.data !== "object") throw new Error(`${label} has no workspace row.`);
    return row.data as Workspace;
  }
  if (parsed && typeof parsed === "object") return parsed as Workspace;
  throw new Error(`${label} is not a workspace document.`);
}

function fromZip(zip: Buffer, label: string): Source {
  const files = readZip(zip);
  const rows = files.get("tables/WorkspaceData.json");
  if (!rows) throw new Error(`${label} is not an AuditLens backup — it has no tables/WorkspaceData.json.`);
  const manifest = files.get("manifest.json");
  const m = manifest ? (JSON.parse(manifest.toString("utf8")) as Obj) : {};
  return {
    label,
    data: documentFrom(JSON.parse(rows.toString("utf8")), label),
    takenAt: str(m.createdAt),
    takenBy: str(m.createdBy),
  };
}

async function load(ctx: { argv: string[] }): Promise<Source> {
  const sp = ctx.argv.indexOf("--sharepoint");
  if (sp >= 0) {
    const name = ctx.argv[sp + 1];
    if (!name || name.startsWith("--")) throw new Error('Name the backup: --sharepoint <file name>, or --sharepoint latest.');
    await getPrisma(); // loads .env, which holds the SharePoint credentials too
    const { fetchSharePointBackup } = await import("../lib/sharepoint");
    const got = await fetchSharePointBackup(name);
    return fromZip(got.data, `SharePoint: AuditLens/Backups/${got.name}`);
  }
  const file = ctx.argv.find((a) => !a.startsWith("--"));
  if (!file) {
    throw new Error("Say what to restore: --sharepoint <name|latest>, or the path of a backup .zip or snapshot .json.");
  }
  const bytes = fs.readFileSync(file);
  if (/\.zip$/i.test(file)) return fromZip(bytes, file);
  return { label: file, data: documentFrom(JSON.parse(bytes.toString("utf8")), file) };
}

function counts(doc: Workspace) {
  const audits = arr(doc.audits);
  const reports = audits.flatMap((a) => arr(a.reports));
  const obs = reports.flatMap((r) => arr(r.observations));
  return {
    audits: audits.length,
    reports: reports.length,
    observations: obs.length,
    "closed observations": obs.filter((o) => o.status === "Closed").length,
    "external findings": arr(doc.extFindings).length,
    "fraud risks": arr(doc.fraudRisks).length,
    approvals: arr(doc.approvals).length,
    notifications: arr(doc.notifications).length,
  };
}

function obsById(doc: Workspace): Map<string, Obj> {
  const m = new Map<string, Obj>();
  for (const a of arr(doc.audits)) for (const r of arr(a.reports)) for (const o of arr(r.observations)) m.set(str(o.id), o);
  return m;
}

async function main() {
  const ctx = parseArgs();
  heading(`Restore the workspace document from a backup${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const src = await load(ctx);
  if (!Array.isArray(src.data.audits)) throw new Error(`${src.label} has no audits — refusing to restore it.`);
  const { data: current, updatedAt } = await readWorkspaceVersioned();

  console.log(`\n  From:    ${src.label}`);
  if (src.takenAt) console.log(`  Taken:   ${src.takenAt}${src.takenBy ? ` by ${src.takenBy}` : ""}`);
  console.log(`  Current: last saved ${updatedAt.toISOString()}`);

  const now = counts(current);
  const then = counts(src.data);
  section("What the workspace holds", Object.keys(now).length);
  table(
    Object.keys(now).map((k) => {
      const a = now[k as keyof typeof now];
      const b = then[k as keyof typeof then];
      return { record: k, now: String(a), "after restore": String(b), change: a === b ? "" : b > a ? `+${b - a}` : String(b - a) };
    }),
  );

  const curObs = obsById(current);
  const oldObs = obsById(src.data);
  const lost = [...curObs.values()].filter((o) => !oldObs.has(str(o.id)));
  const refChanges = [...curObs.values()]
    .filter((o) => oldObs.has(str(o.id)) && str(oldObs.get(str(o.id))!.ref) !== str(o.ref))
    .map((o) => ({ now: str(o.ref), "after restore": str(oldObs.get(str(o.id))!.ref), observation: str(o.title) }));

  if (lost.length) {
    section("Observations added since the backup — a restore REMOVES these", lost.length);
    table(lost.map((o) => ({ ref: str(o.ref), observation: str(o.title), raised: str(o.raisedAt || o.createdAt).slice(0, 10) })), { observation: 50 });
    console.log("\n  Note them down (or export the tracker) before applying — they would have to be raised again.");
  }
  if (refChanges.length) {
    section("References that change back", refChanges.length);
    table(refChanges.slice(0, 25), { observation: 50 });
    if (refChanges.length > 25) console.log(`  …and ${refChanges.length - 25} more.`);
  }

  const identical = JSON.stringify(current) === JSON.stringify(src.data);
  if (identical) console.log("\n  The workspace already matches this backup.");

  if (ctx.apply && !identical) {
    await writeWorkspace(current, src.data, NAME, { expectUpdatedAt: updatedAt });
    const { writeAuditLog } = await import("../lib/audit-log");
    await writeAuditLog({
      user: null,
      action: "data.workspace_restored",
      category: "data",
      summary: `Restored the workspace document from ${src.label}${src.takenAt ? ` (taken ${src.takenAt})` : ""}`,
      metadata: { script: NAME, source: src.label, takenAt: src.takenAt || null, observationsRemoved: lost.length },
    }).catch((e) => console.warn(`  (Audit-trail entry failed: ${e instanceof Error ? e.message : e})`));
    console.log("\n  Restored. Ask everyone to refresh AuditLens.");
  } else if (!identical) {
    console.log("\nDRY RUN — nothing written. To restore, run the same command again with --apply.");
  }
}

main()
  .catch((e) => {
    console.error("\nRestore failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
