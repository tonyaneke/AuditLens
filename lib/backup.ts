// Full database backup — every table, every row, exactly as stored — as one ZIP.
//
// Tables are read with raw SQL, not through the Prisma models, deliberately: a backup must not
// depend on the code and the database agreeing. When this was written the live AuditLog table was
// still missing the provenance columns the model declares (scripts/add-audit-provenance.mts had not
// been applied), so prisma.auditLog.findMany() failed outright — and drift like that is exactly when
// a backup is wanted. Listing tables from information_schema also means a table added later is
// backed up without anyone remembering to add it here.
//
// The workspace document goes in as the raw row: deleted records (tombstones) and the SOP PDFs the
// API never serves are part of it, so a restore puts back everything, not just what users see.
// Evidence files are not copied — they already live in SharePoint, and the document records each
// one's itemId and link.
//
// Built by POST /api/backup (Settings → Back up now) and by migrations before they write.

import type { prisma as appPrisma } from "./prisma";
import { createZip } from "./zip";

type Db = Pick<typeof appPrisma, "$queryRawUnsafe">;
type Row = Record<string, unknown>;

/* SEC-03: until scripts/drop-local-password.mts has run on a database, User still carries a dead
   passwordHash column of unusable random values. Nothing reads it, and a credential-shaped column
   has no business in a file that gets copied around. */
const EXCLUDED_COLUMNS = new Set(["User.passwordHash"]);

export const BACKUP_FORMAT = 1;

export type BackupContents = {
  audits: number;
  reports: number;
  observations: number;
  closedObservations: number;
  deletedObservations: number;
  /** Owner responses, comments and progress updates on observations and external findings. */
  responsesAndComments: number;
  externalFindings: number;
  fraudRisks: number;
  approvals: number;
  users: number;
  auditTrailEntries: number;
};

export type BackupManifest = {
  app: "AuditLens";
  format: number;
  createdAt: string;
  createdBy: string;
  /** updatedAt of the workspace row — the version a restore puts back. */
  workspaceUpdatedAt: string | null;
  tables: { name: string; file: string; rows: number; columns: string[] }[];
  excludedColumns: string[];
  contents: BackupContents;
};

export type Backup = { fileName: string; zip: Buffer; manifest: BackupManifest };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

function toJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
}

function arr(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

function summarise(doc: Row, users: number, auditTrailEntries: number): BackupContents {
  const audits = arr(doc.audits);
  const reports = audits.flatMap((a) => arr(a.reports));
  const obs = reports.flatMap((r) => arr(r.observations));
  const ext = arr(doc.extFindings);
  const talk = (x: Row) => arr(x.updates).length + (String(x.ownerResponse || "").trim() ? 1 : 0);
  return {
    audits: audits.length,
    reports: reports.length,
    observations: obs.length,
    closedObservations: obs.filter((o) => o.status === "Closed").length,
    deletedObservations: obs.filter((o) => o.deletedAt).length,
    responsesAndComments: [...obs, ...ext].reduce((n, x) => n + talk(x), 0),
    externalFindings: ext.length,
    fraudRisks: arr(doc.fraudRisks).length,
    approvals: arr(doc.approvals).length,
    users,
    auditTrailEntries,
  };
}

function readme(m: BackupManifest): string {
  const c = m.contents;
  return [
    "AuditLens — full database backup",
    "================================",
    "",
    `Taken ${m.createdAt} (UTC) by ${m.createdBy}.`,
    "",
    "CONFIDENTIAL. This file is every record in AuditLens: all audits, reports and observations",
    "(with owner responses, comments and closure details), external findings, the fraud register,",
    "approvals, user accounts and the complete audit trail. Keep it where only Internal Audit can",
    "reach it.",
    "",
    "Contents",
    `  ${c.audits} audits, ${c.reports} reports`,
    `  ${c.observations} observations — ${c.closedObservations} closed, ${c.deletedObservations} deleted (kept)`,
    `  ${c.responsesAndComments} owner responses, comments and progress updates`,
    `  ${c.externalFindings} external findings, ${c.fraudRisks} fraud risks, ${c.approvals} approval requests`,
    `  ${c.users} user accounts, ${c.auditTrailEntries} audit-trail entries`,
    "",
    "Files",
    ...m.tables.map((t) => `  ${t.file.padEnd(28)} ${t.rows} row(s)`),
    "  manifest.json                what is in this backup, in machine-readable form",
    "",
    "Evidence files (attachments, closure evidence, working papers) are not copied here: they are",
    "already in SharePoint, and the workspace document records where each one is.",
    "",
    "Restoring the workspace (audits, observations, findings, approvals — everything but user",
    "accounts and the audit trail, which are never overwritten):",
    "  npx tsx scripts/restore-workspace.mts <this file>.zip            (dry run — shows what changes)",
    "  npx tsx scripts/restore-workspace.mts <this file>.zip --apply",
    "",
  ].join("\r\n");
}

/** Read the whole database and package it. Reads only — never writes. */
export async function buildBackup(db: Db, createdBy: string, now = new Date()): Promise<Backup> {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  const columns = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
      ORDER BY table_name, ordinal_position`,
  );

  const files: { name: string; data: string }[] = [];
  const manifestTables: BackupManifest["tables"] = [];
  const excluded: string[] = [];
  const rowsOf: Record<string, Row[]> = {};

  for (const { table_name: table } of tables) {
    const all = columns.filter((c) => c.table_name === table).map((c) => c.column_name);
    const keep = all.filter((c) => !EXCLUDED_COLUMNS.has(`${table}.${c}`));
    excluded.push(...all.filter((c) => !keep.includes(c)).map((c) => `${table}.${c}`));
    if (!keep.length) continue;
    const order = keep.includes("createdAt") ? ` ORDER BY ${ident("createdAt")}` : "";
    const rows = await db.$queryRawUnsafe<Row[]>(
      `SELECT ${keep.map(ident).join(", ")} FROM ${ident(table)}${order}`,
    );
    rowsOf[table] = rows;
    const file = `tables/${table}.json`;
    files.push({ name: file, data: toJson(rows) });
    manifestTables.push({ name: table, file, rows: rows.length, columns: keep });
  }

  const workspace = (rowsOf.WorkspaceData || []).find((r) => r.id === "default");
  if (!workspace || !workspace.data || typeof workspace.data !== "object") {
    // A backup without the one row that holds every audit record is not a backup.
    throw new Error("The workspace document was not found — nothing was backed up.");
  }

  const manifest: BackupManifest = {
    app: "AuditLens",
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    createdBy,
    workspaceUpdatedAt: workspace.updatedAt ? new Date(workspace.updatedAt as string).toISOString() : null,
    tables: manifestTables,
    excludedColumns: excluded,
    contents: summarise(
      workspace.data as Row,
      (rowsOf.User || []).length,
      (rowsOf.AuditLog || []).length,
    ),
  };

  const stamp = now.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "");
  const zip = createZip(
    [
      { name: "README.txt", data: readme(manifest) },
      { name: "manifest.json", data: toJson(manifest) },
      ...files,
    ],
    now,
  );
  return { fileName: `auditlens-backup-${stamp}.zip`, zip, manifest };
}
