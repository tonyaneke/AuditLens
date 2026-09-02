import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { MAX_DRAFT_BYTES, parseDraftKey } from "@/lib/draft-keys";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function draftTooLarge(data: unknown): boolean {
  try {
    return JSON.stringify(data ?? null).length > MAX_DRAFT_BYTES;
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = parseDraftKey(new URL(request.url).searchParams.get("key"));
  if (!key) return NextResponse.json({ error: "Invalid draft key." }, { status: 400 });

  const row = await prisma.userDraft.findUnique({
    where: { userId_key: { userId: session.id, key } },
    select: { data: true, updatedAt: true },
  });

  return NextResponse.json({
    data: row?.data ?? null,
    savedAt: row?.updatedAt?.toISOString() ?? null,
  });
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { key?: unknown; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const key = parseDraftKey(body.key);
  if (!key) return NextResponse.json({ error: "Invalid draft key." }, { status: 400 });
  if (body.data == null || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "Draft data must be an object." }, { status: 400 });
  }
  if (draftTooLarge(body.data)) {
    return NextResponse.json({ error: "Draft is too large." }, { status: 413 });
  }

  const row = await prisma.userDraft.upsert({
    where: { userId_key: { userId: session.id, key } },
    create: { userId: session.id, key, data: body.data as object },
    update: { data: body.data as object },
    select: { updatedAt: true },
  });

  return NextResponse.json({ ok: true, savedAt: row.updatedAt.toISOString() });
}

export async function DELETE(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = parseDraftKey(new URL(request.url).searchParams.get("key"));
  if (!key) return NextResponse.json({ error: "Invalid draft key." }, { status: 400 });

  await prisma.userDraft.deleteMany({ where: { userId: session.id, key } });
  return NextResponse.json({ ok: true });
}
