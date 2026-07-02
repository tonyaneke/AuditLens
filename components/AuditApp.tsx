"use client";

import Script from "next/script";

export default function AuditApp() {
  return (
    <>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <div className="brand-row">
              <img
                id="brandLogo"
                alt=""
                className="brand-logo"
              />
              <div className="brand-text">
                <h1>AMS</h1>
                <small>Audit Management System</small>
              </div>
            </div>
            <div className="org-chip" id="orgChip">
              CREDICORP — Internal Audit
            </div>
          </div>

          <nav className="nav" id="nav">
            <div className="nav-section">
              <div className="nav-label">Main</div>
              <button data-view="dashboard" className="active">
                <span className="ic">▦</span> Dashboard
              </button>
              <button data-view="audits">
                <span className="ic">▤</span> Audits &amp; Reports
              </button>
              <button data-view="tracker">
                <span className="ic">◷</span> Remediation Tracker
              </button>
            </div>

            <div className="nav-section">
              <div className="nav-label">Assessment</div>
              <button data-view="auditra">
                <span className="ic">◈</span> Audit Risk Assessment
              </button>
              <button data-view="fraud">
                <span className="ic">⚠</span> Fraud Risk
              </button>
              <button data-view="process">
                <span className="ic">◫</span> Process Review
              </button>
              <button data-view="external">
                <span className="ic">❖</span> External Findings
              </button>
              <button data-view="iasa">
                <span className="ic">⚖</span> IA Self-Assessment
              </button>
            </div>

            <div className="nav-section">
              <div className="nav-label">System</div>
              <button data-view="guide">
                <span className="ic">◇</span> How to use AMS
              </button>
              <button data-view="settings">
                <span className="ic">⚙</span> Settings &amp; Backup
              </button>
            </div>
          </nav>

          <div className="foot">
            Data stored in this browser only.
            <br />
            Back up via Settings.
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div className="topbar-left">
              <h2 id="pageTitle">CAE / MD Dashboard</h2>
              <div className="crumbs" id="crumbs" />
            </div>
            <div className="topbar-right">
              <div className="row" id="topActions" />
            </div>
          </div>
          <div id="banner" />
          <div className="content" id="content" />
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
