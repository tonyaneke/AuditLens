import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { defaultWorkspaceData } from "@/lib/db-data";
import {
  analysePdfWithGemini,
  MAX_PROCESS_PDF_BYTES,
  MAX_STORED_PDF_BYTES,
} from "@/lib/gemini-document";
import { buildProcReviewPrompt } from "@/lib/process-prompts";
import { prisma } from "@/lib/prisma";

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
  const unit = String(form.get("unit") || "").trim();
  const sopTitle = String(form.get("sopTitle") || "").trim();
  const period = String(form.get("period") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF uploaded." }, { status: 400 });
  }
  if (!unit) {
    return NextResponse.json({ error: "Business unit is required." }, { status: 400 });
  }

  const fileName = file.name || "document.pdf";
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Upload a PDF file." }, { status: 400 });
  }
  if (file.size > MAX_PROCESS_PDF_BYTES) {
    return NextResponse.json(
      { error: "PDF is too large. Maximum size is 12 MB." },
      { status: 400 },
    );
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: "default" } });
  const org =
    (row?.data as { org?: string } | null)?.org ||
    defaultWorkspaceData().org ||
    "Internal Audit";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const prompt = buildProcReviewPrompt(org, unit, sopTitle || fileName.replace(/\.pdf$/i, ""));
    const analysis = await analysePdfWithGemini(buffer, prompt);

    const sopPdfBase64 =
      buffer.length <= MAX_STORED_PDF_BYTES
        ? buffer.toString("base64")
        : undefined;

    return NextResponse.json({
      analysis,
      fileName,
      sopTitle: sopTitle || fileName.replace(/\.pdf$/i, ""),
      period,
      unit,
      sopPdfStored: Boolean(sopPdfBase64),
      sopPdfBase64,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not analyse the PDF.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
