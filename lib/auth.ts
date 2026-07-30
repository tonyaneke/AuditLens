import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import {
  effectiveRole,
  normalizeSidebarAccess,
  type SessionUser,
} from "./permissions";
import { photoUrlFor } from "./photo-url";

/* SEC-03 — this app authenticates through Microsoft Entra SSO only. There is no local password.
 *
 * It used to carry the remains of one: a `passwordHash` column filled with an unusable random
 * value, a `mustChangePassword` flag nothing could ever clear through the UI, and
 * hashPassword/verifyPassword/generateTempPassword helpers with no call sites. The audit read
 * that surface — correctly — as evidence of a second authentication path that would bypass
 * conditional access and MFA, and spent review effort proving it was not live. Dead code that
 * misleads an incident responder is a finding in its own right, so it is gone: sign-in is
 * app/api/auth/azure/start → app/api/auth/callback, and nothing else. */

const SESSION_COOKIE = "ams_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  return new TextEncoder().encode(secret);
}

// Signs a session JWT for the user. Use this when you need to set the cookie yourself
// (e.g. on a NextResponse redirect from the SSO callback); createSession sets it via next/headers.
export async function signSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    name: user.name,
    email: user.email,
    department: user.department,
    role: user.role,
    sidebarAccess: user.sidebarAccess,
    activeRole: user.activeRole || "",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(authSecret());
}

export async function createSession(user: SessionUser) {
  const token = await signSessionToken(user);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, authSecret());
    const id = payload.sub;
    if (!id || typeof id !== "string") return null;

    return {
      id,
      name: String(payload.name || ""),
      email: String(payload.email || ""),
      department: String(payload.department || ""),
      role: String(payload.role || "audit_staff"),
      sidebarAccess: normalizeSidebarAccess(payload.sidebarAccess),
      activeRole: String(payload.activeRole || "") || undefined,
    };
  } catch {
    return null;
  }
}

export async function getSessionWithFlags(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  // A deactivated user's existing session is invalid immediately — same as a deleted one.
  if (!user || user.active === false) return null;

  // activeRole lives only in the JWT (it's a per-session view state, not a DB fact) — carry it
  // over from the token, but only while the DB still says the user is an admin.
  const fresh = userToSession(user);
  if (user.role === "admin" && session.activeRole) fresh.activeRole = session.activeRole;
  return fresh;
}

export async function requireSession() {
  const session = await getSessionWithFlags();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/* Kept as a distinct name because ~15 route handlers read as `requireActiveSession()` and the
   intent — "a session good enough to act on" — is still the right one to state at a call site.
   It no longer has a password-change gate to apply; getSessionWithFlags() already rejects a
   deleted or deactivated user. */
export async function requireActiveSession() {
  return requireSession();
}

export async function requireHeadOfAudit() {
  const session = await requireActiveSession();
  if (effectiveRole(session) !== "head_of_audit") throw new Error("Forbidden");
  return session;
}

export function userToSession(user: {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  sidebarAccess: unknown;
  photo?: string | null;
  updatedAt?: Date | string | null;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: user.department,
    role: user.role,
    sidebarAccess: normalizeSidebarAccess(user.sidebarAccess),
    /* QA-19 — a cacheable URL, not the stored base64 data URL. /api/auth/me is fetched on
       every page load, and the photo was inflating it by up to ~683 KB for one user. */
    photo: photoUrlFor({ id: user.id, photo: user.photo, updatedAt: user.updatedAt }),
  };
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
