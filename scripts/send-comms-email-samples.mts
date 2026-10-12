// Every e-mail audit communications can send — rendered from the sample engagement
// (scripts/_comms-sample.mts) by the SAME builders the app sends with (noticeMessage /
// requestMessage / closeoutMessage in lib/workspace/audit-comms.ts) — to ONE address.
//
//   npx tsx scripts/send-comms-email-samples.mts --to=you@credicorp.ng            → prints them
//   npx tsx scripts/send-comms-email-samples.mts --to=you@credicorp.ng --send     → sends them
//   … --base=http://localhost:3001   where the buttons point (default: APP_URL)
//
// Each subject is prefixed "[Sample n/N — to …]" so they can be told apart in an inbox; the real
// e-mails carry the subject without it. Nothing is written anywhere, and no one else is e-mailed.
import { loadEnv, parseArgs } from "./_migration.mjs";
import { sampleConcludedAudit } from "./_comms-sample.mjs";
import {
  closeoutMessage,
  noticeMessage,
  requestMessage,
  type CommsMessage,
} from "../lib/workspace/audit-comms";
import type { AuditRequest, AuditRequestMessage } from "../lib/workspace/types";

loadEnv();
const ctx = parseArgs();
const arg = (name: string) => ctx.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const to = arg("to").trim();
if (!/^[^@\s]+@[^@\s]+$/.test(to)) throw new Error("Pass the one address to send the samples to: --to=you@credicorp.ng");
const send = ctx.argv.includes("--send");
const base = (arg("base") || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const name = "Eniola Anishe";
const { audit, requests } = sampleConcludedAudit({ id: "sample", name });
const [ir, cr] = requests;
const opened = (r: AuditRequest): AuditRequest => ({ ...r, messages: [], closedAt: undefined, closedBy: undefined, closedByName: undefined });
const replied = (r: AuditRequest, m: Partial<AuditRequestMessage>): AuditRequest => ({
  ...opened(r),
  messages: [{ id: "sample-m", by: "sample", byName: name, at: "2026-07-18T14:05:00.000Z", text: "", side: "dept", ...m }],
});

const samples: [string, CommsMessage][] = [
  ["Engagement notice", noticeMessage(audit, false)],
  ["Engagement notice — re-issued", noticeMessage(audit, true)],
  ["Information request from Internal Audit", requestMessage(audit, opened(ir), { side: "ia", name }, "raised")],
  [
    "Department's response, with files",
    requestMessage(
      audit,
      replied(ir, {
        side: "dept",
        text: ir.messages![0].text,
        evidence: [
          { itemId: "sample-1", name: "vendor-master-30-Jun-2026.xlsx" },
          { itemId: "sample-2", name: "vendor-approvals-H1-2026.pdf" },
        ],
      }),
      { side: "dept", name },
      "reply",
    ),
  ],
  ["Comment from the department", requestMessage(audit, opened(cr), { side: "dept", name }, "raised")],
  ["Internal Audit's response", requestMessage(audit, replied(cr, { side: "ia", text: cr.messages![0].text }), { side: "ia", name }, "reply")],
  ["Request closed", requestMessage(audit, ir, { side: "ia", name }, "closed")],
  ["Request reopened", requestMessage(audit, opened(ir), { side: "ia", name }, "reopened")],
  ["Audit conclusion", closeoutMessage(audit, false)],
  ["Audit conclusion — re-issued", closeoutMessage(audit, true)],
];

const { sendNotificationEmail } = send ? await import("../lib/email") : { sendNotificationEmail: null };
let n = 0;
for (const [label, m] of samples) {
  n++;
  const who = m.to === "dept" ? "the department" : "Internal Audit";
  const subject = `[Sample ${n}/${samples.length} — to ${who}] ${m.subject}`;
  console.log(`\n${"=".repeat(100)}\n${n}. ${label}  →  ${who}\nSubject: ${subject}\nBell:    ${m.bell}\nButton:  ${m.cta} → ${base}${m.path}\n${"-".repeat(100)}\n${m.text}`);
  if (sendNotificationEmail) {
    const r = await sendNotificationEmail({ to: [to], subject, text: m.text, ctaUrl: base + m.path, ctaLabel: m.cta });
    console.log(r.sent ? `  ✓ sent to ${to}` : `  ✗ not sent: ${r.error}`);
  }
}
console.log(send ? `\n${n} samples processed for ${to}.` : `\nPRINTED ONLY — re-run with --send to e-mail these ${n} samples to ${to}.`);
