import { generateAi } from "@/lib/ai-provider";

function parseObject(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

/** Read a PDF with the AI (Gemini first, OpenAI as fallback) and return its JSON answer. */
export async function analysePdfWithAi(
  pdfBuffer: Buffer,
  prompt: string,
  fileName?: string,
): Promise<Record<string, unknown>> {
  const { text } = await generateAi({
    prompt,
    json: true,
    ...(pdfBuffer.length ? { pdf: { data: pdfBuffer, fileName } } : {}),
  });
  return parseObject(text);
}

export async function generateJsonWithAi(prompt: string): Promise<Record<string, unknown>> {
  const { text } = await generateAi({ prompt, json: true });
  return parseObject(text);
}

export const MAX_PROCESS_PDF_BYTES = 12 * 1024 * 1024;
/** Store PDF on review for later propose step (base64 in workspace JSON). */
export const MAX_STORED_PDF_BYTES = 3 * 1024 * 1024;
