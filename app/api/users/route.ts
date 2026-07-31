import { NextResponse } from "next/server";
import { requireHeadOfAudit, userToSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { loginUrlFromRequest, sendWelcomeEmail } from "@/lib/email";
import { photoUrlFor } from "@/lib/photo-url";
import { prisma } from "@/lib/prisma";
import { ASSESSMENT_VIEWS, normalizeRole, normalizeSidebarAccess } from "@/lib/permissions";

export async function GET() {
  try {
    await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      role: true,
      sidebarAccess: true,
      photo: true,
      active: true,
      welcomeEmailSentAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // QA-19 — cacheable photo URL rather than the inline base64 data URL. See lib/photo-url.ts.
  const users = rows.map(({ photo, updatedAt, ...u }) => ({
    ...u,
    photo: photoUrlFor({ id: u.id, photo, updatedAt }),
  }));

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
    active?: boolean;
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
  // Provisioning ahead of go-live: create the account but leave sign-in blocked. No welcome
  // email goes out now — PATCH sends it when the Head of Audit makes the account active.
  const active = body.active !== false;

  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and email are required." },
      { status: 400 },
    );
  }
  if (role === "head_of_audit" && session.role !== "head_of_audit" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists." },
      { status: 409 },
    );
  }

  const user = await prisma.user.create({
    data: {
      name,
      email,
      department,
      role,
      active,
      sidebarAccess:
        role === "audit_staff"
          ? sidebarAccess.filter((v) =>
              (ASSESSMENT_VIEWS as readonly string[]).includes(v),
            )
          : [],
    },
  });

  const emailResult = active
    ? await sendWelcomeEmail({
        to: email,
        name,
        loginUrl: loginUrlFromRequest(request),
      })
    : ({ sent: false, error: undefined } as const);

  if (emailResult.sent) {
    await prisma.user.update({
      where: { id: user.id },
      data: { welcomeEmailSentAt: new Date() },
    });
  }

  await writeAuditLog({
    user: session,
    action: "user.created",
    category: "user",
    summary: `Created user ${name} (${email})${active ? "" : " — inactive, welcome email deferred until activation"}`,
    metadata: {
      targetUserId: user.id,
      targetEmail: email,
      role,
      active,
      emailSent: emailResult.sent,
    },
  });

  return NextResponse.json(
    {
      user: userToSession(user),
      active,
      emailSent: emailResult.sent,
      emailError: emailResult.sent ? undefined : emailResult.error,
    },
    { status: 201 },
  );
}
