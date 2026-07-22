import { NextResponse, type NextRequest } from "next/server";
import {
  authorizeUrl,
  callbackUrl,
  pkceChallenge,
  randomToken,
  ssoConfigured,
} from "@/lib/azure-sso";

export const runtime = "nodejs";

// Begins Microsoft SSO: generate state/nonce/PKCE, stash them in short-lived cookies, and redirect
// the browser to the Microsoft authorization endpoint.
export async function GET(request: NextRequest) {
  if (!ssoConfigured()) {
    return NextResponse.redirect(new URL("/login?error=sso_unconfigured", request.url));
  }

  const nextParam = request.nextUrl.searchParams.get("next") || "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const redirectUri = callbackUrl(request);

  const res = NextResponse.redirect(
    authorizeUrl({ redirectUri, state, nonce, codeChallenge: pkceChallenge(verifier) }),
  );
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes to complete the round-trip
  };
  res.cookies.set("azure_state", state, opts);
  res.cookies.set("azure_nonce", nonce, opts);
  res.cookies.set("azure_verifier", verifier, opts);
  res.cookies.set("azure_next", next, opts);
  return res;
}
