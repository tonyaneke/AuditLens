import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/azure",
  "/api/auth/callback",
  "/api/auth/dev-login",
  "/api/branding",
  "/brief",
  "/api/cron",
  /* The Action Owner Guide is readable without a session, because the people it is written for are
     department heads who have not been given accounts yet — the guide explaining how to sign in is
     no use if reading it requires being signed in.

     ONLY THIS ONE DOCUMENT. /docs/user-manual.html is deliberately absent and must stay absent: its
     Figure 11 is the Settings page, which is a screenshot of the live user directory — thirteen
     people with their names, departments, roles, work addresses and two personal Gmail addresses.
     Publishing that is not the same decision as publishing the owner guide, whose figures carry
     staff names and observation titles but no addresses. Listing the file explicitly rather than
     the "/docs" prefix is what keeps the two apart: a prefix would take the whole directory, and
     the next document built into it would go public without anyone choosing that. */
  "/docs/action-owner-manual.html",
  // The embedded typeface, which the guide loads relatively. Without it the font 302s to /login and
  // the page silently falls back to system-ui for a signed-out reader. Written by
  // scripts/build-docs.mts; it is the only file in that directory.
  "/docs/assets/manual-jakarta.woff2",
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/* Content-Security-Policy — built per request because it carries a one-time nonce.
   Lives here rather than in next.config.ts: a nonce cannot exist in static config, and setting
   the header in both places would send two CSP headers, which browsers enforce as the
   INTERSECTION of the two — silently breaking whichever directive is stricter. The other
   security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS) have
   no per-request component and stay in next.config.ts.

   script-src: 'nonce-…' + 'strict-dynamic' and NO 'unsafe-inline'. This is the change that
   closes what the previous policy could not — an injected inline <script> no longer executes,
   because it cannot guess the nonce. Under 'strict-dynamic' the host allowlist is ignored for
   scripts: only nonce-carrying scripts run, plus whatever they load themselves (which is how
   Next's bootstrap pulls in its chunks).

   style-src deliberately KEEPS 'unsafe-inline'. Nonces apply to <style> ELEMENTS, not to inline
   `style` ATTRIBUTES, which this app uses throughout; nonce-ing styles would blank the UI while
   buying very little, since a style attribute cannot execute script. */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only — React uses eval to rebuild server error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Profile photos are ordinary URLs now (QA-19); data: remains for the select-arrow SVG in
    // globals.css, and blob: for locally previewed uploads.
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Graph, SendGrid and Gemini are all called server-side — the browser never goes off-origin.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The audit's stated concern: clickjacking against the approval / close-out flows.
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/* QA-016 — the audit found `Access-Control-Allow-Origin: *` on the document. Nothing in this
   codebase sets it, so there is no "app shell" occurrence to delete: it is added by the
   hosting edge. Strip it on the way out so it is gone wherever the app is the source. If a
   post-deploy header capture still shows it, the remaining source is platform configuration
   rather than code. The API sets no Allow-Credentials, so the wildcard is not exploitable
   today — it simply should not be advertised. */
function harden(response: NextResponse, csp: string) {
  response.headers.delete("Access-Control-Allow-Origin");
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

async function verifySessionToken(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

/** Pass the nonce through on the REQUEST as well as the response. Next reads it back off the
 *  request's Content-Security-Policy header during render and stamps it onto every script tag
 *  it emits, so no component has to thread it manually. */
function forward(request: NextRequest, nonce: string, csp: string) {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  return harden(NextResponse.next({ request: { headers } }), csp);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  if (isPublic(pathname)) {
    return forward(request, nonce, csp);
  }

  const token = request.cookies.get("ams_session")?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return harden(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), csp);
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return harden(NextResponse.redirect(loginUrl), csp);
  }

  if (pathname === "/login") {
    return harden(NextResponse.redirect(new URL("/", request.url)), csp);
  }

  return forward(request, nonce, csp);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|audit-bot.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
