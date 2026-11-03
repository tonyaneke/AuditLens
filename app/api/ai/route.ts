import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { AiNotConfiguredError, generateAi } from "@/lib/ai-provider";

type AiMode = "json" | "text";

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
    // Gemini first, OpenAI when Gemini fails — the provider is not the client's concern.
    const { text } = await generateAi({ prompt, json: mode === "json" });
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "AI request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
