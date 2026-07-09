import { NextResponse } from "next/server";
import { hashPassword, requireHeadOfAudit, userToSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { loginUrlFromRequest, sendWelcomeEmail } from "@/lib/email";
import { generateTempPassword } from "@/lib/password-utils";
import { prisma } from "@/lib/prisma";
import { ASSESSMENT_VIEWS, normalizeRole, normalizeSidebarAccess } from "@/lib/permissions";

export async function GET() {
  try {
    await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      role: true,
      sidebarAccess: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const department = body.department?.trim() || "";
  const role = normalizeRole(body.role);
  const sidebarAccess = normalizeSidebarAccess(body.sidebarAccess);

  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and email are required." },
      { status: 400 },
    );
  }
  if (role === "head_of_audit" && session.role !== "head_of_audit") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists." },
      { status: 409 },
    );
  }

  const tempPassword = generateTempPassword();

  const user = await prisma.user.create({
    data: {
      name,
      email,
      department,
      role,
      sidebarAccess:
        role === "audit_staff"
          ? sidebarAccess.filter((v) =>
              (ASSESSMENT_VIEWS as readonly string[]).includes(v),
            )
          : [],
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    },
  });

  const emailResult = await sendWelcomeEmail({
    to: email,
    name,
    tempPassword,
    loginUrl: loginUrlFromRequest(request),
  });

  await writeAuditLog({
    user: session,
    action: "user.created",
    category: "user",
    summary: `Created user ${name} (${email})`,
    metadata: {
      targetUserId: user.id,
      targetEmail: email,
      role,
      emailSent: emailResult.sent,
    },
  });

  return NextResponse.json(
    {
      user: userToSession(user),
      emailSent: emailResult.sent,
      emailError: emailResult.sent ? undefined : emailResult.error,
    },
    { status: 201 },
  );
}
