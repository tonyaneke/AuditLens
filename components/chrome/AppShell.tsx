"use client";

// The React shell for migrated routes — same structure/classes as the legacy AuditApp shell
// (sidebar + topbar + content), with the topbar driven by the PageChrome slots instead of
// innerHTML writes.

import { type ReactNode } from "react";
import SidebarNav from "@/components/SidebarNav";
import { useChrome } from "./PageChrome";
import NotifBell from "./NotifBell";
import { useUser } from "./UserContext";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const { chrome } = useChrome();
  const { db } = useWorkspace();
  const logo = typeof db.logo === "string" && db.logo ? db.logo : "";

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="brand-logo-row">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- org logo is a data URL
              <img alt="" className="brand-logo" src={logo} />
            ) : null}
            <span className="brand-name">AuditLens</span>
          </div>
          <div className="brand-tagline">Audit Management System</div>
        </div>
        <SidebarNav user={user} shell="app" />
      </aside>

      <main className="main">
        <div className="main-shell">
          <div className="topbar">
            <div className="topbar-left">
              <div className="topbar-back">{chrome.back}</div>
              <div className="topbar-title-wrap">
                <h2>{chrome.title}</h2>
              </div>
            </div>
            <div className="topbar-center">{chrome.search}</div>
            <div className="topbar-right">
              <div className="row">{chrome.actions}</div>
              <NotifBell />
            </div>
          </div>
          <div className="content">{children}</div>
        </div>
      </main>
    </div>
  );
}
