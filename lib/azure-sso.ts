// Microsoft Entra ID (Azure AD) single-sign-on via the OpenID Connect Authorization Code flow
// with PKCE. Reuses the existing AZURE_AD_* app registration (also used for SharePoint). The app
// registration must have a Web redirect URI of `<origin>/api/auth/callback` registered.
//
// Sign-in is delegated (a real user logs in); we only accept users whose email already exists in
// AuditLens (created by the Head of Audit), so the DB remains the source of truth for roles.

import { createHash, randomBytes } from "crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextRequest } from "next/server";

// User.Read lets us read the signed-in user's own profile photo from Microsoft Graph.
const SCOPE = "openid profile email User.Read";

// Trim whitespace and strip a single pair of surrounding quotes, so values like
// AZURE_AD_TENANT_ID="<guid>" in .env don't leak the quote characters into request URLs.
function cleanEnv(v?: string): string | undefined {
  if (v == null) return v;
  let s = v.trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function cfg() {
  return {
    tenant: cleanEnv(process.env.AZURE_AD_TENANT_ID),
    clientId: cleanEnv(process.env.AZURE_AD_CLIENT_ID),
    clientSecret: cleanEnv(process.env.AZURE_AD_CLIENT_SECRET),
  };
}

export function ssoConfigured(): boolean {
  const c = cfg();
  return !!(c.tenant && c.clientId && c.clientSecret);
}

// The redirect URI must match exactly what is registered in the Azure app registration. It is
// derived from the incoming request origin so it works across environments, with an env override.
export function callbackUrl(request: NextRequest): string {
  const override = process.env.AZURE_AD_REDIRECT_URI?.trim();
  if (override) return override;
  return `${request.nextUrl.origin}/api/auth/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomToken(): string {
  return b64url(randomBytes(32));
}
export function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(opts: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const { tenant, clientId } = cfg();
  const params = new URLSearchParams({
    client_id: clientId || "",
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: SCOPE,
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ id_token: string; access_token?: string }> {
  const { tenant, clientId, clientSecret } = cfg();
  const body = new URLSearchParams({
    client_id: clientId || "",
    client_secret: clientSecret || "",
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    scope: SCOPE,
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Azure token exchange ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as { id_token: string; access_token?: string };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(tenant: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
    );
  }
  return jwks;
}

// Verifies the ID token's signature (against the tenant's JWKS), issuer, audience and nonce.
export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<JWTPayload> {
  const { tenant, clientId } = cfg();
  if (!tenant || !clientId) throw new Error("Azure SSO is not configured.");
  const { payload } = await jwtVerify(idToken, getJwks(tenant), {
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    audience: clientId,
  });
  if (!payload.nonce || payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch.");
  }
  return payload;
}

export function extractEmail(claims: JWTPayload): string {
  const c = claims as Record<string, unknown>;
  const raw = c.email || c.preferred_username || c.upn || "";
  return String(raw).trim().toLowerCase();
}

export function extractName(claims: JWTPayload): string {
  const c = claims as Record<string, unknown>;
  return String(c.name || c.given_name || "").trim();
}

// Fetches the signed-in user's Microsoft profile photo (a small square) and returns it as a data
// URL suitable for an <img src>. Best-effort: returns null if the user has no photo or Graph errors.
export async function fetchProfilePhoto(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me/photos/96x96/$value", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 512 * 1024) return null; // skip if empty or unexpectedly large
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
