import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { putUploadChunk } from "@/lib/sharepoint";
import { openUploadTicket } from "@/lib/upload-token";

export const runtime = "nodejs";

/* Relays one slice of a chunked upload into the Graph session opened by /api/files/session.
   The body is the raw bytes — not multipart — so the request stays as close to the slice size as
   possible. Wrapping 3.2 MB in FormData would add overhead against a hard host limit for no gain.

   Range and total come from headers rather than the ticket so a client can resume, but the total
   is checked against the size sealed at session creation: a caller cannot open a session for a
   small file and then stream an unbounded one through it. */

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ticket = await openUploadTicket(request.headers.get("x-upload-token") || "");
  if (!ticket) {
    return NextResponse.json(
      { error: "This upload expired or is no longer valid. Please attach the file again." },
      { status: 400 },
    );
  }
  // The ticket is bearer-ish by nature, so bind it to whoever opened it.
  if (ticket.userId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const start = Number(request.headers.get("x-chunk-start"));
  const total = Number(request.headers.get("x-chunk-total"));
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: "Invalid chunk range." }, { status: 400 });
  }
  if (total !== ticket.size) {
    return NextResponse.json({ error: "Chunk range does not match the upload." }, { status: 400 });
  }

  const chunk = await request.arrayBuffer().catch(() => null);
  if (!chunk || !chunk.byteLength) {
    return NextResponse.json({ error: "Empty chunk." }, { status: 400 });
  }
  if (start + chunk.byteLength > total) {
    return NextResponse.json({ error: "Chunk overruns the declared size." }, { status: 400 });
  }

  try {
    const file = await putUploadChunk(ticket.uploadUrl, chunk, start, total);
    if (!file) return NextResponse.json({ done: false });
    return NextResponse.json({
      done: true,
      file: {
        ...file,
        by: session.id,
        byName: session.name,
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 502 },
    );
  }
}
