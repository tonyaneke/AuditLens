import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  findUserByEmail,
  newSessionId,
  signSessionToken,
  userToSession,
} from "@/lib/auth";
import { machineOperator, writeAuditLog } from "@/lib/audit-log";
import { prisma } from "@/lib/prisma";
import type { WorkspaceDb } from "@/lib/db-data";
import { withoutDeleted } from "@/lib/workspace-tombstones";

export const runtime = "nodejs";

// DEVELOPMENT ONLY: sign in as any existing AuditLens user by email, bypassing Microsoft SSO.
// Hard-disabled in production so it can never be a backdoor.
//
// "Development" does not mean "test data": .env points at the production database, so a session
// issued here acts on real records as a real person. It is therefore marked as a developer session
// (authMethod "dev") and names the developer operating it — the account's owner on this machine,
// or DEV_OPERATOR if set. Every audit entry it writes carries both, so the trail shows "Eniola,
// signed in as Ladi" rather than Ladi, and the app shows a banner for as long as it lasts.
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
  let created = false;
  if (!user) {
    // Development helper: check if email belongs to an EXCO brief recipient
    const ws = await prisma.workspaceData.findUnique({ where: { id: "default" } });
    const data = (ws?.data ? withoutDeleted(ws.data as WorkspaceDb) : undefined) as
      | { exco?: { recipientList?: Array<{ name?: string; email?: string; role?: string }> } }
      | undefined;
    const recipients = data?.exco?.recipientList || [];
    const matched = recipients.find(
      (r) => (r.email || "").trim().toLowerCase() === email,
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
      created = true;
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

  const operator = machineOperator();
  const sessionUser = {
    ...userToSession(user),
    sessionId: newSessionId(),
    authMethod: "dev",
    operator,
  };
  const token = await signSessionToken(sessionUser);

  // A real account in the real user table, made by a developer — as attributable as any other.
  if (created) {
    await writeAuditLog({
      user: sessionUser,
      action: "user.created",
      category: "user",
      summary: `${operator} created an executive account for ${sessionUser.name} (${sessionUser.email}) from the MD & EXCO recipient list, via the developer sign-in`,
      metadata: { targetUserId: sessionUser.id, targetEmail: sessionUser.email, role: "executive", operator },
    }).catch(() => {});
  }

  await writeAuditLog({
    user: sessionUser,
    action: "auth.login",
    category: "auth",
    summary: `${operator} signed in as ${sessionUser.name} using the developer sign-in`,
    metadata: { email: sessionUser.email, method: "dev", operator },
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
