import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/* QA defect #19 — profile photos were shipped as inline base64 data URLs.
 *
 * A Microsoft profile photo is fetched server-side on SSO sign-in and stored as a data URL (up
 * to 512 KB raw, so ~683 KB of base64). That string was embedded in /api/directory, /api/users
 * and /api/auth/me, which meant: ~109 KB added to every directory fetch for nine users, sent
 * again on every refetch, and impossible for the browser to cache — a data URL is part of the
 * JSON body, not a resource with its own URL and cache entry.
 *
 * Serving them here instead makes each photo a real, individually cacheable resource. The URL
 * carries a version stamp from the user's updatedAt, so it is immutable for as long as the
 * photo is unchanged and re-fetched exactly once when it changes. Payload cost after the first
 * load is zero.
 *
 * The bytes still live in Postgres — this is deliberately not a move to blob storage, which
 * would add a dependency and a credential for 109 KB of data. What was actually broken was
 * cacheability, and that is fixed by giving each photo a URL.
 */

type Params = { params: Promise<{ id: string }> };

// [\s\S] rather than the /s flag — the project targets ES2017.
const DATA_URL = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/;

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActiveSession();
  } catch {
    return new NextResponse(null, { status: 401 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { photo: true, updatedAt: true },
  });
  if (!user?.photo) return new NextResponse(null, { status: 404 });

  const m = DATA_URL.exec(user.photo);
  if (!m) return new NextResponse(null, { status: 404 });

  const contentType = m[1] || "image/jpeg";
  const body = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");

  // Strong validator from the row's version, so a conditional request costs 304 and no body.
  const etag = `"${id}-${user.updatedAt.getTime()}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      ETag: etag,
      // `private`: this is an authenticated resource, so shared caches must not store it.
      // `immutable` is safe because the URL is version-stamped — a changed photo is a new URL.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
