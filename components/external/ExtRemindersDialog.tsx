"use client";

// Bulk reminders to action owners with outstanding external / regulatory findings.

import { useEffect, useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { logAudit } from "@/lib/client/audit-log";
import { loadDirectory, ownerEmailFor, ownerNameFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { ensureExtList, extOverdue } from "@/lib/workspace/external";
import { notify } from "@/lib/workspace/observations";
import { fmtDate, looseDate } from "@/lib/workspace/selectors";
import type { ExtFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type OwnerGroup = {
  ownerId: string;
  name: string;
  email: string;
  items: { f: ExtFinding; due: Date | null; overdue: boolean }[];
  overdueCount: number;
};

function extDue(f: ExtFinding): Date | null {
  return looseDate(f.targetDate || f.dueDate);
}

export default function ExtRemindersDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [dirVersion, setDirVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDirectory().then(() => {
      if (!cancelled) setTimeout(() => setDirVersion((v) => v + 1), 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  void dirVersion;

  const openFindings = ensureExtList(db).filter((f) => (f.status || "Open") !== "Closed");
  const outstanding = openFindings.filter((f) => f.ownerUserId);
  const unassigned = openFindings.filter((f) => !f.ownerUserId);

  const byOwner = new Map<string, OwnerGroup>();
  for (const f of outstanding) {
    const id = String(f.ownerUserId);
    let g = byOwner.get(id);
    if (!g) {
      g = {
        ownerId: id,
        name: ownerNameFor(db, id) || String(f.owner || "Unknown owner"),
        email: ownerEmailFor(db, id),
        items: [],
        overdueCount: 0,
      };
      byOwner.set(id, g);
    }
    const due = extDue(f);
    const overdue = extOverdue(f);
    g.items.push({ f, due, overdue });
    if (overdue) g.overdueCount++;
  }
  const groups = [...byOwner.values()]
    .filter((g) => (onlyOverdue ? g.overdueCount > 0 : true))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.items.length - a.items.length);

  const selectedGroups = groups.filter((g) => !excluded.has(g.ownerId));

  function toggle(ownerId: string) {
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  async function send() {
    if (!selectedGroups.length) return;

    const jobs = selectedGroups
      .map((g) => {
        const items = (onlyOverdue ? g.items.filter((x) => x.overdue) : g.items).slice();
        items.sort((a, b) => Number(b.overdue) - Number(a.overdue));
        return { g, items };
      })
      .filter((j) => j.items.length);
    if (!jobs.length) return;

    mutate((d) => {
      for (const { g, items } of jobs) {
        notify(
          d,
          g.ownerId,
          "reminder",
          `Reminder: ${items.length} outstanding external finding(s) require your action`,
          "myext",
        );
      }
    });

    const emailed: string[] = [];
    const failed: { name: string; reason: string }[] = [];
    const noEmail: string[] = [];
    await Promise.all(
      jobs.map(async ({ g, items }) => {
        if (!g.email) {
          noEmail.push(g.name);
          return;
        }
        const lines = items.map(
          (x, i) =>
            `${i + 1}. ${x.f.title}${x.due ? ` — target close ${fmtDate(x.due)}` : ""}${x.overdue ? " (OVERDUE)" : ""}`,
        );
        const res = await emailNotify(
          [g.email],
          `AuditLens — reminder: ${items.length} outstanding external finding(s)`,
          `Dear ${g.name},\n\nThis is a reminder from Internal Audit that ${items.length} external / regulatory finding(s) assigned to you are still outstanding:\n\n${lines.join("\n")}\n\nPlease sign in to AuditLens to post a progress update or mark items ready for closure.`,
        );
        if (res.sent) emailed.push(g.name);
        else failed.push({ name: g.name, reason: res.reason || "unknown error" });
      }),
    );

    const covered = jobs.reduce((s, j) => s + j.items.length, 0);
    logAudit(
      "ext.bulk_reminder",
      `External-finding reminders: ${emailed.length} emailed, ${failed.length} failed, ${noEmail.length} with no email on file`,
      {
        emailed,
        emailFailed: failed,
        noEmailOnFile: noEmail,
        findings: covered,
        unassignedFindings: unassigned.length,
        onlyOverdue,
      },
    );

    const clean = !failed.length && !noEmail.length;
    const lines = [
      `In-app reminders posted for ${jobs.length} action owner(s), covering ${covered} finding(s).`,
      emailed.length ? `${emailed.length} email(s) delivered.` : "No emails were delivered.",
    ];
    if (noEmail.length)
      lines.push(`No email address on file for: ${noEmail.join(", ")} — notified in-app only.`);
    if (failed.length)
      lines.push(`Email failed for: ${failed.map((f) => `${f.name} (${f.reason})`).join(", ")}.`);
    if (unassigned.length)
      lines.push(
        `${unassigned.length} outstanding finding(s) have no action owner and could not be included.`,
      );

    modal.close();
    modal.success(
      <div style={{ textAlign: "left" }}>
        {lines.map((l, i) => (
          <p key={i} style={{ margin: i ? "6px 0 0" : 0 }}>
            {l}
          </p>
        ))}
      </div>,
      clean ? "Reminders sent" : "Reminders sent — with exceptions",
    );
  }

  return (
    <ModalFrame
      title="Remind action owners"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn" busyLabel="Sending…" onClick={send} disabled={!selectedGroups.length}>
            🔔 Send {selectedGroups.length ? `to ${selectedGroups.length} owner(s)` : "reminders"}
          </BusyButton>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Each selected action owner receives one consolidated email listing their outstanding external
        findings, plus an in-app notification.
      </p>
      {unassigned.length ? (
        <div className="reminders-gap" role="status">
          <b>
            {unassigned.length} outstanding finding{unassigned.length === 1 ? "" : "s"} cannot be
            reminded about.
          </b>{" "}
          They have no assigned action owner. Open each finding and assign an owner to include it in
          follow-up.
        </div>
      ) : null}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={onlyOverdue}
          onChange={(e) => setOnlyOverdue(e.target.checked)}
        />{" "}
        Only owners with overdue findings
      </label>
      {groups.length ? (
        <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
          {groups.map((g) => (
            <label
              key={g.ownerId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontWeight: 400,
                padding: "8px 4px",
                borderTop: "1px solid var(--line)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={!excluded.has(g.ownerId)}
                onChange={() => toggle(g.ownerId)}
              />
              <span style={{ flex: 1 }}>
                <b>{g.name}</b>
                {g.email ? (
                  <span className="hint"> · {g.email}</span>
                ) : (
                  <span className="hint" style={{ color: "var(--crit)" }}>
                    {" "}
                    · no email on file
                  </span>
                )}
              </span>
              <span className="hint">
                {onlyOverdue ? g.overdueCount : g.items.length} outstanding
                {g.overdueCount ? (
                  <>
                    {" · "}
                    <b style={{ color: "var(--crit)" }}>{g.overdueCount} overdue</b>
                  </>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="hint" style={{ marginTop: 12 }}>
          {onlyOverdue
            ? "No owners with overdue findings — nothing to remind."
            : "No outstanding external findings are assigned to an action owner."}
        </div>
      )}
    </ModalFrame>
  );
}
