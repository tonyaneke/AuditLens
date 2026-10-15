import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_AUTH_METHOD,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  adminLoginEnabled,
  burnVerification,
  normalizeEmail,
  verifyPassword,
} from "@/lib/admin-credential";
import { writeAuditLog } from "@/lib/audit-log";
import { SESSION_COOKIE, newSessionId, sessionLifetime, signSessionToken, userToSession } from "@/lib/auth";
import type { SessionUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/* Password sign-in for the dedicated Admin profile — the one exception to Microsoft-only sign-in.
   Every limit on it, and why each exists, is in lib/admin-credential.ts. In short: an emergency
   off switch (ADMIN_LOGIN_ENABLED=false), admin accounts only, account lock-out after repeated failures, an IP
   throttle in front of that, 8-hour sessions, and the whole of it in the audit trail. */

const REFUSED = "Incorrect email or password.";

/* Per-IP throttle, in memory. It is the outer layer only: it resets on restart and trusts the
   first X-Forwarded-For hop, which a client can write. The lock-out on the account itself is kept
   in the database and is what actually bounds guessing. */
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 20;
const ipFailures = new Map<string, number[]>();

function recentFailures(ip: string): number[] {
  const cutoff = Date.now() - IP_WINDOW_MS;
  const hits = (ipFailures.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length) ipFailures.set(ip, hits);
  else ipFailures.delete(ip);
  return hits;
}

function noteFailure(ip: string) {
  ipFailures.set(ip, [...recentFailures(ip), Date.now()]);
}

function minutesUntil(d: Date): number {
  return Math.max(1, Math.ceil((d.getTime() - Date.now()) / 60000));
}

export async function POST(request: NextRequest) {
  // Off means absent, not "forbidden": nothing advertises that the route exists.
  if (!adminLoginEnabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  /* JSON only. A cross-site page cannot send this content type without a CORS preflight, which this
     app never answers — so another site cannot drive a sign-in from a visitor's browser. */
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Unsupported request." }, { status: 415 });
  }

  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim();
  if (recentFailures(ip).length >= IP_MAX_FAILURES) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let email = "";
  let password = "";
  try {
    const body = await request.json();
    email = normalizeEmail(body?.email);
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Enter the email and password." }, { status: 400 });
  }

  /* By the account's own email. A member of staff's address finds their account but no credential,
     and is refused exactly like an address nobody has — same answer, same scrypt-sized delay. */
  const account = await prisma.user.findUnique({ where: { email }, include: { adminCredential: true } });
  const cred = account?.adminCredential;

  if (!account || !cred) {
    await burnVerification(password);
    noteFailure(ip);
    // What was typed is NOT recorded: a password typed into the wrong box would land in the log.
    await writeAuditLog({
      user: { id: "", name: "Unknown admin sign-in", email: "", authMethod: ADMIN_AUTH_METHOD },
      action: "auth.login_failed",
      category: "auth",
      summary: "Admin sign-in refused: no Admin profile has that email",
      metadata: { method: ADMIN_AUTH_METHOD },
    }).catch(() => {});
    return NextResponse.json({ error: REFUSED }, { status: 401 });
  }

  const actor = { id: account.id, name: account.name, email: account.email, authMethod: ADMIN_AUTH_METHOD };

  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    noteFailure(ip);
    await writeAuditLog({
      user: actor,
      action: "auth.login_blocked",
      category: "auth",
      summary: `Admin sign-in refused: the account is locked after repeated wrong passwords`,
      metadata: { method: ADMIN_AUTH_METHOD, lockedUntil: cred.lockedUntil.toISOString() },
    }).catch(() => {});
    return NextResponse.json(
      { error: `Too many wrong passwords. Try again in ${minutesUntil(cred.lockedUntil)} minute(s).` },
      { status: 429 },
    );
  }

  if (!(await verifyPassword(password, cred.passwordHash))) {
    noteFailure(ip);
    // Incremented in the database, so simultaneous guesses cannot all read the same count.
    const { failedAttempts } = await prisma.adminCredential.update({
      where: { id: cred.id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    const locks = failedAttempts >= MAX_FAILED_ATTEMPTS;
    if (locks) {
      await prisma.adminCredential.update({
        where: { id: cred.id },
        data: { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60000) },
      });
    }
    await writeAuditLog({
      user: actor,
      action: locks ? "auth.account_locked" : "auth.login_failed",
      category: "auth",
      summary: locks
        ? `Admin account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_ATTEMPTS} wrong passwords in a row`
        : `Admin sign-in refused: wrong password (${failedAttempts} of ${MAX_FAILED_ATTEMPTS} before lock-out)`,
      metadata: { method: ADMIN_AUTH_METHOD, failedAttempts },
    }).catch(() => {});
    return locks
      ? NextResponse.json({ error: `Too many wrong passwords. Try again in ${LOCKOUT_MINUTES} minutes.` }, { status: 429 })
      : NextResponse.json({ error: REFUSED }, { status: 401 });
  }

  /* Checked only after the password, so these answers are given to nobody who does not already
     hold it. The role check is what keeps this route from ever signing in a member of staff, even
     if a credential row were somehow attached to their account. */
  if (account.role !== "admin" || account.active === false) {
    await writeAuditLog({
      user: actor,
      action: "auth.login_blocked",
      category: "auth",
      summary: `Admin sign-in refused: the account is ${account.active === false ? "inactive" : "not an admin account"}`,
      metadata: { method: ADMIN_AUTH_METHOD, role: account.role, active: account.active },
    }).catch(() => {});
    return NextResponse.json({ error: "This account cannot sign in here." }, { status: 403 });
  }

  await prisma.adminCredential.update({
    where: { id: cred.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const sessionUser: SessionUser = {
    ...userToSession(account),
    sessionId: newSessionId(),
    authMethod: ADMIN_AUTH_METHOD,
  };
  const token = await signSessionToken(sessionUser);

  await writeAuditLog({
    user: sessionUser,
    action: "auth.login",
    category: "auth",
    summary: `${sessionUser.name} signed in with the Admin password`,
    metadata: { method: ADMIN_AUTH_METHOD },
  }).catch(() => {});

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionLifetime(sessionUser),
  });
  return res;
}
