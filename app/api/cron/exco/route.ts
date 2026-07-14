import { NextResponse } from "next/server";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { sendNotificationEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_ID = "default";

// Auto-send schedule: the 1st of the month and the 3rd week (days 15–21),
// starting September 2026. A daily scheduler hitting this endpoint sends
// each occurrence once (deduplicated by key). No user needs to be logged in.
const START_YEAR = 2026;
const START_MONTH = 8; // September (0-indexed)

function scheduleSlot(now: Date): { due: boolean; key: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();
  if (y < START_YEAR || (y === START_YEAR && m < START_MONTH)) return { due: false, key: "" };
  const slot = day === 1 ? "01" : day >= 15 && day <= 21 ? "15" : "";
  if (!slot) return { due: false, key: "" };
  return { due: true, key: `${y}-${String(m + 1).padStart(2, "0")}-${slot}` };
}

function parseEmails(s: unknown): string[] {
  return Array.from(
    new Set(
      String(s || "")
        .split(/[;,\s]+/)
        .map((x) => x.trim())
        .filter((x) => x.includes("@")),
    ),
  );
}

type Snapshot = {
  org?: string;
  period?: string;
  headline?: string;
  remRate?: number;
  closed?: number;
  total?: number;
  kpis?: { keyOpen: number; keyOverdue: number; overdue: number; unmit: number; extOpen: number; extOverdueN: number };
  matters?: string[];
};

function briefEmailText(s: Snapshot, link: string) {
  const k = s.kpis || { keyOpen: 0, keyOverdue: 0, overdue: 0, unmit: 0, extOpen: 0, extOverdueN: 0 };
  const lines = [
    `Internal Audit — Executive Assurance Brief for the MD & Executive Committee`,
    `${s.org || ""} · As at ${s.period || ""}`,
    ``,
  ];
  if (s.headline) lines.push(s.headline, "");
  lines.push(
    `Remediation rate: ${s.remRate}% (${s.closed}/${s.total})`,
    `Open Critical & High issues: ${k.keyOpen} (${k.keyOverdue} overdue)`,
    `Overdue remediation actions: ${k.overdue}`,
    `Unmitigated fraud risks (High/Extreme): ${k.unmit}`,
    `Regulatory / external findings open: ${k.extOpen} (${k.extOverdueN} overdue)`,
    ``,
    `Matters requiring EXCO attention:`,
    ...(s.matters || []).map((t, i) => `${i + 1}. ${t}`),
    ``,
    `Open the full Executive Assurance Brief here: ${link}`,
  );
  return lines.join("\n");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  const force = url.searchParams.get("force") === "1";
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && key !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const slot = scheduleSlot(now);
  if (!slot.due && !force) {
    return NextResponse.json({ ok: true, sent: false, reason: "Not a scheduled send day (1st or 3rd week, from September 2026)." });
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const data = ((row?.data as WorkspaceDb) || defaultWorkspaceData()) as WorkspaceDb & {
    exco?: {
      recipients?: string; cc?: string; subject?: string; token?: string;
      snapshot?: Snapshot; sends?: unknown[]; lastSentAt?: string;
      autoState?: { lastKey?: string };
    };
  };
  const exco = data.exco;
  if (!exco) return NextResponse.json({ ok: true, sent: false, reason: "No MD & EXCO brief configured." });

  const occKey = force ? `manual-${now.toISOString().slice(0, 10)}` : slot.key;
  exco.autoState = exco.autoState || {};
  if (exco.autoState.lastKey === occKey) {
    return NextResponse.json({ ok: true, sent: false, reason: `Already sent for ${occKey}.` });
  }

  const recipients = parseEmails(exco.recipients);
  const cc = parseEmails(exco.cc);
  if (!recipients.length) return NextResponse.json({ ok: true, sent: false, reason: "No recipients configured in Settings." });
  if (!exco.snapshot || !exco.token) {
    return NextResponse.json({ ok: true, sent: false, reason: "The brief has not been published yet — send once manually first." });
  }

  const appUrl = (process.env.APP_URL?.trim() || url.origin).replace(/\/$/, "");
  const link = `${appUrl}/brief?id=${encodeURIComponent(exco.token)}`;
  const subject = exco.subject || `Executive Assurance Brief — ${exco.snapshot.period || ""}`;
  const text = briefEmailText(exco.snapshot, link);

  const result = await sendNotificationEmail({
    to: [...recipients, ...cc],
    subject,
    text,
    ctaUrl: link,
    ctaLabel: "Open the Executive Assurance Brief",
  });

  exco.autoState.lastKey = occKey;
  exco.lastSentAt = now.toISOString();
  exco.sends = Array.isArray(exco.sends) ? exco.sends : [];
  exco.sends.unshift({
    at: now.toISOString(),
    by: "auto-schedule",
    to: recipients.length + cc.length,
    period: exco.snapshot.period,
    link,
    sent: result.sent,
  });
  if (exco.sends.length > 50) exco.sends = exco.sends.slice(0, 50);

  await prisma.workspaceData.upsert({
    where: { id: WORKSPACE_ID },
    update: { data: data as object },
    create: { id: WORKSPACE_ID, data: data as object },
  });

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    reason: result.sent ? "sent" : ("error" in result ? result.error : "not sent"),
    recipients: recipients.length + cc.length,
    occurrence: occKey,
  });
}
