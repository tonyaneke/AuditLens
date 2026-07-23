// Sender for all AuditLens mail. Must be a VERIFIED SendGrid sender identity (or an address on
// an authenticated domain) or SendGrid rejects the send with a 403 and no mail goes out.
// SENDGRID_SENDER in .env overrides; defaults to the authenticated auditlens address.
const SENDER_EMAIL = process.env.SENDGRID_SENDER?.trim() || "auditlens@credicorp.org";

type WelcomeEmailParams = {
  to: string;
  name: string;
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
  const from = SENDER_EMAIL;

  if (!apiKey) {
    return {
      sent: false as const,
      error: "Email is not configured (SENDGRID_API_KEY).",
    };
  }

  const subject = "Your AuditLens account has been created";
  const text = [
    `Hello ${params.name},`,
    "",
    "An account has been created for you on AuditLens.",
    "",
    `Sign in with your Microsoft (organisation) account at: ${params.loginUrl}`,
    `Account email: ${params.to}`,
    "",
    "Choose \"Sign in with Microsoft\" and use your work account — there is no separate password.",
    "",
    "If you did not expect this email, please contact your Head of Audit.",
  ].join("\n");

  const html = brandedEmail({
    heading: "Your account is ready",
    bodyHtml: `
      <p>Hello ${escapeHtml(params.name)},</p>
      <p>An account has been created for you on <strong>AuditLens</strong>. Sign in with your Microsoft (organisation) account — there is no separate password to set.</p>
      <table style="width:100%;border-collapse:collapse;margin:14px 0">
        <tr><td style="padding:6px 0;color:#64807a">Account email</td><td style="padding:6px 0;font-weight:600">${escapeHtml(params.to)}</td></tr>
      </table>
      <p style="color:#64807a;font-size:13px">On the sign-in page choose <strong>Sign in with Microsoft</strong> and use your work account.</p>
      <p style="color:#64807a;font-size:13px">If you did not expect this email, please contact your Head of Audit.</p>`,
    ctaLabel: "Sign in with Microsoft",
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

// Rich, email-safe HTML for the Executive Assurance Brief — mirrors the public /brief page
// (teal hero + condition-coloured KPI cards + numbered matters) with the confidential footer.
type BriefSnapshot = {
  org?: string; period?: string; remRate?: number; closed?: number; total?: number;
  kpis?: { keyOpen?: number; keyOverdue?: number; overdue?: number; unmit?: number; extOpen?: number; extOverdueN?: number };
  matters?: string[];
};
export function buildBriefEmailHtml(s: BriefSnapshot, link: string) {
  const org = s.org || "";
  const period = String(s.period || "").replace(/^as at\s+/i, "");
  const k = s.kpis || {};
  const matters = Array.isArray(s.matters) ? s.matters : [];
  const tones: Record<string, [string, string]> = {
    good: ["#2e7d32", "#f3faf4"], warn: ["#a67c00", "#fdfaf0"], bad: ["#b00020", "#fdf4f5"], neutral: ["#0d5a47", "#f2f7f5"],
  };
  const cell = (label: string, num: string | number, sub: string, tone: string) => {
    const [fg, bg] = tones[tone] || tones.neutral;
    return `<td width="20%" valign="top" style="padding:4px"><div style="background:${bg};border:1px solid #e1eae7;border-radius:10px;padding:11px 11px"><div style="font-size:11px;font-weight:700;color:#19302a">${escapeHtml(label)}</div><div style="font-size:21px;font-weight:800;color:${fg};line-height:1.1;margin-top:6px">${escapeHtml(String(num))}</div><div style="font-size:10px;color:#64807a;margin-top:3px">${escapeHtml(sub)}</div></div></td>`;
  };
  const remTone = (s.remRate || 0) >= 70 ? "good" : (s.remRate || 0) >= 40 ? "warn" : "bad";
  return `
  <div style="background:#f2f7f5;padding:20px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:680px;margin:0 auto">
      <div style="background:#0d5a47;border-radius:14px;padding:22px 24px;color:#ffffff">
        <table width="100%" role="presentation"><tr>
          <td valign="top">
            <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8fd3c4;font-weight:700">Internal Audit · Executive Assurance Brief</div>
            <div style="font-size:20px;font-weight:800;margin-top:5px">${escapeHtml(org)}</div>
            <div style="font-size:12.5px;color:#cfe7de;margin-top:5px">As at ${escapeHtml(period)}</div>
          </td>
          <td valign="top" align="right" width="96">
            <div style="font-size:34px;font-weight:800;line-height:1">${escapeHtml(String(s.remRate || 0))}%</div>
            <div style="font-size:11px;color:#cfe7de">issues remediated</div>
          </td>
        </tr></table>
      </div>
      <table width="100%" role="presentation" style="border-collapse:separate;margin-top:12px"><tr>
        ${cell("High Open", k.keyOpen || 0, `${k.keyOverdue || 0} overdue`, (k.keyOpen || 0) ? "warn" : "good")}
        ${cell("Remediation rate", `${s.remRate || 0}%`, `${s.closed || 0} of ${s.total || 0} closed`, remTone)}
        ${cell("Overdue actions", k.overdue || 0, "past target date", (k.overdue || 0) ? "bad" : "good")}
        ${cell("Unmitigated fraud", k.unmit || 0, "High/Extreme residual", (k.unmit || 0) ? "bad" : "good")}
        ${cell("External findings", k.extOpen || 0, `${k.extOverdueN || 0} overdue`, (k.extOpen || 0) ? "warn" : "good")}
      </tr></table>
      <div style="background:#ffffff;border:1px solid #e1eae7;border-radius:12px;padding:16px 20px;margin-top:12px">
        <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0d5a47;margin-bottom:8px">Matters requiring EXCO attention</div>
        <ol style="margin:0;padding-left:20px;color:#19302a;font-size:13.5px;line-height:1.55">${matters.map((t) => `<li style="margin:7px 0">${escapeHtml(t)}</li>`).join("")}</ol>
      </div>
      <p style="font-size:13px;color:#334155;margin:16px 4px 4px">The full Executive Assurance Brief — critical &amp; high-risk issues, recurring risk themes, unmitigated fraud risks and regulatory exposure — is available at the link below. Open it in your web browser to view the complete brief.</p>
      <div style="margin:10px 4px 4px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f8a5b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px">Open the Executive Assurance Brief</a></div>
      <p style="font-size:11px;color:#94a3b8;margin:16px 4px 0;border-top:1px solid #e2e8f0;padding-top:10px">Prepared by Internal Audit, ${escapeHtml(org)} · ${escapeHtml(period)} · Strictly confidential — for the Managing Director &amp; Executive Committee.</p>
    </div>
  </div>`.trim();
}

export async function sendNotificationEmail(params: {
  to: string[];
  subject: string;
  text: string;
  ctaUrl?: string;
  ctaLabel?: string;
  bodyHtml?: string;
}) {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const from = SENDER_EMAIL;
  const recipients = params.to.filter(Boolean);
  if (!apiKey) {
    return { sent: false as const, error: "Email is not configured." };
  }
  if (!recipients.length) {
    return { sent: false as const, error: "No recipients." };
  }

  const appUrl = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  const loginUrl = `${appUrl}/login`;
  const ctaUrl = params.ctaUrl?.trim() || loginUrl;
  const ctaLabel = params.ctaLabel?.trim() || "Sign in to AuditLens";
  // Prefer the caller-supplied link (the client passes its real origin) so email links stay valid
  // even when APP_URL is unset in the environment.
  const signInLink = params.ctaUrl?.trim() || loginUrl;
  // Preserve line breaks in the notification text as HTML paragraphs.
  const html = params.bodyHtml
    ? params.bodyHtml
    : brandedEmail({
        heading: params.subject.replace(/^AuditLens\s*[—-]\s*/i, ""),
        bodyHtml: escapeHtml(params.text)
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
          .join(""),
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
        { type: "text/plain", value: `${params.text}\n\nSign in to AuditLens: ${signInLink}` },
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
