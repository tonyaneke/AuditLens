"use client";

// Notification bell for the new shell — React port of renderNotifBell/notifPanelHTML/openNotif.
// Notifications live inside the workspace blob; deep-links resolve through the route map so
// they land on migrated routes or the legacy shell as appropriate.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hrefForView } from "@/lib/routes";
import type { ViewKey } from "@/lib/routes";
import {
  extList,
  fmtDateTime,
  locateObs,
  myNotifications,
  unreadNotifCount,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { useUser } from "./UserContext";

export default function NotifBell() {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click (legacy document-level listener behavior).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const list = myNotifications(db, user.id).slice(0, 30);
  const unread = unreadNotifCount(db, user.id);

  function openNotif(id: string) {
    const n = (db.notifications || []).find((x) => x.id === id);
    if (!n) return;
    if (!n.read) mutate((d) => {
      const item = (d.notifications || []).find((x) => x.id === id);
      if (item) item.read = true;
    });
    setOpen(false);
    // Deep-link to the exact observation / external finding when known.
    if (n.obsId) {
      const loc = locateObs(db, n.obsId);
      if (loc) {
        navigate(hrefForView("observation", { audit: loc.a.id, report: loc.r.id, obs: n.obsId }));
        return;
      }
      if (extList(db).some((f) => f.id === n.obsId)) {
        navigate(hrefForView("extfinding", { ext: n.obsId }));
        return;
      }
    }
    const view = (({ observation: "audits", tracker: "tracker" }) as Record<string, string>)[n.link] || n.link;
    if (view) navigate(hrefForView(view as ViewKey));
  }

  function navigate(href: string) {
    // Cross-shell targets need a real page load; same-shell can use the router.
    if (href.startsWith("/legacy")) window.location.assign(href);
    else router.push(href);
  }

  return (
    <div id="notifBell" className="notif-bell-wrap" ref={wrapRef}>
      <button
        className={`notif-bell-btn${unread > 0 ? " has-unread" : ""}`}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Notifications"
        aria-label="Notifications"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M12 2a2 2 0 0 0-2 2v.35A6 6 0 0 0 6 10v3l-1.3 2.6A1 1 0 0 0 5.6 17h12.8a1 1 0 0 0 .9-1.45L18 13v-3a6 6 0 0 0-4-5.65V4a2 2 0 0 0-2-2Z" />
          <path d="M9.9 18a2.1 2.1 0 0 0 4.2 0Z" />
        </svg>
        {unread > 0 ? <span className="notif-badge">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      <div className="notif-panel" style={{ display: open ? "block" : "none" }}>
        <div className="notif-head">
          <b>Notifications</b>
          {list.some((n) => !n.read) ? (
            <button
              className="btn ghost sm"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                mutate((d) => {
                  (d.notifications || []).forEach((n) => {
                    if (n.userId === user.id && !n.read) n.read = true;
                  });
                });
              }}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="notif-list">
          {list.length ? (
            list.map((n) => (
              <div
                key={n.id}
                className={`notif-item${n.read ? "" : " unread"}`}
                onClick={() => openNotif(n.id)}
              >
                <div className="notif-text">{n.text}</div>
                <div className="notif-time">{fmtDateTime(n.at)}</div>
              </div>
            ))
          ) : (
            <div className="notif-empty hint">No notifications yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
