import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { prisma } from "../lib/prisma";
import { defaultWorkspaceData, type WorkspaceDb } from "../lib/db-data";
import { computeExcoSnapshot, fmtDate } from "../lib/exco-compute";
import { buildBriefEmailHtml, sendNotificationEmail } from "../lib/email";
import { randomUUID } from "crypto";

async function main() {
  const recipient = "eanishe@credicorp.ng";
  console.log(`Preparing test Executive Assurance Brief for ${recipient}...`);

  const row = await prisma.workspaceData.findUnique({ where: { id: "default" } });
  const data = ((row?.data as WorkspaceDb) || defaultWorkspaceData()) as WorkspaceDb;

  const now = new Date();
  const period = `As at ${fmtDate(now)}`;
  const exco = data.exco as { headline?: string; commentary?: string } | undefined;
  const headline = exco?.headline || "Executive Assurance Brief — Operations & Risk Update";
  const commentary = exco?.commentary || "";

  const snap = computeExcoSnapshot(data, { period, headline, commentary });
  console.log(`Snapshot computed. Total open Critical & High items: ${snap.keyIssues?.length || 0}`);

  const token = randomUUID().replace(/-/g, "");
  const appUrl = (process.env.APP_URL?.trim() || "https://auditlens.credicorp.ng").replace(/\/$/, "");
  const link = `${appUrl}/brief?id=${encodeURIComponent(token)}`;

  const subject = `Executive Assurance Brief — ${period}`;
  const text = [
    `Internal Audit — Executive Assurance Brief for the MD & Executive Committee`,
    `${data.org || ""} · As at ${period}`,
    ``,
    `Open the full Executive Assurance Brief here: ${link}`,
  ].join("\n");

  const bodyHtml = buildBriefEmailHtml(snap, link);

  console.log(`Sending email via SendGrid to ${recipient}...`);
  const result = await sendNotificationEmail({
    to: [recipient],
    subject,
    text,
    ctaUrl: link,
    ctaLabel: "Open the Executive Assurance Brief",
    bodyHtml,
  });

  console.log("Result:", JSON.stringify(result, null, 2));

  if (result.sent) {
    console.log(`✅ Test brief successfully sent to ${recipient}`);
  } else {
    console.error(`❌ Failed to send brief:`, result.error);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
