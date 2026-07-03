"use client";

import { FormEvent, useState } from "react";
import type { SessionUser } from "@/lib/permissions";

type ChangePasswordModalProps = {
  user: SessionUser;
  onSuccess: (user: SessionUser) => void;
};

export default function ChangePasswordModal({
  user,
  onSuccess,
}: ChangePasswordModalProps) {
  const isFirstLogin = user.mustChangePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: isFirstLogin ? undefined : currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not change password.");
        return;
      }
      onSuccess(data.user);
    } catch {
      setError("Could not change password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pw-change-overlay" role="dialog" aria-modal="true">
      <div className="pw-change-modal">
        <h3>{isFirstLogin ? "Set your password" : "Change your password"}</h3>
        <p className="hint">
          {isFirstLogin
            ? `Welcome, ${user.name}. Choose a password to finish setting up your account.`
            : `Update the password for ${user.name}.`}
        </p>
        <form onSubmit={onSubmit}>
          {!isFirstLogin ? (
            <>
              <label htmlFor="pw-current">Current password</label>
              <input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </>
          ) : null}
          <label htmlFor="pw-new">New password</label>
          <input
            id="pw-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <label htmlFor="pw-confirm">Confirm new password</label>
          <input
            id="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {error ? <div className="login-error">{error}</div> : null}
          <button className="btn pw-change-submit" type="submit" disabled={loading}>
            {loading ? "Saving…" : isFirstLogin ? "Save password" : "Save new password"}
          </button>
        </form>
      </div>
    </div>
  );
}
