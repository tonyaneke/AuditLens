"use client";

// Cached user directory (port of legacy loadDirectory/_directoryCache). Module-level cache —
// loaded once per page, refreshed on demand. Consumers read synchronously via directory().

import type { WorkspaceDb } from "@/lib/workspace/types";

export type DirectoryUser = {
  id: string;
  name: string;
  email?: string;
  role?: string;
  active?: boolean;
  photo?: string;
};

let cache: DirectoryUser[] = [];
let inflight: Promise<DirectoryUser[]> | null = null;

export function directory(): DirectoryUser[] {
  return cache;
}

export async function loadDirectory(): Promise<DirectoryUser[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/directory");
      if (res.ok) {
        const json = await res.json();
        cache = json.users || [];
      }
    } catch {
      /* keep current cache */
    } finally {
      inflight = null;
    }
    return cache;
  })();
  return inflight;
}

export function dirUser(userId: string | undefined): DirectoryUser | undefined {
  return userId ? cache.find((u) => u.id === userId) : undefined;
}

export function headUsers(): DirectoryUser[] {
  return cache.filter((u) => u.role === "head_of_audit");
}

/** Email for a user id — directory first, then department-head fallback (legacy ownerEmailFor). */
export function ownerEmailFor(db: WorkspaceDb, userId: string | undefined): string {
  if (!userId) return "";
  const u = dirUser(userId);
  if (u && u.email) return u.email;
  const d = (db.departments || []).find((x) => x.headUserId === userId);
  return (d && d.headEmail) || "";
}

export function ownerNameFor(db: WorkspaceDb, userId: string | undefined): string {
  if (!userId) return "";
  const u = dirUser(userId);
  if (u && u.name) return u.name;
  const d = (db.departments || []).find((x) => x.headUserId === userId);
  return (d && d.headName) || "";
}

export function dirEmail(db: WorkspaceDb, userId: string | undefined): string {
  return ownerEmailFor(db, userId);
}
