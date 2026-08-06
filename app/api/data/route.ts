import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireActiveSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";
import { authorizeWorkspaceWrite } from "@/lib/workspace-authz";
import { graftServerHeld, slimForClient } from "@/lib/workspace-payload";
import { viewerFor } from "@/lib/workspace-scope";
import { MAX_BODY_BYTES, prepareIncomingWorkspace } from "@/lib/workspace-validate";

const WORKSPACE_ID = "default";

type AnyRec = Record<string, unknown>;

export async function GET(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cheap poll: ?meta=1 returns only the change watermark, so the 4-second client poll costs
  // bytes instead of re-downloading the multi-megabyte workspace blob every tick.
  const url = new URL(request.url);
  if (url.searchParams.get("meta")) {
    const row = await prisma.workspaceData.findUnique({
      where: { id: WORKSPACE_ID },
      select: { updatedAt: true },
    });
    return NextResponse.json({ updatedAt: row?.updatedAt ?? null });
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const data = (row?.data as WorkspaceDb) || defaultWorkspaceData();
  return NextResponse.json({
    // The document itself resolves the viewer's department name to department records — see
    // viewerFor() in lib/workspace-scope.ts.
    data: slimForClient(data, viewerFor(session, data)),
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /* Reject oversized bodies before reading them. Worth doing explicitly: this app uses proxy.ts,
     and Next buffers every proxied request body up to `proxyClientMaxBodySize` (10 MB by default)
     — past which it TRUNCATES and continues rather than failing, so an oversized save would
     otherwise arrive as a silently-cut JSON string. A chunked request carries no Content-Length
     and slips this check, but then hits the truncate-and-fail-to-parse path below, which is safe. */
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Workspace document too large." }, { status: 413 });
  }

  let body: { data?: WorkspaceDb; baseUpdatedAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Structural validation: shape, identity and containment. Field VALUES are decided by
  // authorizeWorkspaceWrite() below — see lib/workspace-validate.ts for why this is not a schema.
  const shape = prepareIncomingWorkspace(body.data);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.error }, { status: 400 });
  }
  const incoming = shape.data;

  // The org logo is a static asset now (public/org-logo.png) — never let a client write a
  // base64 logo back into the document.
  delete (incoming as AnyRec).logo;

  // Authorize the write against the stored workspace: non-head users may only make the changes their
  // role permits (raise observations, request approvals, comment, remediate). Anything else — editing/
  // deleting/withdrawing/closing observations directly, deciding approvals, touching head-only
  // sections — is reconciled away server-side so the client cannot bypass the approval workflow.
  const existing = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const current = (existing?.data as WorkspaceDb) || defaultWorkspaceData();

  /* QA-4 / SEC-05 — optimistic concurrency.
     The whole application state is one row, and every save overwrites all of it. Without a
     version check, two people editing different observations at the same time silently
     last-write-wins: the second save is built from a snapshot taken before the first, so it
     restores the stale copy of records the second user never even opened. The audit found the
     `?meta=1` watermark endpoint already existed, suggesting conflict detection was intended
     but never enforced on write.

     `baseUpdatedAt` is the watermark the client last saw. If the stored row has moved on since,
     the write is refused with 409 and the client refreshes rather than clobbering.

     It is now REQUIRED. It used to be opt-in ("older clients keep the previous behaviour"), which
     meant the guard was only as strong as the client choosing to participate: omit the field and
     the write fell through to an unconditional upsert. The only client that ever omitted it is
     public/audit-bot.js, which no route can reach any more (every view is in MIGRATED_VIEWS, so
     isLegacyPath() is always false and nothing loads the script). WORKSPACE_ALLOW_UNVERSIONED_WRITE=1
     restores the old behaviour if that turns out to be wrong — a one-variable rollback rather than
     a redeploy — and either way the outcome is recorded in the audit log. */
  const allowUnversioned = process.env.WORKSPACE_ALLOW_UNVERSIONED_WRITE === "1";
  if (body.baseUpdatedAt === undefined && existing) {
    if (!allowUnversioned) {
      await writeAuditLog({
        user: session,
        action: "security.unversioned_write_rejected",
        category: "security",
        summary: `Rejected a workspace write with no version token from a ${session.role}`,
        metadata: { storedUpdatedAt: existing.updatedAt.toISOString() },
      }).catch(() => {});
      return NextResponse.json(
        {
          error: "version_required",
          message:
            "This save did not include a version token, so it could have overwritten someone else's work. Refresh and try again.",
          updatedAt: existing.updatedAt,
        },
        { status: 400 },
      );
    }
    await writeAuditLog({
      user: session,
      action: "security.unversioned_write_allowed",
      category: "security",
      summary: `Accepted a workspace write with no version token (WORKSPACE_ALLOW_UNVERSIONED_WRITE is set) from a ${session.role}`,
      metadata: { storedUpdatedAt: existing.updatedAt.toISOString() },
    }).catch(() => {});
  }

  if (body.baseUpdatedAt !== undefined && existing) {
    const stored = existing.updatedAt.toISOString();
    const base = body.baseUpdatedAt ? new Date(body.baseUpdatedAt).toISOString() : null;
    if (base !== stored) {
      return NextResponse.json(
        {
          error: "conflict",
          message:
            "Someone else saved a change while you were editing. Your view has been refreshed — reapply your change and save again.",
          updatedAt: existing.updatedAt,
        },
        { status: 409 },
      );
    }
  }

  const { data: authorized, violations } = authorizeWorkspaceWrite(
    session.role,
    session.id,
    current,
    incoming,
    session.activeRole,
    session.department,
    session.extraDepartments,
  );

  const payload = graftServerHeld(current, authorized, session.id) as Prisma.InputJsonValue;

  /* The check above still leaves a window between the read and the write. Make the update
     itself conditional on the watermark so two simultaneous saves cannot both succeed:
     updateMany applies a WHERE, and returns count 0 if the row moved on in between. */
  if (body.baseUpdatedAt !== undefined && existing) {
    const result = await prisma.workspaceData.updateMany({
      where: { id: WORKSPACE_ID, updatedAt: existing.updatedAt },
      data: { data: payload },
    });
    if (result.count === 0) {
      const fresh = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
      return NextResponse.json(
        {
          error: "conflict",
          message:
            "Someone else saved a change while you were editing. Your view has been refreshed — reapply your change and save again.",
          updatedAt: fresh?.updatedAt ?? null,
        },
        { status: 409 },
      );
    }
  } else {
    await prisma.workspaceData.upsert({
      where: { id: WORKSPACE_ID },
      update: { data: payload },
      create: { id: WORKSPACE_ID, data: payload },
    });
  }

  const row = await prisma.workspaceData.findUniqueOrThrow({ where: { id: WORKSPACE_ID } });

  if (violations.length) {
    // Persisted the sanitized document; record what was filtered for the security trail.
    await writeAuditLog({
      user: session,
      action: "security.workspace_write_filtered",
      category: "security",
      summary: `Reconciled ${violations.length} disallowed change(s) from a ${session.role} workspace write`,
      metadata: { violations: violations.slice(0, 50), count: violations.length },
    }).catch(() => {});
  }

  const saved = row.data as WorkspaceDb;
  return NextResponse.json({
    data: slimForClient(saved, viewerFor(session, saved)),
    updatedAt: row.updatedAt,
  });
}
