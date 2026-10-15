import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { MAX_CHAIN, buildBackup, buildChangeBackup, parseBackup, type BackupParent } from "@/lib/backup";
import { prisma } from "@/lib/prisma";
import {
  fetchSharePointBackup,
  listSharePointBackups,
  sharepointConfigured,
  uploadBackupToSharePoint,
} from "@/lib/sharepoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTION = "data.backup_auto_saved";
const WHO = "Scheduled daily backup";

/** A date or weekday as it reads in Lagos, where the week's full backup day is counted. */
const lagos = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", ...opts }).format(d);
const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };

/* The daily automatic backup, saved to SharePoint AuditLens/Backups by the Vercel Cron in
   vercel.json, with nobody signed in. At most one a day: the audit-trail entry it writes is what
   the next run checks.

   FULL ON SATURDAY, CHANGES ONLY THE REST OF THE WEEK (the user's choice, 2026-10-15). Saturday
   (Lagos time) is a full backup; if Saturday's failed or never ran — the newest backup is not a
   full one from Saturday — Sunday takes it instead. Every other run saves just what changed since
   the newest backup in the folder (lib/backup-delta.ts), and nothing at all when nothing did, so a
   restore never replays more than six change files and a lost file costs at most a week. A full one
   is also taken when there is no backup to build on, when it cannot be read, or when MAX_CHAIN
   change files are already in a row — the last safety net, for a weekend missed altogether.
   A "Back up now" in Settings is full too, and the next day's changes build on it.

   Who may trigger it. With CRON_SECRET set, only a request carrying it (Vercel Cron sends it as a
   Bearer token). Without one — the live project has none yet — only a request that identifies as
   Vercel Cron, and still at most once a day. That differs on purpose from the EXCO brief, which
   fails closed: a stray call there e-mails the MD; a stray call here can only make the day's backup
   early. Nothing comes back but whether it ran — the file goes from this process to SharePoint,
   never to the caller. Set CRON_SECRET and the user-agent fallback no longer applies. */

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const fromVercelCron = /^vercel-cron\//i.test(request.headers.get("user-agent") || "");
  if (secret ? bearer !== secret : !fromVercelCron) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!sharepointConfigured()) {
    return NextResponse.json({ ok: false, error: "SharePoint is not configured on this server." }, { status: 503 });
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  // Only the id is selected, so this works on an AuditLog without the provenance columns.
  const done = await prisma.auditLog.findFirst({
    where: { action: ACTION, createdAt: { gte: new Date(`${day}T00:00:00.000Z`) } },
    select: { id: true },
  });
  if (done) return NextResponse.json({ ok: true, saved: false, reason: `Already backed up on ${day}.` });

  // What today's changes go on: the newest backup in the folder, whichever kind and however made.
  let parent: BackupParent | null = null;
  try {
    const [latest] = await listSharePointBackups(1);
    if (latest) {
      const got = await fetchSharePointBackup(latest.name);
      const p = parseBackup(got.data, got.name);
      parent = { name: got.name, manifest: p.manifest, index: p.index };
    }
  } catch (e) {
    console.error("[backup:auto] could not read the newest backup — taking a full one:", e);
  }
  const weekday = lagos(now, { weekday: "short" });
  const yesterday = lagos(new Date(now.getTime() - 86_400_000), DATE);
  const saturdayFullDone =
    !!parent && parent.manifest.kind !== "changes" && lagos(new Date(parent.manifest.createdAt), DATE) === yesterday;
  const full =
    weekday === "Sat" ||
    (weekday === "Sun" && !saturdayFullDone) ||
    !parent ||
    (parent.manifest.chainDepth ?? 0) >= MAX_CHAIN;

  let backup;
  try {
    backup = full ? await buildBackup(prisma, WHO, now) : await buildChangeBackup(prisma, WHO, parent!, now);
  } catch (e) {
    console.error("[backup:auto] build failed:", e);
    return NextResponse.json({ ok: false, error: "The backup could not be built." }, { status: 500 });
  }

  if (!backup) {
    // Nothing changed: no file to save, but the day is recorded — and marked done.
    await writeAuditLog({
      user: null,
      via: "system",
      action: ACTION,
      category: "data",
      summary: `Automatic daily backup: nothing has changed since ${parent!.name}, so no new file was needed`,
      metadata: { unchanged: true, parent: parent!.name },
    }).catch((e) => console.error("[backup:auto] audit-trail entry failed:", e));
    return NextResponse.json({ ok: true, saved: false, reason: "Nothing changed since the last backup.", day });
  }

  let saved;
  try {
    const { zip } = backup;
    saved = await uploadBackupToSharePoint(
      backup.fileName,
      zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer,
    );
  } catch (e) {
    console.error("[backup:auto] upload failed:", e);
    return NextResponse.json({ ok: false, error: "SharePoint did not accept the backup." }, { status: 502 });
  }

  const m = backup.manifest;
  const c = m.contents;
  // The file is safely in SharePoint by now; a failed trail entry must not report the backup lost.
  await writeAuditLog({
    user: null,
    via: "system",
    action: ACTION,
    category: "data",
    summary:
      m.kind === "changes"
        ? `Automatic daily backup saved to SharePoint: ${saved.name} — the changes since ${m.parent} ` +
          `(${(m.changes || []).map((x) => `${x.table} ${x.changed}`).join(", ")})`
        : `Automatic daily backup saved to SharePoint: ${saved.name} — full: ${c.observations} observations, ` +
          `${c.externalFindings} external findings, ${c.users} users, ${c.auditTrailEntries} audit-trail entries`,
    metadata: {
      itemId: saved.itemId,
      name: saved.name,
      size: saved.size,
      kind: m.kind,
      parent: m.parent ?? null,
      base: m.base ?? null,
      chainDepth: m.chainDepth ?? 0,
      changes: m.changes ?? null,
      contents: c,
    },
  }).catch((e) => console.error("[backup:auto] audit-trail entry failed:", e));

  return NextResponse.json({ ok: true, saved: true, kind: m.kind, day });
}
