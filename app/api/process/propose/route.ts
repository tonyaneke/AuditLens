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

  // The client no longer holds the stored SOP PDF (/api/data strips it) — when it sends a
  // reviewId instead, extract the base64 for just that review inside Postgres.
  let pdfBase64 = String(form.get("pdfBase64") || "").trim();
  const reviewId = String(form.get("reviewId") || "").trim();
  if (!pdfBase64 && reviewId) {
    try {
      const rows = await prisma.$queryRaw<{ pdf: string | null }[]>`
        SELECT r->>'sopPdfBase64' AS pdf
        FROM "WorkspaceData", jsonb_array_elements(data::jsonb->'processReviews') AS r
        WHERE id = 'default' AND r->>'id' = ${reviewId}
        LIMIT 1`;
      pdfBase64 = rows[0]?.pdf || "";
    } catch {
      /* proceed without the PDF — the prompt falls back to findings only */
    }
  }
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
