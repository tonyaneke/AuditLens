"use client";

import { FormEvent, useEffect, useState } from "react";

export default function AdminLoginForm() {
  const [logo, setLogo] = useState("/org-logo.png");
  const [org, setOrg] = useState("Audit Management System");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.logo) setLogo(data.logo);
        if (data?.org) setOrg(data.org);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign-in failed.");
        setPassword("");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
        <h1 className="login-title">Admin sign-in</h1>

        {error ? <div className="login-error">{error}</div> : null}

        <p className="login-sub">For the AuditLens Admin profile only.</p>
        <form className="login-form" onSubmit={onSubmit}>
          <label htmlFor="adminUsername">Username</label>
          <input
            id="adminUsername"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(ev) => setUsername(ev.target.value)}
            required
          />
          <label htmlFor="adminPassword">Password</label>
          <input
            id="adminPassword"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            required
          />
          <button className="btn login-submit" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-sub" style={{ marginTop: 16, fontSize: 12.5 }}>
          Staff sign in with Microsoft at <a href="/login">the usual sign-in page</a>.
        </p>
      </div>
    </div>
  );
}
