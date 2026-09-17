import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  findUserByEmail,
  signSessionToken,
  userToSession,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// DEVELOPMENT ONLY: sign in as any existing AuditLens user by email, bypassing Microsoft SSO.
// Hard-disabled in production so it can never be a backdoor.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let email = "";
  try {
    const body = await request.json();
    email = String(body?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  let user = await findUserByEmail(email);
  if (!user) {
    // Development helper: check if email belongs to an EXCO brief recipient
    const ws = await prisma.workspaceData.findUnique({ where: { id: "default" } });
    const data = ws?.data as
      | { exco?: { recipientList?: Array<{ name?: string; email?: string; role?: string }> } }
      | undefined;
    const recipients = data?.exco?.recipientList || [];
    const matched = recipients.find(
      (r) =>
        (r.email || "").trim().toLowerCase() === email ||
        (email.includes("kolawole") && (r.email || "").toLowerCase().includes("kolawole")),
    );
    if (matched) {
      user = await prisma.user.create({
        data: {
          name: matched.name || "Executive Member",
          email,
          role: "executive",
          department: "Office of the Managing Director",
          active: true,
        },
      });
    }
  }

  if (!user) {
    return NextResponse.json({ error: "No AuditLens user with that email." }, { status: 404 });
  }
  if (user.active === false) {
    return NextResponse.json(
      { error: "This account is inactive. Contact the Head of Audit." },
      { status: 403 },
    );
  }

  const sessionUser = userToSession(user);
  const token = await signSessionToken(sessionUser);

  await writeAuditLog({
    user: sessionUser,
    action: "auth.login",
    category: "auth",
    summary: `${sessionUser.name} signed in (dev login)`,
    metadata: { email: sessionUser.email, method: "dev" },
  }).catch(() => {});

  const res = NextResponse.json({ ok: true, user: sessionUser });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // dev runs over http://localhost
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
