"use client";

// Executive Assurance Brief — React port of viewExco/excoCardHTML/generateExcoBriefNow/
// sendExcoBriefRecord/copyExcoBriefLink/delExcoBrief/modalExcoBrief. The snapshot builder is
// the shared lib/exco-compute.ts (also used by the cron), so client and server stay in sync.

import { useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { Empty } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { headUsers, loadDirectory } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { computeExcoSnapshot } from "@/lib/exco-compute";
import {
  fmtDate,
  today0,
  uid,
} from "@/lib/workspace/selectors";
import type { ExcoBrief, ExcoMeta, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const EXCO_MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function excoMeta(db: WorkspaceDb): ExcoMeta {
  db.exco = db.exco || {};
  return db.exco;
}
function excoBriefs(db: WorkspaceDb): ExcoBrief[] {
  const e = excoMeta(db);
  e.briefs = e.briefs || [];
  return e.briefs;
}
function briefLink(token: string): string {
  try {
    return location.origin + "/brief?id=" + encodeURIComponent(token);
  } catch {
    return "/brief?id=" + token;
  }
}
function parseEmails(s: unknown): string[] {
  return [...new Set(String(s || "").split(/[;,\s]+/).map((x) => x.trim()).filter((x) => x.includes("@")))];
}
function excoEmails(db: WorkspaceDb): string[] {
  const e = excoMeta(db) as ExcoMeta & { recipientList?: { email: string }[]; recipients?: string };
  return [
    ...new Set([...(e.recipientList || []).map((r) => r.email), ...parseEmails(e.recipients)]),
  ].filter((x) => x && x.includes("@"));
}
function briefDate(b: ExcoBrief): Date | null {
  const d = b.generatedAt ? new Date(b.generatedAt) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

function buildExcoEmailText(s: Record<string, unknown>, org: string, link: string): string {
  const k = (s.kpis || {}) as Record<string, number>;
  const lines = [
    `Internal Audit — Executive Assurance Brief for the MD & Executive Committee`,
    `${s.org || org || ""} · As at ${s.period || ""}`,
    ``,
  ];
  if (s.headline) lines.push(String(s.headline), "");
  lines.push(
    `Remediation rate: ${s.remRate}% (${s.closed}/${s.total})`,
    `Open Critical & High issues: ${k.keyOpen} (${k.keyOverdue} overdue)`,
    `Overdue remediation actions: ${k.overdue}`,
    `Unmitigated fraud risks (High/Extreme): ${k.unmit}`,
    `External findings open: ${k.extOpen} (${k.extOverdueN} overdue)`,
    ``,
    `Matters requiring EXCO attention:`,
    ...((s.matters as string[]) || []).map((t, i) => `${i + 1}. ${t}`),
    ``,
    `Open the full Executive Assurance Brief here: ${link}`,
  );
  return lines.join("\n");
}

function KeyMessageDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const meta = excoMeta(db);
  const [period, setPeriod] = useState(meta.period || "");
  const [headline, setHeadline] = useState(meta.headline || "");
  const [commentary, setCommentary] = useState(meta.commentary || "");
  return (
    <ModalFrame
      title="Executive key message — MD & EXCO"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              mutate((d) => {
                const e = excoMeta(d);
                e.period = period;
                e.headline = headline;
                e.commentary = commentary;
              });
              modal.close();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label>As at / period</label>
      <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. As at 30 June 2026 (Q2 2026)" />
      <label>Key message (executive headline)</label>
      <textarea
        style={{ minHeight: 120 }}
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        placeholder="One short paragraph: the overall assurance message the MD & EXCO should take away."
      />
      <label>CAE commentary (optional, longer)</label>
      <textarea
        style={{ minHeight: 130 }}
        value={commentary}
        onChange={(e) => setCommentary(e.target.value)}
        placeholder="Optional supporting narrative — critical issues, themes, fraud, regulatory."
      />
    </ModalFrame>
  );
}

export default function ExcoPage() {
  const { db, mutate, saveNow } = useWorkspace();
  const modal = useModal();
  const [yearF, setYearF] = useState("All");
  const [monthF, setMonthF] = useState("All");

  const briefs = excoBriefs(db)
    .slice()
    .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));

  async function generateBrief() {
    const meta = excoMeta(db);
    const period = "As at " + fmtDate(today0());
    const snapshot = computeExcoSnapshot(db, {
      period,
      headline: meta.headline || "",
      commentary: meta.commentary || "",
    });
    const rec: ExcoBrief = {
      id: uid(),
      token: uid() + uid(),
      period,
      generatedAt: new Date().toISOString(),
      sentAt: "",
      sentTo: 0,
      headline: meta.headline || "",
      commentary: meta.commentary || "",
      snapshot: snapshot as unknown as Record<string, unknown>,
    };
    mutate((d) => excoBriefs(d).unshift(rec));
    logAudit("exco.generated", "Generated Executive Assurance Brief for " + period, { period });
    await saveNow();
    modal.success(
      <>
        Brief generated — {period}.<br />
        <br />
        Public link: {briefLink(rec.token!)}
        <br />
        <br />
        Use “Send” on the card to email it to the MD &amp; EXCO.
      </>,
      "Brief generated",
    );
  }

  async function sendBrief(b: ExcoBrief) {
    const to = excoEmails(db);
    if (!to.length) {
      toast("Add MD & EXCO recipients in Settings → MD & EXCO recipients first.", "error");
      return;
    }
    const meta = excoMeta(db) as ExcoMeta & { subject?: string };
    await modal.confirm({
      message: `Send the ${b.period} brief to ${to.length} recipient(s)?`,
      confirmLabel: "Send",
      busyLabel: "Sending…",
      onConfirm: async () => {
        const link = briefLink(b.token || "");
        const subject = meta.subject || "Executive Assurance Brief — " + b.period;
        const text = buildExcoEmailText(b.snapshot || {}, db.org || "", link);
        let sent = false;
        try {
          const res = await fetch("/api/notify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to,
              subject,
              text,
              ctaUrl: link,
              ctaLabel: "Open the Executive Assurance Brief",
              excoBrief: { snapshot: b.snapshot, link },
            }),
          });
          const data = await res.json().catch(() => ({}));
          sent = !!(data as { sent?: boolean }).sent;
        } catch {
          /* reported below */
        }
        // Confirm to the Head(s) of Audit that the brief went out (in-app + email).
        /* QA-7 — was a raw fetch("/api/directory"), bypassing the shared cache and re-fetching
           the whole roster. loadDirectory() dedupes and caches; headUsers() also includes
           admins, who act as Head of Audit and should receive this confirmation. */
        let heads: { id: string; email?: string }[] = [];
        try {
          await loadDirectory();
          heads = headUsers();
        } catch {
          /* best effort */
        }
        mutate((d) => {
          const rec = excoBriefs(d).find((x) => x.id === b.id);
          if (rec) {
            rec.sentAt = new Date().toISOString();
            rec.sentTo = to.length;
          }
          const e = excoMeta(d) as ExcoMeta & { lastSentAt?: string };
          e.lastSentAt = new Date().toISOString();
          d.notifications = d.notifications || [];
          heads.forEach((h) =>
            d.notifications!.push({
              id: uid(),
              userId: h.id,
              kind: "exco_sent",
              text: `Executive Assurance Brief (${b.period}) sent to MD & EXCO`,
              link: "exco",
              read: false,
              at: new Date().toISOString(),
            }),
          );
        });
        logAudit("exco.sent", `Executive Assurance Brief sent to MD & EXCO (${to.length} recipient(s))`, {
          period: b.period,
          sent,
        });
        const headEmails = heads.map((h) => h.email).filter(Boolean) as string[];
        if (headEmails.length)
          emailNotify(
            headEmails,
            "AuditLens — Executive Assurance Brief sent",
            `The Executive Assurance Brief "${b.period}" was sent to ${to.length} MD & EXCO recipient(s).${sent ? "" : " (Delivery to recipients could not be confirmed — check the email configuration.)"} Public link: ${link}`,
          );
        toast(
          sent
            ? `Brief sent to ${to.length} recipient(s).`
            : `Send attempted — delivery could not be confirmed. Check the email configuration.`,
          sent ? "success" : "error",
        );
      },
    });
  }

  function copyLink(b: ExcoBrief) {
    const link = briefLink(b.token || "");
    try {
      navigator.clipboard.writeText(link).then(
        () => toast("Link copied.", "success"),
        () => toast(link),
      );
    } catch {
      toast(link);
    }
  }

  async function deleteBrief(b: ExcoBrief) {
    await modal.confirm({
      message: "Delete this brief? Its public link will stop working.",
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          const e = excoMeta(d);
          e.briefs = (e.briefs || []).filter((x) => x.id !== b.id);
        });
        logAudit(
          "exco.brief_deleted",
          "Deleted Executive Assurance Brief" + (b.period ? " for " + b.period : ""),
          { briefId: b.id },
        );
      },
    });
  }

  usePageChrome({
    title: "Executive Assurance Brief",
    actions: (
      <>
        <button className="btn sec sm" type="button" onClick={() => modal.open(<KeyMessageDialog />)}>
          Key message
        </button>
        <BusyButton className="btn sm" busyLabel="Generating…" onClick={generateBrief}>
          + Generate brief
        </BusyButton>
      </>
    ),
  });

  const years = [
    ...new Set(
      briefs.map((b) => {
        const d = briefDate(b);
        return d ? String(d.getFullYear()) : "";
      }),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));

  let list = briefs;
  if (yearF !== "All")
    list = list.filter((b) => {
      const d = briefDate(b);
      return d && String(d.getFullYear()) === yearF;
    });
  if (monthF !== "All")
    list = list.filter((b) => {
      const d = briefDate(b);
      return d && EXCO_MONTHS[d.getMonth()] === monthF;
    });

  if (!briefs.length) {
    return (
      <div className="card">
        <Empty big="◆">
          No briefs generated yet.
          <br />
          <br />
          Use <b>+ Generate brief</b> (top right) to create the first Executive Assurance Brief.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ padding: "12px 16px", marginBottom: 6 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="filter-group">
            <span className="filter-label">Year</span>
            <select
              className="field-select field-select-sm"
              value={yearF}
              onChange={(e) => setYearF(e.target.value)}
            >
              <option>All</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-label">Month</span>
            <select
              className="field-select field-select-sm"
              value={monthF}
              onChange={(e) => setMonthF(e.target.value)}
            >
              <option>All</option>
              {EXCO_MONTHS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          {yearF !== "All" || monthF !== "All" ? (
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                setYearF("All");
                setMonthF("All");
              }}
            >
              Clear
            </button>
          ) : null}
          <div className="spacer" style={{ flex: 1 }} />
          <span className="hint">
            {list.length} of {briefs.length}
          </span>
        </div>
      </div>

      {list.length ? (
        <div className="exco-grid">
          {list.map((b) => {
            const sent = !!b.sentAt;
            const s = (b.snapshot || {}) as Record<string, unknown>;
            const k = (s.kpis || {}) as Record<string, number>;
            const rem = (s.remRate as number) || 0;
            const remC = rem >= 70 ? "var(--low)" : rem >= 40 ? "#a67c00" : "var(--crit)";
            const keyC = (k.keyOpen || 0) > 0 ? "#a67c00" : "var(--low)";
            const odC = (k.overdue || 0) > 0 ? "var(--crit)" : "var(--low)";
            return (
              <div key={b.id} className={`exco-file ${sent ? "is-sent" : "is-draft"}`}>
                <span className="exco-file-state">{sent ? "Sent" : "Draft"}</span>
                <div className="exco-file-body">
                  <div className="exco-file-kicker">Internal Audit · Executive</div>
                  <div className="exco-file-title">Executive Assurance Brief</div>
                  <div className="exco-file-period">For: {b.period || "—"}</div>
                  <div className="exco-file-stats">
                    <div>
                      <span className="v" style={{ color: remC }}>
                        {rem}%
                      </span>
                      <span className="l">remediated</span>
                    </div>
                    <div>
                      <span className="v" style={{ color: keyC }}>
                        {k.keyOpen || 0}
                      </span>
                      <span className="l">High</span>
                    </div>
                    <div>
                      <span className="v" style={{ color: odC }}>
                        {k.overdue || 0}
                      </span>
                      <span className="l">overdue</span>
                    </div>
                  </div>
                  {sent ? (
                    <div className="exco-file-meta">
                      Sent {fmtDate(new Date(b.sentAt as string))} · {String(b.sentTo || 0)}{" "}
                      recipient(s)
                    </div>
                  ) : null}
                </div>
                <div className="exco-file-actions">
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => {
                      try {
                        window.open(briefLink(b.token || ""), "_blank", "noopener");
                      } catch {
                        toast(briefLink(b.token || ""));
                      }
                    }}
                  >
                    View →
                  </button>
                  <button className="btn sec sm exco-act" type="button" onClick={() => void sendBrief(b)}>
                    {sent ? "Resend" : "Send"}
                  </button>
                  <button className="btn sec sm exco-act" type="button" onClick={() => copyLink(b)}>
                    Copy link
                  </button>
                  <button
                    className="btn-icon-action danger"
                    type="button"
                    title="Delete"
                    onClick={() => void deleteBrief(b)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty>No briefs match the filter.</Empty>
        </div>
      )}
    </>
  );
}
