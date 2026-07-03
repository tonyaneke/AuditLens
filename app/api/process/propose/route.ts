import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { defaultWorkspaceData } from "@/lib/db-data";
import {
  analysePdfWithGemini,
  generateJsonWithGemini,
  MAX_PROCESS_PDF_BYTES,
} from "@/lib/gemini-document";
import { buildProposeProcessPrompt } from "@/lib/process-prompts";
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
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const unit = String(form.get("unit") || "").trim();
  const sopTitle = String(form.get("sopTitle") || "").trim();
  const findingsList = String(form.get("findings") || "").trim();

  if (!unit || !findingsList) {
    return NextResponse.json(
      { error: "Unit and findings are required." },
      { status: 400 },
    );
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: "default" } });
  const org =
    (row?.data as { org?: string } | null)?.org ||
    defaultWorkspaceData().org ||
    "Internal Audit";

  const pdfBase64 = String(form.get("pdfBase64") || "").trim();
  let pdfBuffer: Buffer | null = null;

  if (pdfBase64) {
    pdfBuffer = Buffer.from(pdfBase64, "base64");
    if (pdfBuffer.length > MAX_PROCESS_PDF_BYTES) {
      return NextResponse.json({ error: "Stored PDF is too large." }, { status: 400 });
    }
  }

  const prompt = buildProposeProcessPrompt(
    org,
    unit,
    sopTitle,
    findingsList,
    Boolean(pdfBuffer?.length),
  );

  try {
    const analysis = pdfBuffer?.length
      ? await analysePdfWithGemini(pdfBuffer, prompt)
      : await generateJsonWithGemini(prompt);

    return NextResponse.json({ analysis });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not generate proposed process.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
