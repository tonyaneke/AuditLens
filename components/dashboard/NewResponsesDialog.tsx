"use client";

/* "New responses" digest for Internal Audit.

   Owner responses arrive as workspace notifications, which is easy to miss behind the bell —
   a Ready-for-Closure submission is the one event an auditor must act on, so on opening the
   dashboard the unread ones are surfaced once, up front. Opening a row navigates to the item
   and marks that one read; dismissing marks the whole batch read so it does not nag again. */

import { isRecentNotifAt } from "@/lib/client/notif-recency";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import { useRouter } from "next/navigation";
import {
  extList,
  fmtDateTime,
  locateObs,
  myNotifications,
} from "@/lib/workspace/selectors";
import type { NotificationItem, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/* Kinds that represent someone responding TO Internal Audit:
   - "rectified"    → an action owner marked an observation Ready for Closure
   - "update"       → an action owner commented / posted a progress report
   - "fraud_update" → an action owner reported progress on a fraud prevention action */
const RESPONSE_KINDS = new Set(["rectified", "update", "fraud_update"]);

const KIND_LABEL: Record<string, string> = {
  rectified: "Ready for closure",
  update: "Response",
  fraud_update: "Fraud control",
};
const KIND_HEX: Record<string, string> = {
  rectified: "#1f8a5b",
  update: "#2c5f8a",
  fraud_update: "#c98a00",
};

/** Unread owner responses for this user from today or yesterday, newest first. */
export function newResponseNotifs(db: WorkspaceDb, userId: string | undefined): NotificationItem[] {
  return myNotifications(db, userId).filter(
    (n) => !n.read && RESPONSE_KINDS.has(String(n.kind || "")) && isRecentNotifAt(n.at),
  );
}

export default function NewResponsesDialog({ items }: { items: NotificationItem[] }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();

  function markRead(ids: string[]) {
    const set = new Set(ids);
    mutate((d) => {
      (d.notifications || []).forEach((n) => {
        if (set.has(n.id)) n.read = true;
      });
    });
  }

  // Same resolution order as the notification bell: deep-link to the exact record when we can.
  function go(n: NotificationItem) {
    markRead([n.id]);
    modal.close();
    let href = "";
    if (n.obsId) {
      const loc = locateObs(db, n.obsId);
      if (loc) href = hrefForView("observation", { audit: loc.a.id, report: loc.r.id, obs: n.obsId });
      else if (extList(db).some((f) => f.id === n.obsId)) href = hrefForView("extfinding", { ext: n.obsId });
    }
    if (!href) {
      const view = ({ observation: "audits", tracker: "tracker" } as Record<string, string>)[n.link] || n.link;
      if (!view) return;
      href = hrefForView(view as Parameters<typeof hrefForView>[0]);
    }
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  return (
    <ModalFrame
      title={`New responses (${items.length})`}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Later
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              markRead(items.map((n) => n.id));
              modal.close();
            }}
          >
            Mark all as read
          </button>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Action owners have responded today or yesterday on the items below. Open one to review and verify it.
      </p>
      {items.map((n) => {
        const kind = String(n.kind || "");
        const hex = KIND_HEX[kind] || "#64748b";
        return (
          <button
            key={n.id}
            type="button"
            className="newresp-row"
            onClick={() => go(n)}
            title="Open"
          >
            <span className="pill" style={{ background: hex + "22", color: hex, fontWeight: 700 }}>
              {KIND_LABEL[kind] || "Update"}
            </span>
            <span className="newresp-text">{n.text}</span>
            {n.at ? <span className="hint newresp-when">{fmtDateTime(n.at)}</span> : null}
          </button>
        );
      })}
    </ModalFrame>
  );
}
