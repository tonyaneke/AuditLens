"use client";

import Script from "next/script";

export default function AuditApp() {
  return (
    <>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <img
              id="brandLogo"
              alt=""
              style={{
                maxHeight: 42,
                maxWidth: 170,
                marginBottom: 8,
                display: "none",
                background: "#fff",
                padding: "4px 6px",
                borderRadius: 6,
              }}
            />
            <h1>Audit Reporting Bot</h1>
            <small id="orgName">CREDICORP — Internal Audit</small>
          </div>
          <nav className="nav" id="nav">
            <button data-view="dashboard" className="active">
              <span className="ic">▦</span> CAE / MD Dashboard
            </button>
            <button data-view="auditra">
              <span className="ic">◈</span> Audit Risk Assessment
            </button>
            <button data-view="audits">
              <span className="ic">▤</span> Audits &amp; Reports
            </button>
            <button data-view="newobs">
              <span className="ic">✎</span> New Observation
            </button>
            <button data-view="tracker">
              <span className="ic">◷</span> Remediation Tracker
            </button>
            <button data-view="process">
              <span className="ic">◫</span> Process Review
            </button>
            <button data-view="fraud">
              <span className="ic">⚠</span> Fraud Risk Assessment
            </button>
            <button data-view="external">
              <span className="ic">❖</span> External Findings
            </button>
            <button data-view="iasa">
              <span className="ic">⚖</span> IA Self-Assessment
            </button>
            <button data-view="guide">
              <span className="ic">◇</span> How to use the bot
            </button>
            <button data-view="settings">
              <span className="ic">⚙</span> Settings &amp; Backup
            </button>
          </nav>
          <div className="foot">
            Data is stored only in this browser.
            <br />
            Use Settings → Backup to save a copy.
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <div>
              <h2 id="pageTitle">CAE / MD Dashboard</h2>
              <div className="crumbs" id="crumbs" />
            </div>
            <div className="row" id="topActions" />
          </div>
          <div id="banner" />
          <div className="content" id="content" />
        </main>
      </div>

      <div className="overlay" id="overlay">
        <div className="modal">
          <div className="mh">
            <h3 id="modalTitle">Title</h3>
            <button className="x" onClick={() => (window as AuditBotWindow).closeModal?.()}>
              ×
            </button>
          </div>
          <div className="mb" id="modalBody" />
          <div className="mf" id="modalFoot" />
        </div>
      </div>

      <Script src="/audit-bot.js" strategy="afterInteractive" />
    </>
  );
}

type AuditBotWindow = Window & {
  closeModal?: () => void;
};
