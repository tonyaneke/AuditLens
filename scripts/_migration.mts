// Shared plumbing for the QA data-remediation migrations.
//
// Every migration in this directory follows the same contract:
//   npx tsx scripts/<name>.mts           → DRY RUN. Prints a report. Writes nothing.
//   npx tsx scripts/<name>.mts --apply   → writes the workspace document back.
//
// They are idempotent: re-running after --apply must report zero remaining changes. Before any
// write, --apply drops a timestamped snapshot of the whole workspace document under
// scripts/.snapshots/ so a migration can always be reversed by hand.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = path.join(ROOT, "scripts", ".snapshots");

export const WORKSPACE_ID = "default";

/** Load .env.local / .env into process.env.
 *
 * A bare `tsx` script gets none of Next's env loading, and DATABASE_URL lives in .env — without
 * this every migration fails at connect with a confusing Prisma protocol error. Existing env
 * vars always win, so `DATABASE_URL=... npx tsx ...` still targets whatever you point it at. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

/** lib/prisma.ts reads DATABASE_URL at module-evaluation time, so the env has to be in place
 * before it is imported — hence the dynamic import rather than a top-level one. */
export async function getPrisma() {
  loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env, or run with DATABASE_URL=... npx tsx scripts/<name>.mts",
    );
  }
  const mod = await import("../lib/prisma");
  return mod.prisma;
}

export type Ctx = {
  apply: boolean;
  /** Extra positional/flag args, e.g. --limit=10 */
  argv: string[];
};

export function parseArgs(): Ctx {
  const argv = process.argv.slice(2);
  return { apply: argv.includes("--apply"), argv };
}

/* ------------------------------------------------------------------ workspace read / write */

export type Workspace = Record<string, unknown>;

export async function readWorkspace(): Promise<Workspace> {
  const prisma = await getPrisma();
  const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  if (!row) throw new Error(`No WorkspaceData row with id="${WORKSPACE_ID}" — is this the right database?`);
  return row.data as Workspace;
}

function snapshot(data: Workspace, name: string): string {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(SNAPSHOT_DIR, `${name}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

/** Write the document back, snapshotting the PRE-migration state first. */
export async function writeWorkspace(
  before: Workspace,
  after: Workspace,
  migrationName: string,
): Promise<void> {
  const file = snapshot(before, migrationName);
  console.log(`\n  Snapshot of pre-migration state: ${path.relative(ROOT, file)}`);
  const prisma = await getPrisma();
  await prisma.workspaceData.update({
    where: { id: WORKSPACE_ID },
    data: { data: after as never },
  });
  console.log("  Workspace document updated.");
}

/* ------------------------------------------------------------------------ traversal helpers */

export type ObsRef = {
  obs: Record<string, unknown>;
  auditName: string;
  reportTitle: string;
  /** Dotted path for the report, e.g. audits[2].reports[0].observations[5] */
  path: string;
};

/** Walk every observation in the document, carrying enough context to write a useful report. */
export function eachObservation(db: Workspace): ObsRef[] {
  const out: ObsRef[] = [];
  const audits = Array.isArray(db.audits) ? (db.audits as Record<string, unknown>[]) : [];
  audits.forEach((a, ai) => {
    const reports = Array.isArray(a.reports) ? (a.reports as Record<string, unknown>[]) : [];
    reports.forEach((r, ri) => {
      const obs = Array.isArray(r.observations)
        ? (r.observations as Record<string, unknown>[])
        : [];
      obs.forEach((o, oi) => {
        out.push({
          obs: o,
          auditName: String(a.name || "(unnamed audit)"),
          reportTitle: String(r.title || "(untitled report)"),
          path: `audits[${ai}].reports[${ri}].observations[${oi}]`,
        });
      });
    });
  });
  return out;
}

/* --------------------------------------------------------------------------- report output */

export function heading(title: string): void {
  console.log(`\n${title}\n${"=".repeat(title.length)}`);
}

export function section(title: string, count: number): void {
  console.log(`\n${title} (${count})\n${"-".repeat(title.length + String(count).length + 3)}`);
}

/** Print a fixed-width table. Values are truncated so a wide field can't wreck the layout. */
export function table(rows: Record<string, string>[], widths: Record<string, number> = {}): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const w: Record<string, number> = {};
  for (const c of cols) {
    const max = widths[c] ?? 48;
    w[c] = Math.min(max, Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  }
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log("  " + cols.map((c) => cut(c.toUpperCase(), w[c])).join("  "));
  console.log("  " + cols.map((c) => "-".repeat(w[c])).join("  "));
  for (const r of rows) console.log("  " + cols.map((c) => cut(String(r[c] ?? ""), w[c])).join("  "));
}

/** Standard closing banner. Makes it obvious whether anything was actually written. */
export function outcome(ctx: Ctx, changes: number, name: string): void {
  console.log("");
  if (!changes) {
    console.log(`No changes needed. (${name})`);
    return;
  }
  if (ctx.apply) {
    console.log(`Applied ${changes} change(s). Re-run without --apply to confirm it now reports zero.`);
  } else {
    console.log(
      `DRY RUN — ${changes} change(s) identified, nothing written.\n` +
        `Review the report above, then re-run with:  npx tsx scripts/${name}.mts --apply`,
    );
  }
}
