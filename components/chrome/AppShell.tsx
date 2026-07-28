"use client";

// The React shell for migrated routes — same structure/classes as the legacy AuditApp shell
// (sidebar + topbar + content), with the topbar driven by the PageChrome slots instead of
// innerHTML writes.

import { useEffect, type ReactNode } from "react";
import SidebarNav from "@/components/SidebarNav";
import { ORG_LOGO_URL, preloadOrgLogo } from "@/lib/client/logo";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { useChrome } from "./PageChrome";
import NotifBell from "./NotifBell";
import { useUser } from "./UserContext";

export default function AppShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const { chrome } = useChrome();
  const { ready } = useWorkspace();

  // Warm the data-URL conversion of the static logo so Word exports embed it instantly.
  useEffect(() => {
    void preloadOrgLogo();
  }, []);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="brand-logo-row">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
            <img alt="" className="brand-logo" src={ORG_LOGO_URL} />
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
          <div className="content">
            {ready ? (
              children
            ) : (
              // The workspace document is still downloading — shimmer skeletons shaped like a
              // typical page (KPI row + content cards) so pages never flash premature empties.
              <div className="skel-page anim-fade-in" aria-busy="true" aria-label="Loading">
                <div className="skel-kpis">
                  <div className="skel skel-kpi" />
                  <div className="skel skel-kpi" />
                  <div className="skel skel-kpi" />
                  <div className="skel skel-kpi" />
                </div>
                <div className="card">
                  <div className="skel skel-title" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                </div>
                <div className="card">
                  <div className="skel skel-title" />
                  <div className="skel skel-line w80" />
                  <div className="skel skel-line w60" />
                  <div className="skel skel-line w40" />
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
