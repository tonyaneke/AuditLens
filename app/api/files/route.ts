import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { sharepointConfigured, uploadToSharePoint } from "@/lib/sharepoint";

export const runtime = "nodejs";

/* This route only ever sees small files now — the client sends anything at or above ~3 MB to
   /api/files/session + /api/files/chunk instead, because the host refuses a bigger request body
   before this handler runs. The limit stays generous rather than exact: it is a backstop for a
   direct caller, not the number the UI advertises (see MAX_BYTES in ../session/route.ts). */
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

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  const obsId = String(form.get("obsId") || "misc");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 20 MB limit." }, { status: 413 });
  }

  try {
    const data = await file.arrayBuffer();
    const result = await uploadToSharePoint({
      obsId,
      fileName: file.name || "file",
      contentType: file.type || "application/octet-stream",
      data,
    });
    return NextResponse.json({
      file: {
        ...result,
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
