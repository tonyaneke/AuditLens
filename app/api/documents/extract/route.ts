import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import {
  extractDocumentText,
  MAX_DOCUMENT_BYTES,
} from "@/lib/document-extract";

export async function POST(request: Request) {
  try {
    await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const fileName = file.name || "document";
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload PDF or DOCX." },
      { status: 400 },
    );
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: "File is too large. Maximum size is 12 MB." },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractDocumentText(buffer, fileName);
    return NextResponse.json({
      text,
      fileName,
      charCount: text.length,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not read the document.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
