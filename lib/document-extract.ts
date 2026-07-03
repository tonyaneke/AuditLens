import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_EXTRACT_CHARS = 120_000;

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
): Promise<string> {
  const lower = fileName.toLowerCase();

  let text = "";
  if (lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      text = parsed.text || "";
    } finally {
      await parser.destroy();
    }
  } else if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else {
    throw new Error("Unsupported file type. Upload a PDF or DOCX file.");
  }

  text = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    throw new Error(
      "No readable text was found in this document. Try a text-based PDF or DOCX.",
    );
  }

  if (text.length > MAX_EXTRACT_CHARS) {
    text = `${text.slice(0, MAX_EXTRACT_CHARS)}\n\n[Document truncated for analysis.]`;
  }

  return text;
}

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
