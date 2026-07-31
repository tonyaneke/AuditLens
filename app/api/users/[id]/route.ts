import { NextResponse } from "next/server";
import {
  createSession,
  requireHeadOfAudit,
  userToSession,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { loginUrlFromRequest, sendWelcomeEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import {
  ASSESSMENT_VIEWS,
  normalizeRole,
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

  const role = body.role ? normalizeRole(body.role) : existing.role;

  if (existing.id === session.id && role !== "head_of_audit") {
    return NextResponse.json(
      { error: "You cannot remove your own Head of Audit role." },
      { status: 400 },
    );
  }

  const sidebarAccess =
    role === "audit_staff"
      ? normalizeSidebarAccess(body.sidebarAccess ?? existing.sidebarAccess).filter(
          (v) => (ASSESSMENT_VIEWS as readonly string[]).includes(v),
        )
      : [];

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

// Deactivate / reactivate. Deactivation keeps the account and all history but blocks sign-in
// (any existing session dies on its next request). This is the recommended alternative to delete.
//
// Activation is also the release valve for the welcome email. Accounts provisioned ahead of
// go-live (the backlog import creates every action owner inactive) have never been told they
// exist; the Head of Audit making them active is the moment that becomes true, so the "your
// account is ready" email goes out here. `welcomeEmailSentAt` makes it exactly once — a later
// deactivate/reactivate for staff movement must not re-welcome someone who has been using the
// system for months.
export async function PATCH(request: Request, { params }: Params) {
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

  let body: { active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active must be true or false." }, { status: 400 });
  }
  if (id === session.id && !body.active) {
    return NextResponse.json(
      { error: "You cannot make your own account inactive." },
      { status: 400 },
    );
  }
  if (existing.active === body.active) {
    return NextResponse.json({ user: userToSession(existing), active: existing.active });
  }

  const user = await prisma.user.update({ where: { id }, data: { active: body.active } });

  // First activation only. A send failure is reported to the caller but never rolls the
  // activation back — the account genuinely is active, and leaving it blocked because SendGrid
  // was unreachable would be the worse outcome. An unstamped row simply retries on the next
  // activation, which is the behaviour you want from a best-effort notification.
  let welcome: { sent: boolean; error?: string } | null = null;
  if (body.active && !existing.welcomeEmailSentAt) {
    const result = await sendWelcomeEmail({
      to: user.email,
      name: user.name,
      loginUrl: loginUrlFromRequest(request),
    });
    welcome = { sent: result.sent, error: result.sent ? undefined : result.error };
    if (result.sent) {
      await prisma.user.update({
        where: { id: user.id },
        data: { welcomeEmailSentAt: new Date() },
      });
    }
  }

  await writeAuditLog({
    user: session,
    action: body.active ? "user.reactivated" : "user.deactivated",
    category: "user",
    summary:
      `Marked user ${user.name} (${user.email}) as ${body.active ? "active" : "inactive"}` +
      (welcome ? (welcome.sent ? " — welcome email sent" : " — welcome email failed") : ""),
    metadata: {
      targetUserId: user.id,
      targetEmail: user.email,
      role: user.role,
      ...(welcome ? { welcomeEmailSent: welcome.sent } : {}),
    },
  });

  return NextResponse.json({
    user: userToSession(user),
    active: user.active,
    welcomeEmailSent: welcome?.sent,
    welcomeEmailError: welcome?.error,
  });
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
