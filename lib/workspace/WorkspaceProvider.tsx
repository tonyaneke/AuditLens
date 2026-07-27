"use client";

// React port of the legacy data layer (audit-bot.js lines ~177-247), semantics preserved:
//  - one workspace blob, GET /api/data on mount, PUT /api/data (whole blob) on save
//  - save() debounced 400ms; saveNow() flushes; pending saves flushed on pagehide
//  - 4s polling that adopts the server copy ONLY when updatedAt changed, and never while a
//    save is in flight, an AI call is running, a modal is open, or the user is mid-input
// The blob lives in a stable mutable store object (held in state, like the legacy DB global);
// mutate() bumps a version counter to re-render. Rule for consumers: read db at event time,
// never across awaits.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { defaultWorkspace, type WorkspaceDb } from "./types";
import { isSyncPaused } from "./sync-pause";

type Store = {
  db: WorkspaceDb;
  lastUpdatedAt: string;
  pendingSave: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
};

// Module-level singleton — the React equivalent of the legacy `DB` global. Living outside
// React's ownership keeps in-place mutation legal for the React Compiler; the provider's
// version counter is what drives re-renders. Exactly one WorkspaceProvider mounts per page.
const store: Store = {
  db: defaultWorkspace(),
  lastUpdatedAt: "",
  pendingSave: false,
  saveTimer: null,
};

type WorkspaceApi = {
  /** The live workspace blob. Mutate only via mutate(). */
  db: WorkspaceDb;
  ready: boolean;
  /** Monotonic counter — bumped on every mutation/poll adoption (useful as an effect dep). */
  version: number;
  /** Run an in-place mutation, re-render, and schedule a debounced save. */
  mutate: (fn: (db: WorkspaceDb) => void) => void;
  /** Schedule the debounced save without mutating (legacy save()). */
  save: () => void;
  /** Flush any pending save immediately; resolves when the server write completes. */
  saveNow: () => Promise<void>;
  /** Force a re-fetch from the server (adopts unconditionally). */
  refresh: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const saveNow = useCallback(async () => {
    if (store.saveTimer) {
      clearTimeout(store.saveTimer);
      store.saveTimer = null;
    }
    if (!store.pendingSave) return;
    try {
      const res = await fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: store.db }),
      });
      store.pendingSave = false;
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j && j.updatedAt) store.lastUpdatedAt = j.updatedAt;
      }
    } catch {
      store.pendingSave = false;
    }
  }, []);

  const save = useCallback(() => {
    if (!ready) return;
    store.pendingSave = true;
    if (store.saveTimer) clearTimeout(store.saveTimer);
    store.saveTimer = setTimeout(() => {
      void saveNow();
    }, 400);
  }, [ready, saveNow]);

  const mutate = useCallback(
    (fn: (db: WorkspaceDb) => void) => {
      fn(store.db);
      bump();
      save();
    },
    [bump, save],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/data");
      if (!res.ok) return;
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data.audits)) {
        store.db = json.data as WorkspaceDb;
        if (json.updatedAt) store.lastUpdatedAt = json.updatedAt;
        bump();
      }
    } catch {
      /* keep current copy */
    }
  }, [bump]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data");
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json && json.data && Array.isArray(json.data.audits)) {
            store.db = json.data as WorkspaceDb;
            if (json.updatedAt) store.lastUpdatedAt = json.updatedAt;
          }
        }
      } catch {
        /* default workspace stays */
      }
      if (!cancelled) {
        setReady(true);
        bump();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bump]);

  // Poll for other users' changes (legacy pollData semantics). Two-step: a byte-sized
  // ?meta=1 watermark check every tick; the full multi-MB blob is fetched only on change.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(async () => {
      if (store.pendingSave || isSyncPaused()) return;
      try {
        const metaRes = await fetch("/api/data?meta=1");
        if (!metaRes.ok) return;
        const meta = await metaRes.json();
        if (!meta || !meta.updatedAt || meta.updatedAt === store.lastUpdatedAt) return;
        if (store.pendingSave || isSyncPaused()) return; // state may have changed mid-flight
        const res = await fetch("/api/data");
        if (!res.ok) return;
        const json = await res.json();
        if (
          json &&
          json.updatedAt &&
          json.updatedAt !== store.lastUpdatedAt &&
          json.data &&
          Array.isArray(json.data.audits)
        ) {
          store.lastUpdatedAt = json.updatedAt;
          store.db = json.data as WorkspaceDb;
          bump();
        }
      } catch {
        /* transient */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [ready, bump]);

  // Never lose a debounced write on tab close / cross-shell navigation.
  useEffect(() => {
    const flush = () => {
      if (!store.pendingSave) return;
      try {
        void fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: store.db }),
          keepalive: true,
        });
        store.pendingSave = false;
      } catch {
        /* best effort */
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const api = useMemo<WorkspaceApi>(
    () => ({ db: store.db, ready, version, mutate, save, saveNow, refresh }),
    [ready, version, mutate, save, saveNow, refresh],
  );

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
