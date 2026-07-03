import { NextResponse } from "next/server";
import {
  createSession,
  getSessionWithFlags,
  hashPassword,
  userToSession,
  verifyPassword,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getSessionWithFlags();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";
  const confirmPassword = body.confirmPassword || "";
  const isFirstLogin = session.mustChangePassword;

  if (!newPassword || !confirmPassword) {
    return NextResponse.json(
      { error: "New password and confirmation are required." },
      { status: 400 },
    );
  }
  if (!isFirstLogin && !currentPassword) {
    return NextResponse.json(
      { error: "Current password is required." },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { error: "New passwords do not match." },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (
    !isFirstLogin &&
    !(await verifyPassword(currentPassword, user.passwordHash))
  ) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 401 },
    );
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    return NextResponse.json(
      { error: "New password must be different from your current password." },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    },
  });

  const sessionUser = userToSession(updated);
  await createSession(sessionUser);

  await writeAuditLog({
    user: sessionUser,
    action: "auth.password_changed",
    category: "auth",
    summary: isFirstLogin
      ? `${sessionUser.name} set their password on first sign-in`
      : `${sessionUser.name} changed their password`,
  });

  return NextResponse.json({ user: sessionUser });
}
