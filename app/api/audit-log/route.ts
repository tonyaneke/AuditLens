import { NextResponse } from "next/server";
import {
  actionLabel,
  categoryForAction,
  CLIENT_AUDIT_ACTIONS,
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

  const where = {
    ...(action ? { action } : {}),
    ...(category ? { category } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" as const } },
            { userName: { contains: q, mode: "insensitive" as const } },
            { userEmail: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
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

  if (!CLIENT_AUDIT_ACTIONS.has(action)) {
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
    metadata: body.metadata,
  });

  return NextResponse.json({ ok: true });
}
