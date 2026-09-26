import { NextResponse } from "next/server";
import {
  actionLabel,
  categoryForAction,
  isClientAuditAction,
  writeAuditLog,
} from "@/lib/audit-log";
import { requireActiveSession, requireHeadOfAudit } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit")) || 50),
  );
  const action = url.searchParams.get("action")?.trim();
  const category = url.searchParams.get("category")?.trim();
  const q = url.searchParams.get("q")?.trim();
  // How the session was established: sso | dev | system | script, or "none" for entries written
  // before provenance was recorded.
  const method = url.searchParams.get("method")?.trim();
  // Everything one sign-in did, or everything done under one account.
  const sessionId = url.searchParams.get("session")?.trim();
  const userId = url.searchParams.get("user")?.trim();

  const where = {
    ...(action ? { action } : {}),
    ...(category ? { category } : {}),
    ...(method ? { authMethod: method === "none" ? null : method } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(userId ? { userId } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" as const } },
            { userName: { contains: q, mode: "insensitive" as const } },
            { userEmail: { contains: q, mode: "insensitive" as const } },
            // The developer behind a developer sign-in, or whoever ran a script.
            { actorName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      // Newest first — but one save writes its entries in a single statement, so they share a
      // timestamp, and ascending id (a cuid, increasing within a process) keeps those in the
      // order the save made them.
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    logs: logs.map((row) => ({
      ...row,
      actionLabel: actionLabel(row.action),
    })),
    total,
    page,
    limit,
  });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    action?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = body.action?.trim() || "";
  const summary = body.summary?.trim() || "";

  // Only what the server cannot observe for itself — exports, e-mails the browser sent, AI
  // assistance. Changes to records are recorded by the save itself (lib/workspace-changes.ts).
  if (!isClientAuditAction(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  if (!summary) {
    return NextResponse.json({ error: "Summary is required." }, { status: 400 });
  }

  await writeAuditLog({
    user: session,
    action,
    category: categoryForAction(action),
    summary,
    /* The browser's own details are kept, but nested under `reported`: spread at the top they could
       pose as the server's (a `changes` list the viewer renders as a before/after table), and the
       `source` mark is what lets the viewer say whose account of events this is. */
    metadata: {
      source: "browser",
      ...(body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? { reported: body.metadata }
        : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
