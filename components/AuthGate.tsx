"use client";

import { ReactNode, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/permissions";
import ChangePasswordModal from "./ChangePasswordModal";

type AuthGateProps = {
  children: (user: SessionUser) => ReactNode;
};

export default function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          window.location.href = "/login";
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          (window as Window & { AMS_USER?: SessionUser }).AMS_USER = data.user;
          setUser(data.user);
        }
      } catch {
        window.location.href = "/login";
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handlePasswordChanged(nextUser: SessionUser) {
    (window as Window & { AMS_USER?: SessionUser }).AMS_USER = nextUser;
    setUser(nextUser);
  }

  if (loading || !user) {
    return (
      <div className="auth-loading">
        <span className="ai-busy-spinner" aria-hidden="true" />
        Loading…
      </div>
    );
  }

  return (
    <>
      {user.mustChangePassword ? (
        <ChangePasswordModal user={user} onSuccess={handlePasswordChanged} />
      ) : null}
      <div className={user.mustChangePassword ? "app-blocked" : undefined}>
        {children(user)}
      </div>
    </>
  );
}
