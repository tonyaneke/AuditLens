import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireActiveSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { effectiveRole, type SessionUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { authorizeWorkspaceWrite } from "@/lib/workspace-authz";

const WORKSPACE_ID = "default";

type AnyRec = Record<string, unknown>;

/** Who is asking, for the read-side trimming below. Uses effectiveRole so an admin viewing as
 *  an action owner is trimmed like an action owner — the same rule the UI applies. */
function viewerOf(session: { id: string; role: string; activeRole?: string }) {
  return { id: session.id, isHead: effectiveRole(session as SessionUser) === "head_of_audit" };
}

// The stored SOP PDFs (processReviews[].sopPdfBase64) are by far the heaviest part of the
// workspace document (~1.1 MB of 1.7 MB stored). They stay server-side: GET replaces each with a
// sopPdfStored flag, and PUT grafts the stored base64 back so a client save never loses them.
function slimForClient(
  data: WorkspaceDb,
  viewer: { id: string; isHead: boolean },
): WorkspaceDb {
  let out = data;

  const reviews = out.processReviews as AnyRec[] | undefined;
  if (reviews && reviews.some((r) => r && typeof r === "object" && r.sopPdfBase64)) {
    out = {
      ...out,
      processReviews: reviews.map((r) => {
        if (!r || typeof r !== "object" || !r.sopPdfBase64) return r;
        const { sopPdfBase64: _dropped, ...rest } = r;
        void _dropped;
        return { ...rest, sopPdfStored: true };
      }),
    };
  }

  /* QA-7 — notifications are addressed to a single user, and every read path already filters
     with myNotifications(db, user.id). The whole list was still being sent to everyone: ~35 KB
     of payload that no client uses, and every user could read every other user's notification
     text, which quotes observation titles they may have no business seeing. Filtered here;
     graftServerHeld() below puts the other users' rows back on write so a save cannot drop
     them by omission. */
  const notifs = out.notifications as AnyRec[] | undefined;
  if (Array.isArray(notifs) && notifs.length) {
    out = {
      ...out,
      notifications: notifs.filter((n) => String(n?.userId || "") === viewer.id),
    } as WorkspaceDb;
  }

  /* exco.briefs[].token is the credential for /brief?id=<token>, a PUBLIC, unauthenticated
     route (it is in proxy.ts PUBLIC_PATHS). Shipping every token to every signed-in user meant
     any action owner could mint a shareable link to the Board assurance brief and send it
     outside the organisation. Only the Head of Audit, who issues the briefs, needs them. */
  const exco = out.exco as AnyRec | undefined;
  if (!viewer.isHead && exco && Array.isArray(exco.briefs)) {
    out = {
      ...out,
      exco: {
        ...exco,
        briefs: (exco.briefs as AnyRec[]).map((b) => {
          if (!b || !b.token) return b;
          const { token: _withheld, ...rest } = b;
          void _withheld;
          return rest;
        }),
      },
    } as WorkspaceDb;
  }

  return out;
}

/** Restore everything slimForClient() withheld, so a whole-document save cannot delete data the
 *  client was never sent. Anything trimmed on GET must be grafted back here. */
function graftServerHeld(current: WorkspaceDb, next: WorkspaceDb, userId: string): WorkspaceDb {
  let out = next;

  const nextReviews = out.processReviews as AnyRec[] | undefined;
  if (nextReviews && nextReviews.length) {
    const curReviews = (current.processReviews as AnyRec[] | undefined) || [];
    const byId = new Map(
      curReviews
        .filter((r) => r && typeof r === "object" && r.id)
        .map((r) => [String(r.id), r]),
    );
    out = {
      ...out,
      processReviews: nextReviews.map((r) => {
        if (!r || typeof r !== "object" || r.sopPdfBase64) return r; // fresh upload rides in
        const cur = byId.get(String(r.id));
        if (cur && cur.sopPdfBase64)
          return { ...r, sopPdfBase64: cur.sopPdfBase64, sopPdfStored: true };
        return r;
      }),
    };
  }

  /* Notifications: the client only ever received its own, so anything stored for someone else
     is server-held and must survive this write. Incoming rows are kept as-is — a client
     legitimately creates notifications addressed to other people (assigning an owner, requesting
     an approval) — and win on id collision, which is how a user marks their own as read.
     Keyed by id so a row the client still holds in memory is not duplicated. */
  const incoming = (out.notifications as AnyRec[] | undefined) || [];
  const stored = (current.notifications as AnyRec[] | undefined) || [];
  const merged = new Map<string, AnyRec>();
  for (const n of stored) {
    if (n && String(n.userId || "") !== userId) merged.set(String(n.id), n);
  }
  for (const n of incoming) {
    if (n) merged.set(String(n.id), n);
  }
  out = { ...out, notifications: [...merged.values()] } as WorkspaceDb;

  /* Brief tokens are withheld from non-heads above, so a non-head save arrives without them.
     Restore from storage — losing a token would silently break every public brief link that has
     already been circulated to the MD and EXCO. */
  const nextExco = out.exco as AnyRec | undefined;
  const curExco = current.exco as AnyRec | undefined;
  if (nextExco && Array.isArray(nextExco.briefs) && curExco && Array.isArray(curExco.briefs)) {
    const tokenById = new Map(
      (curExco.briefs as AnyRec[])
        .filter((b) => b && b.id && b.token)
        .map((b) => [String(b.id), b.token]),
    );
    out = {
      ...out,
      exco: {
        ...nextExco,
        briefs: (nextExco.briefs as AnyRec[]).map((b) => {
          if (!b || b.token) return b; // a freshly generated brief brings its own
          const stored = tokenById.get(String(b.id));
          return stored ? { ...b, token: stored } : b;
        }),
      },
    } as WorkspaceDb;
  }

  return out;
}

export async function GET(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
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
    data: slimForClient(data, viewerOf(session)),
    updatedAt: row?.updatedAt ?? null,
  });
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { data?: WorkspaceDb; baseUpdatedAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.data || !Array.isArray(body.data.audits)) {
    return NextResponse.json(
      { error: "Invalid workspace data — audits array required." },
      { status: 400 },
    );
  }

  // The org logo is a static asset now (public/org-logo.png) — never let a client write a
  // base64 logo back into the document.
  delete (body.data as AnyRec).logo;

  // Authorize the write against the stored workspace: non-head users may only make the changes their
  // role permits (raise observations, request approvals, comment, remediate). Anything else — editing/
  // deleting/withdrawing/closing observations directly, deciding approvals, touching head-only
  // sections — is reconciled away server-side so the client cannot bypass the approval workflow.
  const existing = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const current = (existing?.data as WorkspaceDb) || defaultWorkspaceData();

  /* QA-4 — optimistic concurrency.
     The whole application state is one row, and every save overwrites all of it. Without a
     version check, two people editing different observations at the same time silently
     last-write-wins: the second save is built from a snapshot taken before the first, so it
     restores the stale copy of records the second user never even opened. The audit found the
     `?meta=1` watermark endpoint already existed, suggesting conflict detection was intended
     but never enforced on write.

     `baseUpdatedAt` is the watermark the client last saw. If the stored row has moved on since,
     the write is refused with 409 and the client refreshes rather than clobbering. Older clients
     that send no watermark keep the previous behaviour rather than being locked out mid-session. */
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
    body.data,
    session.activeRole,
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

  return NextResponse.json({
    data: slimForClient(row.data as WorkspaceDb, viewerOf(session)),
    updatedAt: row.updatedAt,
  });
}
