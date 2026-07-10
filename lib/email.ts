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

  const html = `
    <p>Hello ${escapeHtml(params.name)},</p>
    <p>An account has been created for you on <strong>AuditLens</strong>.</p>
    <p><strong>Sign in:</strong> <a href="${escapeHtml(params.loginUrl)}">${escapeHtml(params.loginUrl)}</a><br>
    <strong>Email:</strong> ${escapeHtml(params.to)}<br>
    <strong>Temporary password:</strong> <code>${escapeHtml(params.tempPassword)}</code></p>
    <p>On your first sign-in you will be asked to choose your own password.</p>
    <p>If you did not expect this email, please contact your Head of Audit.</p>
  `.trim();

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
  const html = `
    <p>${escapeHtml(params.text)}</p>
    <p style="margin:20px 0">
      <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#1f8a5b;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Sign in to AuditLens</a>
    </p>
    <p style="color:#64807a;font-size:12px">Or open ${escapeHtml(loginUrl)}</p>
  `.trim();

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
