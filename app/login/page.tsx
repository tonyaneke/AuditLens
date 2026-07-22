"use client";

import { useEffect, useState } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  not_provisioned:
    "Your Microsoft account isn't set up in AuditLens yet. Ask your Head of Audit to add you, then try again.",
  sso_failed: "Microsoft sign-in didn't complete. Please try again.",
  sso_state: "Your sign-in session expired. Please try again.",
  sso_no_email: "Your Microsoft account didn't return an email address. Contact your administrator.",
  sso_unconfigured: "Single sign-on isn't configured yet. Contact your administrator.",
};

export default function LoginPage() {
  const [logo, setLogo] = useState("/org-logo.png");
  const [org, setOrg] = useState("Audit Management System");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.logo) setLogo(data.logo);
        if (data?.org) setOrg(data.org);
      })
      .catch(() => {});
    try {
      const code = new URLSearchParams(window.location.search).get("error");
      if (code) setError(ERROR_MESSAGES[code] || "Sign-in failed. Please try again.");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap">
            <img src={logo} alt="" className="login-logo" />
          </div>
          <div className="login-brand-name">AuditLens</div>
          <div className="login-brand-tag">{org}</div>
        </div>
        <h1 className="login-title">Sign in</h1>
        <p className="login-sub">Use your organisation&apos;s Microsoft account to access AuditLens.</p>

        {error ? <div className="login-error">{error}</div> : null}

        <a className="btn login-submit login-ms" href="/api/auth/azure/start">
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </a>

        <p className="login-sub" style={{ marginTop: 16, fontSize: 12.5 }}>
          
        </p>
      </div>
    </div>
  );
}
