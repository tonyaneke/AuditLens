import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  findUserByEmail,
  signSessionToken,
  userToSession,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

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

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "No AuditLens user with that email." }, { status: 404 });
  }

  const sessionUser = userToSession({ ...user, mustChangePassword: false });
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
