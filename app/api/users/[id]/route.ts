import { NextResponse } from "next/server";
import {
  createSession,
  requireHeadOfAudit,
  userToSession,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import {
  ASSESSMENT_VIEWS,
  normalizeSidebarAccess,
} from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  let session;
  try {
    session = await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  let body: {
    name?: string;
    email?: string;
    department?: string;
    role?: string;
    sidebarAccess?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (email && email !== existing.email) {
    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 409 },
      );
    }
  }

  const role =
    body.role === "head_of_audit" ? "head_of_audit" : body.role === "audit_staff" ? "audit_staff" : existing.role;

  if (existing.id === session.id && role !== "head_of_audit") {
    return NextResponse.json(
      { error: "You cannot remove your own Head of Audit role." },
      { status: 400 },
    );
  }

  const sidebarAccess =
    role === "head_of_audit"
      ? []
      : normalizeSidebarAccess(body.sidebarAccess ?? existing.sidebarAccess).filter(
          (v) => (ASSESSMENT_VIEWS as readonly string[]).includes(v),
        );

  const data = {
    name: body.name?.trim() || existing.name,
    email: email || existing.email,
    department: body.department?.trim() ?? existing.department,
    role,
    sidebarAccess,
  };

  const user = await prisma.user.update({ where: { id }, data });

  await writeAuditLog({
    user: session,
    action: "user.updated",
    category: "user",
    summary: `Updated user ${user.name} (${user.email})`,
    metadata: { targetUserId: user.id, targetEmail: user.email, role: user.role },
  });

  if (user.id === session.id) {
    await createSession(userToSession(user));
  }

  return NextResponse.json({ user: userToSession(user) });
}

export async function DELETE(_request: Request, { params }: Params) {
  let session;
  try {
    session = await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  await prisma.user.delete({ where: { id } });

  await writeAuditLog({
    user: session,
    action: "user.deleted",
    category: "user",
    summary: `Deleted user ${existing.name} (${existing.email})`,
    metadata: { targetUserId: existing.id, targetEmail: existing.email },
  });

  return NextResponse.json({ ok: true });
}
