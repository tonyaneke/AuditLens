import { NextResponse } from "next/server";
import {
  createSession,
  hashPassword,
  requireHeadOfAudit,
  userToSession,
} from "@/lib/auth";
import { isPasswordChangeRequired } from "@/lib/auth-config";
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
    password?: string;
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

  const data: {
    name?: string;
    email?: string;
    department?: string;
    role?: string;
    sidebarAccess?: string[];
    passwordHash?: string;
    mustChangePassword?: boolean;
  } = {
    name: body.name?.trim() || existing.name,
    email: email || existing.email,
    department: body.department?.trim() ?? existing.department,
    role,
    sidebarAccess,
  };

  if (body.password?.trim()) {
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }
    data.passwordHash = await hashPassword(body.password);
    if (isPasswordChangeRequired()) {
      data.mustChangePassword = true;
    }
  }

  const user = await prisma.user.update({ where: { id }, data });

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
  return NextResponse.json({ ok: true });
}
