import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireActiveSession } from "@/lib/auth";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

const WORKSPACE_ID = "default";

export async function GET() {
  try {
    await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const data = (row?.data as WorkspaceDb) || defaultWorkspaceData();
  return NextResponse.json({ data, updatedAt: row?.updatedAt ?? null });
}

export async function PUT(request: Request) {
  try {
    await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { data?: WorkspaceDb };
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

  const payload = body.data as Prisma.InputJsonValue;

  const row = await prisma.workspaceData.upsert({
    where: { id: WORKSPACE_ID },
    update: { data: payload },
    create: { id: WORKSPACE_ID, data: payload },
  });

  return NextResponse.json({
    data: row.data as WorkspaceDb,
    updatedAt: row.updatedAt,
  });
}
