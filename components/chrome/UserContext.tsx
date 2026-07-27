"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionUser } from "@/lib/permissions";

const UserContext = createContext<SessionUser | null>(null);

export function UserProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): SessionUser {
  const u = useContext(UserContext);
  if (!u) throw new Error("useUser must be used inside <UserProvider>");
  return u;
}
