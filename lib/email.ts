type WelcomeEmailParams = {
  to: string;
  name: string;
  tempPassword: string;
  loginUrl: string;
};

function appOrigin(request: Request) {
  const fromEnv = process.env.APP_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin.replace(/\/$/, "");

  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      const url = new URL(referer);
      return `${url.protocol}//${url.host}`;
    } catch {
      /* ignore */
    }
  }

  return "http://localhost:3000";
}

export function loginUrlFromRequest(request: Request) {
  return `${appOrigin(request)}/login`;
}

function brandedEmail(opts: {
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const cta = opts.ctaUrl
    ? `<div style="margin:24px 0 6px"><a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#1f8a5b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(opts.ctaLabel || "Open AuditLens")}</a></div>`
    : "";
  return `
  <div style="background:#f2f7f5;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e1eae7">
      <div style="background:#0d5a47;padding:20px 28px;color:#ffffff">
        <div style="font-size:19px;font-weight:700;letter-spacing:.2px">AuditLens</div>
        <div style="font-size:12px;opacity:.85;margin-top:2px">Audit Management System</div>
      </div>
      <div style="padding:26px 28px;color:#19302a;font-size:14px;line-height:1.6">
        <div style="font-size:16px;font-weight:700;color:#0d5a47;margin-bottom:10px">${escapeHtml(opts.heading)}</div>
        ${opts.bodyHtml}
        ${cta}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #e1eae7;color:#64807a;font-size:12px;line-height:1.5">
        This is an automated message from <strong>AuditLens</strong>. Please do not reply to this email.
      </div>
    </div>
  </div>`.trim();
}

export async function sendWelcomeEmail(params: WelcomeEmailParams) {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const from = process.env.SENDGRID_SENDER?.trim();

  if (!apiKey || !from) {
    return {
      sent: false as const,
      error: "Email is not configured (SENDGRID_API_KEY / SENDGRID_SENDER).",
    };
  }

  const subject = "Your AuditLens account has been created";
  const text = [
    `Hello ${params.name},`,
    "",
    "An account has been created for you on AuditLens.",
    "",
    `Sign in: ${params.loginUrl}`,
    `Email: ${params.to}`,
    `Temporary password: ${params.tempPassword}`,
    "",
    "On your first sign-in you will be asked to choose your own password.",
    "",
    "If you did not expect this email, please contact your Head of Audit.",
  ].join("\n");

  const html = brandedEmail({
    heading: "Your account is ready",
    bodyHtml: `
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>An account has been created for you on <strong>AuditLens</strong>. Use the temporary password below to sign in.</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0">
        <tr><td style="padding:6px 0;color:#64807a">Email</td><td style="padding:6px 0;font-weight:600">${escapeHtml(params.to)}</td></tr>
        <tr><td style="padding:6px 0;color:#64807a">Temporary password</td><td style="padding:6px 0"><code style="background:#f2f7f5;padding:3px 8px;border-radius:6px;font-weight:700">${escapeHtml(params.tempPassword)}</code></td></tr>
      </table>
      <p style="color:#64807a;font-size:13px">On your first sign-in you'll be asked to choose your own password.</p>
      <p style="color:#64807a;font-size:13px">If you did not expect this email, please contact your Head of Audit.</p>`,
    ctaLabel: "Sign in to AuditLens",
    ctaUrl: params.loginUrl,
  });

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to, name: params.name }] }],
      from: { email: from, name: "AuditLens" },
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      sent: false as const,
      error: detail || `SendGrid returned ${res.status}.`,
    };
  }

  return { sent: true as const };
}

export async function sendNotificationEmail(params: {
  to: string[];
  subject: string;
  text: string;
  ctaUrl?: string;
  ctaLabel?: string;
}) {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const from = process.env.SENDGRID_SENDER?.trim();
  const recipients = params.to.filter(Boolean);
  if (!apiKey || !from) {
    return { sent: false as const, error: "Email is not configured." };
  }
  if (!recipients.length) {
    return { sent: false as const, error: "No recipients." };
  }

  const appUrl = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const ctaUrl = params.ctaUrl?.trim() || loginUrl;
  const ctaLabel = params.ctaLabel?.trim() || "Sign in to AuditLens";
  // Preserve line breaks in the notification text as HTML paragraphs.
  const bodyHtml = escapeHtml(params.text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = brandedEmail({
    heading: params.subject.replace(/^AuditLens\s*[—-]\s*/i, ""),
    bodyHtml,
    ctaLabel,
    ctaUrl,
  });

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: recipients.map((email) => ({ to: [{ email }] })),
      from: { email: from, name: "AuditLens" },
      subject: params.subject,
      content: [
        { type: "text/plain", value: `${params.text}\n\nSign in to AuditLens: ${loginUrl}` },
        { type: "text/html", value: html },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false as const, error: detail || `SendGrid returned ${res.status}.` };
  }

  return { sent: true as const };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
