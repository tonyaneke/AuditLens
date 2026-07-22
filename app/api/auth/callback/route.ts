import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  findUserByEmail,
  signSessionToken,
  userToSession,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import {
  callbackUrl,
  exchangeCode,
  extractEmail,
  extractName,
  fetchProfilePhoto,
  verifyIdToken,
} from "@/lib/azure-sso";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const TEMP_COOKIES = ["azure_state", "azure_nonce", "azure_verifier", "azure_next"];

function toLogin(request: NextRequest, error: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
  for (const ck of TEMP_COOKIES) res.cookies.set(ck, "", { path: "/", maxAge: 0 });
  return res;
}

// Completes Microsoft SSO: validate state, exchange the code, verify the ID token, then sign the
// user in only if their email already belongs to an AuditLens account.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return toLogin(request, "sso_failed");

  const code = params.get("code");
  const state = params.get("state");
  const c = request.cookies;
  const savedState = c.get("azure_state")?.value;
  const nonce = c.get("azure_nonce")?.value;
  const verifier = c.get("azure_verifier")?.value;
  const nextRaw = c.get("azure_next")?.value || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!code || !state || !savedState || state !== savedState || !nonce || !verifier) {
    return toLogin(request, "sso_state");
  }

  let email = "";
  let name = "";
  let photo: string | null = null;
  try {
    const tokens = await exchangeCode({
      code,
      redirectUri: callbackUrl(request),
      codeVerifier: verifier,
    });
    const claims = await verifyIdToken(tokens.id_token, nonce);
    email = extractEmail(claims);
    name = extractName(claims);
    // Best-effort: pull the Microsoft profile photo using the delegated access token.
    if (tokens.access_token) photo = await fetchProfilePhoto(tokens.access_token);
  } catch {
    return toLogin(request, "sso_failed");
  }

  if (!email) return toLogin(request, "sso_no_email");

  const user = await findUserByEmail(email);
  if (!user) return toLogin(request, "not_provisioned");

  // SSO users have no local password to manage — clear any stale first-login flag, keep the display
  // name in sync with Microsoft if it was blank, and refresh the profile photo when we got one.
  const patch: { mustChangePassword?: boolean; name?: string; photo?: string } = {};
  if (user.mustChangePassword) patch.mustChangePassword = false;
  if (name && !user.name?.trim()) patch.name = name;
  if (photo) patch.photo = photo;
  const dbUser = Object.keys(patch).length
    ? await prisma.user.update({ where: { id: user.id }, data: patch })
    : user;

  const sessionUser = userToSession({ ...dbUser, mustChangePassword: false });
  const token = await signSessionToken(sessionUser);

  await writeAuditLog({
    user: sessionUser,
    action: "auth.login",
    category: "auth",
    summary: `${sessionUser.name} signed in via Microsoft SSO`,
    metadata: { email: sessionUser.email, method: "sso" },
  }).catch(() => {});

  const res = NextResponse.redirect(new URL(next, request.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  for (const ck of TEMP_COOKIES) res.cookies.set(ck, "", { path: "/", maxAge: 0 });
  return res;
}
