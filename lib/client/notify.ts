"use client";

// Best-effort email fan-out (port of legacy emailNotify). The CTA link uses the browser's
// real origin so emails point at the live host regardless of server env.
export function emailNotify(
  to: string | string[],
  subject?: string,
  text?: string,
  ctaUrl?: string,
): void {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return;
  let cta = ctaUrl;
  if (!cta) {
    try {
      cta = location.origin + "/";
    } catch {
      cta = "";
    }
  }
  try {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: list,
        subject: subject || "AuditLens notification",
        text: text || "",
        ctaUrl: cta,
      }),
    }).catch(() => {});
  } catch {
    /* best effort */
  }
}

/** Consolidated digest for an admin who is both Head of Audit and Action Owner — sent
 * server-side by /api/notify (SendGrid credentials never reach the client). Best effort. */
export function emailAdminConsolidated(params: {
  to: string;
  name: string;
  headNotifications: { title: string; link: string }[];
  ownerNotifications: { title: string; link: string }[];
}): void {
  if (!params.to) return;
  try {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consolidated: params }),
    }).catch(() => {});
  } catch {
    /* best effort */
  }
}
