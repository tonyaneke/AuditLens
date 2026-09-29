import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { requireHeadOfAudit } from "@/lib/auth";
import { buildBackup } from "@/lib/backup";
import { prisma } from "@/lib/prisma";
import { listSharePointBackups, sharepointConfigured, uploadBackupToSharePoint } from "@/lib/sharepoint";

export const runtime = "nodejs";
export const maxDuration = 60;

/* Full database backups, kept in SharePoint beside the evidence library (AuditLens/Backups).

   Head of Audit only: a backup is every record in AuditLens, so it is exactly as sensitive as the
   whole system. The file goes straight from this process to SharePoint — it is never written to
   the server's disk or sent to the browser — and only its name and link come back. */

export async function GET() {
  try {
    await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!sharepointConfigured()) return NextResponse.json({ configured: false, backups: [] });
  try {
    return NextResponse.json({ configured: true, backups: await listSharePointBackups(10) });
  } catch (e) {
    console.error("[backup] listing failed:", e);
    return NextResponse.json(
      { configured: true, backups: [], error: "Could not read the backups folder in SharePoint." },
      { status: 502 },
    );
  }
}

export async function POST() {
  let session;
  try {
    session = await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!sharepointConfigured()) {
    return NextResponse.json(
      { error: "SharePoint is not configured on this server, so there is nowhere to keep a backup." },
      { status: 503 },
    );
  }

  let backup;
  try {
    backup = await buildBackup(prisma, `${session.name} <${session.email}>`);
  } catch (e) {
    console.error("[backup] build failed:", e);
    return NextResponse.json(
      { error: "The backup could not be built, so nothing was saved. Try again in a minute." },
      { status: 500 },
    );
  }

  let saved;
  try {
    const { zip } = backup;
    saved = await uploadBackupToSharePoint(
      backup.fileName,
      zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
    );
  } catch (e) {
    console.error("[backup] upload failed:", e);
    return NextResponse.json(
      { error: "SharePoint did not accept the backup, so nothing was saved. Try again in a minute." },
      { status: 502 },
    );
  }

  const c = backup.manifest.contents;
  // The file is safely in SharePoint by now; a failed trail entry must not report the backup lost.
  await writeAuditLog({
    user: session,
    action: "data.backup_saved",
    category: "data",
    summary:
      `Saved a full database backup to SharePoint: ${saved.name} — ${c.observations} observations, ` +
      `${c.externalFindings} external findings, ${c.users} users, ${c.auditTrailEntries} audit-trail entries`,
    metadata: {
      itemId: saved.itemId,
      name: saved.name,
      size: saved.size,
      contents: c,
      tables: backup.manifest.tables.map((t) => ({ name: t.name, rows: t.rows })),
    },
  }).catch((e) => console.error("[backup] audit-trail entry failed:", e));

  return NextResponse.json({
    backup: {
      itemId: saved.itemId,
      name: saved.name,
      size: saved.size,
      webUrl: saved.webUrl,
      createdAt: backup.manifest.createdAt,
    },
    contents: c,
  });
}
