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
];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/* QA-016 — the audit found `Access-Control-Allow-Origin: *` on the document. Nothing in this
   codebase sets it, so there is no "app shell" occurrence to delete: it is added by the
   hosting edge. Strip it on the way out so it is gone wherever the app is the source. If a
   post-deploy header capture still shows it, the remaining source is platform configuration
   rather than code. The API sets no Allow-Credentials, so the wildcard is not exploitable
   today — it simply should not be advertised. */
function harden(response: NextResponse) {
  response.headers.delete("Access-Control-Allow-Origin");
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return harden(NextResponse.next());
  }

  const token = request.cookies.get("ams_session")?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    if (pathname.startsWith("/api/")) {
      return harden(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return harden(NextResponse.redirect(loginUrl));
  }

  if (pathname === "/login") {
    return harden(NextResponse.redirect(new URL("/", request.url)));
  }

  return harden(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|audit-bot.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
