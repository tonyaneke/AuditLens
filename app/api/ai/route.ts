import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

type AiMode = "json" | "text";

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GEMINI_API_KEY is not configured. Add it to .env and restart the dev server.",
      },
      { status: 503 },
    );
  }

  let body: { prompt?: string; mode?: AiMode };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  const mode: AiMode = body.mode === "text" ? "text" : "json";

  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      ...(mode === "json"
        ? { generationConfig: { responseMimeType: "application/json" } }
        : {}),
    });

    const result = await model.generateContent(prompt);
    let text = result.response.text()?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "Gemini returned an empty response." },
        { status: 502 },
      );
    }

    if (mode === "json") {
      text = stripCodeFences(text);
      try {
        JSON.parse(text);
      } catch {
        return NextResponse.json(
          {
            error: "Gemini returned invalid JSON.",
            text: text.slice(0, 500),
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({ text });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gemini request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
