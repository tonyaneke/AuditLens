"use client";

// Linked-audits cell — port of auditLinksCell/raLinkFilter/raLinkAdd/raLinkRemove. Clicks are
// kept off the surrounding plan row (which navigates) exactly as the legacy stopPropagation did.

import { useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { hrefForView, isLegacyPath } from "@/lib/routes";
import { ensureUniverse, raLinkIds } from "@/lib/workspace/ra";
import type { AuditUniverseUnit } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export default function AuditLinks({ unit }: { unit: AuditUniverseUnit }) {
  const { db, mutate } = useWorkspace();
  const router = useRouter();
  const [q, setQ] = useState("");

  const ids = raLinkIds(unit);
  const linked = ids.map((id) => (db.audits || []).find((a) => a.id === id)).filter(Boolean);
  const avail = (db.audits || []).filter((a) => !ids.includes(a.id));
  const matches = avail.filter((a) => !q.trim() || a.name.toLowerCase().includes(q.toLowerCase().trim()));

  const stop = (e: MouseEvent) => e.stopPropagation();

  function setLinks(next: string[]) {
    mutate((d) => {
      const e = ensureUniverse(d).find((x) => x.id === unit.id);
      if (!e) return;
      e.linkedAuditIds = next;
      delete e.linkedAuditId;
    });
  }

  function openAudit(e: MouseEvent, auditId: string) {
    e.stopPropagation();
    const href = hrefForView("audit", { audit: auditId });
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  return (
    <div className="ra-linkbox" onClick={stop}>
      {linked.map((a) => (
        <span
          className="tag ra-link-tag"
          key={a!.id}
          title="Open audit"
          onClick={(e) => openAudit(e, a!.id)}
        >
          {a!.name}{" "}
          <span
            className="tag-unlink"
            title="Unlink"
            onClick={(e) => {
              e.stopPropagation();
              setLinks(ids.filter((x) => x !== a!.id));
            }}
          >
            {TRASH}
          </span>
        </span>
      ))}
      {avail.length ? (
        <div className="ra-link-search">
          <input
            className="ra-link-input"
            placeholder={linked.length ? "+ link another…" : "+ link audit…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {/* Shown by CSS on .ra-link-search:focus-within, as in the legacy markup. */}
          <div className="ra-link-menu">
            {matches.length ? (
              matches.map((a) => (
                <div
                  className="ra-link-opt"
                  key={a.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setQ("");
                    setLinks([...ids, a.id]);
                  }}
                >
                  {a.name}
                </div>
              ))
            ) : (
              <div className="ra-link-opt ra-link-empty" style={{ color: "#94a3b8" }}>
                No matches
              </div>
            )}
          </div>
        </div>
      ) : linked.length ? null : (
        <span className="hint">no audits yet</span>
      )}
    </div>
  );
}
