"use client";

/* "New responses" digest for Internal Audit.

   Owner responses arrive as workspace notifications, which is easy to miss behind the bell —
   a Ready-for-Closure submission is the one event an auditor must act on, so on opening the
   dashboard every unread one is surfaced once, up front. Three per screen, newest first; arrows
   step through any further screens. Opening a row navigates
   to the item and marks that one read; dismissing marks the whole batch read. */

import { useMemo, useState } from "react";
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

const RESPONSE_KINDS = new Set(["rectified", "update", "fraud_update"]);
const FIRST_PAGE_SIZE = 3;

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

/** Unread owner responses for this user, newest first. */
export function newResponseNotifs(db: WorkspaceDb, userId: string | undefined): NotificationItem[] {
  return myNotifications(db, userId).filter(
    (n) => !n.read && RESPONSE_KINDS.has(String(n.kind || "")),
  );
}

/** Up to three unread responses per screen. */
function paginateResponses(items: NotificationItem[]): NotificationItem[][] {
  const pages: NotificationItem[][] = [];
  for (let i = 0; i < items.length; i += FIRST_PAGE_SIZE) {
    pages.push(items.slice(i, i + FIRST_PAGE_SIZE));
  }
  return pages;
}

function ResponseCard({
  n,
  onOpen,
  featured,
}: {
  n: NotificationItem;
  onOpen: (n: NotificationItem) => void;
  featured?: boolean;
}) {
  const kind = String(n.kind || "");
  const hex = KIND_HEX[kind] || "#64748b";
  return (
    <button
      type="button"
      className={`newresp-row${featured ? " newresp-row-featured" : ""}`}
      onClick={() => onOpen(n)}
      title="Open"
    >
      <span className="pill" style={{ background: hex + "22", color: hex, fontWeight: 700 }}>
        {KIND_LABEL[kind] || "Update"}
      </span>
      <span className="newresp-text">{n.text}</span>
      {n.at ? <span className="hint newresp-when">{fmtDateTime(n.at)}</span> : null}
    </button>
  );
}

export default function NewResponsesDialog({ items }: { items: NotificationItem[] }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const pages = useMemo(() => paginateResponses(items), [items]);
  const [pageIdx, setPageIdx] = useState(0);
  const page = pages[pageIdx];
  const multi = pages.length > 1;
  const isFirst = pageIdx === 0;

  function markRead(ids: string[]) {
    const set = new Set(ids);
    mutate((d) => {
      (d.notifications || []).forEach((n) => {
        if (set.has(n.id)) n.read = true;
      });
    });
  }

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

  if (!page?.length) return null;

  return (
    <ModalFrame
      title={`New responses (${items.length})`}
      footer={
        <div className="newresp-mf">
          {multi ? (
            <div className="newresp-nav" role="navigation" aria-label="Browse responses">
              <button
                className="newresp-circle-btn"
                type="button"
                disabled={pageIdx === 0}
                aria-label="Previous responses"
                onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
              >
                ←
              </button>
              <div className="newresp-dots" role="tablist" aria-label="Response pages">
                {pages.map((pg, i) => (
                  <button
                    key={pg.map((n) => n.id).join("-")}
                    type="button"
                    role="tab"
                    aria-selected={i === pageIdx}
                    aria-label={`Page ${i + 1} of ${pages.length}`}
                    className={`newresp-dot${i === pageIdx ? " active" : ""}`}
                    onClick={() => setPageIdx(i)}
                  />
                ))}
              </div>
              <button
                className="newresp-circle-btn"
                type="button"
                disabled={pageIdx >= pages.length - 1}
                aria-label="Next responses"
                onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
              >
                →
              </button>
            </div>
          ) : null}
          <div className="newresp-mf-actions">
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
          </div>
        </div>
      }
    >
      <div className="newresp-slides">
        <div className="newresp-slide-head">{isFirst ? "Most recent" : "Earlier responses"}</div>
        <p className="hint" style={{ margin: "0 0 12px" }}>
          {isFirst
            ? "The latest owner responses — open one to review and verify."
            : "More unread responses that still need your attention."}
        </p>
        {page.map((n, i) => (
          <ResponseCard key={n.id} n={n} onOpen={go} featured={isFirst && i === 0} />
        ))}
        {multi ? (
          <p className="hint newresp-slide-count" style={{ margin: "12px 0 0", textAlign: "center" }}>
            {pageIdx + 1} of {pages.length}
          </p>
        ) : null}
      </div>
    </ModalFrame>
  );
}
