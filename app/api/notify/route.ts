import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { sendNotificationEmail } from "@/lib/email";

// Best-effort email notifications (assignment, approval-needed, update-requested).
// In-app notifications are stored in the workspace; this only fans out email.
export async function POST(request: Request) {
  try {
    await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { to?: unknown; subject?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const to = Array.isArray(body.to)
    ? body.to.filter((x): x is string => typeof x === "string" && x.includes("@"))
    : [];
  const subject = typeof body.subject === "string" ? body.subject : "AuditLens notification";
  const text = typeof body.text === "string" ? body.text : "";

  const result = await sendNotificationEmail({ to, subject, text });
  return NextResponse.json({
    sent: result.sent,
    error: result.sent ? undefined : result.error,
  });
}
