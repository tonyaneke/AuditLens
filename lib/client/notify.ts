"use client";

/** Outcome of an attempted send. `sent` is what the server actually did — not what we asked
 * for. /api/notify deliberately returns `{sent:false, suppressed:"development"}` in dev, so a
 * caller that reports "reminder sent" without reading this will lie to the user. */
export type NotifyResult = { sent: boolean; reason?: string };

// Email fan-out (port of legacy emailNotify). The CTA link uses the browser's real origin so
// emails point at the live host regardless of server env.
//
// Still best-effort in the sense that it never throws or rejects — but it now RESOLVES with the
// outcome so callers that report delivery to a user can await it and tell the truth. Callers
// that genuinely don't care may keep ignoring the return value.
export function emailNotify(
  to: string | string[],
  subject?: string,
  text?: string,
  ctaUrl?: string,
  ctaLabel?: string,
): Promise<NotifyResult> {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return Promise.resolve({ sent: false, reason: "no recipient address" });
  let cta = ctaUrl;
  if (!cta) {
    try {
      cta = location.origin + "/";
    } catch {
      cta = "";
    }
  }
  try {
    return fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: list,
        subject: subject || "AuditLens notification",
        text: text || "",
        ctaUrl: cta,
        ctaLabel: ctaLabel || undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return { sent: false, reason: `mail service returned ${res.status}` };
        const data = (await res.json().catch(() => ({}))) as {
          sent?: boolean;
          error?: string;
          suppressed?: string;
        };
        if (data.sent) return { sent: true };
        return {
          sent: false,
          reason: data.suppressed
            ? `suppressed (${data.suppressed})`
            : data.error || "mail service reported no send",
        };
      })
      .catch(() => ({ sent: false, reason: "network error" }));
  } catch {
    return Promise.resolve({ sent: false, reason: "network error" });
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
