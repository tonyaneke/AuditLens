"use client";

// Bulk reminders to department heads with outstanding observations. Groups every open,
// approved, assigned observation by its primary action owner; the Head picks who to nudge
// (optionally only those with overdue items) and each selected HoD gets ONE consolidated
// email listing their outstanding items, plus an in-app notification.

import { useEffect, useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { logAudit } from "@/lib/client/audit-log";
import { loadDirectory, ownerEmailFor, ownerNameFor } from "@/lib/client/directory";
import { emailNotify } from "@/lib/client/notify";
import { notify } from "@/lib/workspace/observations";
import {
  allObs,
  effectiveClose,
  fmtDate,
  isOverdueObs,
  obsIsApproved,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

type OwnerGroup = {
  ownerId: string;
  name: string;
  email: string;
  items: { o: ObsWithContext; due: Date | null; overdue: boolean }[];
  overdueCount: number;
};

export default function RemindersDialog() {
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

  const outstanding = allObs(db)
    .filter(obsIsApproved)
    .filter((o) => (o.status || "Open") !== "Closed")
    .filter((o) => o.ownerUserId);

  const byOwner = new Map<string, OwnerGroup>();
  for (const o of outstanding) {
    const id = String(o.ownerUserId);
    let g = byOwner.get(id);
    if (!g) {
      g = {
        ownerId: id,
        name: ownerNameFor(db, id) || String(o.owner || "Unknown owner"),
        email: ownerEmailFor(db, id),
        items: [],
        overdueCount: 0,
      };
      byOwner.set(id, g);
    }
    const due = effectiveClose(o, o._r);
    const overdue = isOverdueObs(o, o._r);
    g.items.push({ o, due, overdue });
    if (overdue) g.overdueCount++;
  }
  const groups = [...byOwner.values()]
    .filter((g) => (onlyOverdue ? g.overdueCount > 0 : true))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.items.length - a.items.length);

  const selectedGroups = groups.filter((g) => !excluded.has(g.ownerId));
  const totalObs = selectedGroups.reduce(
    (s, g) => s + (onlyOverdue ? g.overdueCount : g.items.length),
    0,
  );

  function toggle(ownerId: string) {
    setExcluded((cur) => {
      const next = new Set(cur);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  function send() {
    if (!selectedGroups.length) return;
    const sentTo: string[] = [];
    mutate((d) => {
      for (const g of selectedGroups) {
        const items = (onlyOverdue ? g.items.filter((x) => x.overdue) : g.items).slice();
        if (!items.length) continue;
        items.sort((a, b) => Number(b.overdue) - Number(a.overdue));
        notify(
          d,
          g.ownerId,
          "reminder",
          `Reminder: ${items.length} outstanding observation(s) require your department's action`,
          "myobs",
        );
        if (g.email) {
          const lines = items.map(
            (x, i) =>
              `${i + 1}. ${x.o.title}${x.due ? ` — expected close ${fmtDate(x.due)}` : ""}${x.overdue ? " (OVERDUE)" : ""}`,
          );
          emailNotify(
            [g.email],
            `AuditLens — reminder: ${items.length} outstanding observation(s)`,
            `Dear ${g.name},\n\nThis is a reminder from Internal Audit that ${items.length} observation(s) assigned to your department are still outstanding:\n\n${lines.join("\n")}\n\nPlease sign in to AuditLens to post a progress update or mark items Ready for Closure.`,
          );
        }
        sentTo.push(g.name);
      }
    });
    logAudit(
      "obs.bulk_reminder",
      `Sent outstanding-observation reminders to ${sentTo.length} department head(s)`,
      { owners: sentTo, observations: totalObs, onlyOverdue },
    );
    modal.close();
    modal.success(
      `Reminders sent to ${sentTo.length} department head(s) covering ${totalObs} observation(s).`,
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
            🔔 Send {selectedGroups.length ? `to ${selectedGroups.length} HoD(s)` : "reminders"}
          </BusyButton>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Each selected department head receives one consolidated email listing their outstanding
        observations, plus an in-app notification.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={onlyOverdue}
          onChange={(e) => setOnlyOverdue(e.target.checked)}
        />{" "}
        Only owners with overdue observations
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
                {g.email ? <span className="hint"> · {g.email}</span> : <span className="hint" style={{ color: "var(--crit)" }}> · no email on file</span>}
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
            ? "No owners with overdue observations — nothing to remind."
            : "No outstanding observations are assigned to an action owner."}
        </div>
      )}
    </ModalFrame>
  );
}
