"use client";

import Script from "next/script";
import AuthGate from "./AuthGate";
import SidebarNav from "./SidebarNav";

export default function AuditApp() {
  return (
    <AuthGate>
      {(user) => (
        <>
          <div className="app">
            <aside className="side">
              <div className="brand">
                <div className="brand-logo-row">
                  <img id="brandLogo" alt="" className="brand-logo" />
                  <span className="brand-name">AMS</span>
                </div>
                <div className="brand-tagline">Audit Management System</div>
              </div>

              <SidebarNav user={user} />
            </aside>

            <main className="main">
              <div className="main-shell">
                <div className="topbar">
                  <div className="topbar-left">
                    <div className="topbar-back" id="topBack" />
                    <div className="topbar-title-wrap">
                      <h2 id="pageTitle">Dashboard</h2>
                    </div>
                  </div>
                  <div className="topbar-center" id="topSearch" />
                  <div className="topbar-right">
                    <div className="row" id="topActions" />
                  </div>
                </div>
                <div id="banner" />
                <div className="content" id="content" />
              </div>
            </main>
          </div>

          <div className="overlay" id="overlay">
            <div className="modal" id="modal">
              <div className="mh">
                <h3 id="modalTitle">Title</h3>
                <button
                  className="x"
                  type="button"
                  onClick={() => (window as AuditBotWindow).closeModal?.()}
                >
                  ×
                </button>
              </div>
              <div className="mb" id="modalBody" />
              <div className="mf" id="modalFoot" />
            </div>
          </div>

          <span id="orgName" hidden aria-hidden="true" />

          <div className="ai-busy-overlay" id="aiBusyOverlay" aria-hidden="true">
            <div className="ai-busy-card">
              <span className="ai-busy-spinner" aria-hidden="true" />
              Generating…
            </div>
          </div>

          <Script src="/audit-bot.js?v=20260703c" strategy="afterInteractive" />
        </>
      )}
    </AuthGate>
  );
}

type AuditBotWindow = Window & {
  closeModal?: () => void;
};
