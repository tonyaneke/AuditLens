import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import {
  normalizeSidebarAccess,
  type SessionUser,
} from "./permissions";
import { effectiveMustChangePassword } from "./auth-config";

const SESSION_COOKIE = "ams_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured.");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
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
    mustChangePassword: user.mustChangePassword,
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
      mustChangePassword: effectiveMustChangePassword(
        Boolean(payload.mustChangePassword),
      ),
    };
  } catch {
    return null;
  }
}

export async function getSessionWithFlags(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user) return null;

  return userToSession(user);
}

export async function requireSession() {
  const session = await getSessionWithFlags();
  if (!session) throw new Error("Unauthorized");
  return session;
}

export async function requireActiveSession() {
  const session = await requireSession();
  if (session.mustChangePassword) throw new Error("PasswordChangeRequired");
  return session;
}

export async function requireHeadOfAudit() {
  const session = await requireActiveSession();
  if (session.role !== "head_of_audit") throw new Error("Forbidden");
  return session;
}

export function userToSession(user: {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  sidebarAccess: unknown;
  mustChangePassword: boolean;
  photo?: string | null;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    department: user.department,
    role: user.role,
    sidebarAccess: normalizeSidebarAccess(user.sidebarAccess),
    mustChangePassword: effectiveMustChangePassword(user.mustChangePassword),
    photo: user.photo ?? null,
  };
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
