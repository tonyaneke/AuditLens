import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { openSharePointUploadSession, sharepointConfigured } from "@/lib/sharepoint";
import { sealUploadTicket } from "@/lib/upload-token";

export const runtime = "nodejs";

/* Opens a chunked upload. See lib/upload-token.ts for why the Graph session is handed back as a
   sealed ticket rather than stored server-side.

   CHUNK_BYTES is the size the browser must slice to. It is bounded from both directions:
     · below ~4.5 MB, because the host in front of this app refuses a larger request body
       outright (a 413 the route never sees);
     · a multiple of 320 KiB, because Graph rejects any non-final chunk that is not.
   3.2 MB = 10 × 320 KiB satisfies both with room for request overhead. */
const CHUNK_BYTES = 10 * 320 * 1024;

/** The real ceiling now — no longer the 20 MB that was never reachable in practice. */
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!sharepointConfigured()) {
    return NextResponse.json(
      { error: "SharePoint is not configured (AZURE_AD_* env vars)." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON." }, { status: 400 });

  const fileName = String(body.fileName || "file");
  const obsId = String(body.obsId || "misc");
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "A positive file size is required." }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.` },
      { status: 413 },
    );
  }

  try {
    const uploadUrl = await openSharePointUploadSession({ obsId, fileName });
    const token = await sealUploadTicket({ uploadUrl, userId: session.id, size, fileName });
    return NextResponse.json({ token, chunkSize: CHUNK_BYTES });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start the upload." },
      { status: 502 },
    );
  }
}
