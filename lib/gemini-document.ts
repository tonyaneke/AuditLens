import { GoogleGenerativeAI } from "@google/generative-ai";

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function geminiModel(jsonMode: boolean) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to .env and restart the dev server.",
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    ...(jsonMode
      ? { generationConfig: { responseMimeType: "application/json" } }
      : {}),
  });
}

export async function analysePdfWithGemini(
  pdfBuffer: Buffer,
  prompt: string,
): Promise<Record<string, unknown>> {
  const model = geminiModel(true);
  const parts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { text: string }
  > = [];

  if (pdfBuffer.length) {
    parts.push({
      inlineData: {
        mimeType: "application/pdf",
        data: pdfBuffer.toString("base64"),
      },
    });
  }

  parts.push({ text: prompt });

  const result = await model.generateContent(parts);
  return parseGeminiJson(result.response.text()?.trim() ?? "");
}

export async function generateJsonWithGemini(
  prompt: string,
): Promise<Record<string, unknown>> {
  const model = geminiModel(true);
  const result = await model.generateContent(prompt);
  return parseGeminiJson(result.response.text()?.trim() ?? "");
}

function parseGeminiJson(text: string): Record<string, unknown> {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error("Gemini returned invalid JSON.");
  }
}

export const MAX_PROCESS_PDF_BYTES = 12 * 1024 * 1024;
/** Store PDF on review for later propose step (base64 in workspace JSON). */
export const MAX_STORED_PDF_BYTES = 3 * 1024 * 1024;
