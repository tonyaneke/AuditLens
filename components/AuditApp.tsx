"use client";

import Script from "next/script";
import SidebarNav from "./SidebarNav";

export default function AuditApp() {
  return (
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

          <SidebarNav />

          <div className="foot">
            Data stored in this browser only.
            <br />
            Back up via Settings.
          </div>
        </aside>

        <main className="main">
          <div className="main-shell">
            <div className="topbar">
              <div className="topbar-left">
                <h2 id="pageTitle">Dashboard</h2>
                <div className="crumbs" id="crumbs" />
              </div>
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

      <Script src="/audit-bot.js" strategy="afterInteractive" />
    </>
  );
}

type AuditBotWindow = Window & {
  closeModal?: () => void;
};
