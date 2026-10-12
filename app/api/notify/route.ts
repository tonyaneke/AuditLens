import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import {
  buildBriefEmailHtml,
  sendAdminConsolidatedEmail,
  sendNotificationEmail,
} from "@/lib/email";

// Best-effort email notifications (assignment, approval-needed, update-requested).
// In-app notifications are stored in the workspace; this only fans out email.

/* Development never e-mails anyone — except the addresses in NOTIFY_DEV_ALLOW (comma-separated,
   e.g. in .env.local). That is what lets a developer test a flow end to end against their own
   inbox while every other recipient of the same send stays suppressed: the list FILTERS the
   recipients, it does not switch suppression off. Ignored outside development. */
function devAllowList(): Set<string> | null {
  if (process.env.NODE_ENV !== "development") return null;
  return new Set(
    String(process.env.NOTIFY_DEV_ALLOW || "")
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x.includes("@")),
  );
}

export async function POST(request: Request) {
  try {
    await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Development: never send real email. Every notify flow still runs (and the in-app bell
  // notifications live in the workspace, untouched by this) — only the email fan-out is
  // suppressed so test data doesn't hit real inboxes. Allow-listed addresses are the one exception.
  const allow = devAllowList();
  if (allow && !allow.size) {
    return NextResponse.json({ sent: false, suppressed: "development" });
  }
  const permitted = (address: string) => !allow || allow.has(address.trim().toLowerCase());

  let body: {
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    ctaUrl?: unknown;
    ctaLabel?: unknown;
    excoBrief?: unknown;
    consolidated?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Consolidated digest for admin users who act as both Head of Audit and Action Owner.
  const cons = body.consolidated as
    | { to?: unknown; name?: unknown; headNotifications?: unknown; ownerNotifications?: unknown }
    | undefined;
  if (cons && typeof cons === "object") {
    const asList = (v: unknown) =>
      Array.isArray(v)
        ? v
            .filter((x): x is { title?: unknown; link?: unknown } => !!x && typeof x === "object")
            .map((x) => ({ title: String(x.title || ""), link: String(x.link || "") }))
        : [];
    const to = typeof cons.to === "string" && cons.to.includes("@") ? cons.to : "";
    if (!to) return NextResponse.json({ sent: false, error: "Recipient required." });
    if (!permitted(to)) return NextResponse.json({ sent: false, suppressed: "development" });
    const result = await sendAdminConsolidatedEmail({
      to,
      name: String(cons.name || ""),
      headNotifications: asList(cons.headNotifications),
      ownerNotifications: asList(cons.ownerNotifications),
    });
    return NextResponse.json({ sent: result.sent, error: result.sent ? undefined : result.error });
  }

  const requested = Array.isArray(body.to)
    ? body.to.filter((x): x is string => typeof x === "string" && x.includes("@"))
    : [];
  const to = requested.filter(permitted);
  if (requested.length && !to.length) return NextResponse.json({ sent: false, suppressed: "development" });
  const subject = typeof body.subject === "string" ? body.subject : "AuditLens notification";
  const text = typeof body.text === "string" ? body.text : "";
  const ctaUrl = typeof body.ctaUrl === "string" ? body.ctaUrl : undefined;
  const ctaLabel = typeof body.ctaLabel === "string" ? body.ctaLabel : undefined;

  // When an Executive Assurance Brief snapshot + link is supplied, render the rich brief email.
  let bodyHtml: string | undefined;
  const eb = body.excoBrief as { snapshot?: unknown; link?: unknown } | undefined;
  if (eb && typeof eb === "object" && eb.snapshot && typeof eb.link === "string") {
    bodyHtml = buildBriefEmailHtml(eb.snapshot as Parameters<typeof buildBriefEmailHtml>[0], eb.link);
  }

  const result = await sendNotificationEmail({ to, subject, text, ctaUrl, ctaLabel, bodyHtml });
  return NextResponse.json({
    sent: result.sent,
    error: result.sent ? undefined : result.error,
  });
}
