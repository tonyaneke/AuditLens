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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@/components/feedback/ToastHost";
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

/* ---- fast boot: session snapshot + eager first fetch ----
   The workspace document takes seconds to download from the remote DB. Two tricks keep the
   skeleton short: (1) the last known copy is cached in sessionStorage and adopted instantly
   on reload (stale-while-revalidate — the fresh copy replaces it when it lands); (2) the
   first fetch starts at script-eval time, before React has even hydrated. */

const WS_CACHE_KEY = "al_ws_cache_v1";
type WsPayload = { data?: WorkspaceDb; updatedAt?: string };

function readCachedSnapshot(): { data: WorkspaceDb; updatedAt: string } | null {
  try {
    const raw = sessionStorage.getItem(WS_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { data?: WorkspaceDb; updatedAt?: string };
    if (j && j.data && Array.isArray(j.data.audits))
      return { data: j.data, updatedAt: String(j.updatedAt || "") };
  } catch {
    /* corrupt / absent */
  }
  return null;
}

function persistSnapshot(db: WorkspaceDb, updatedAt: string): void {
  try {
    sessionStorage.setItem(WS_CACHE_KEY, JSON.stringify({ data: db, updatedAt }));
  } catch {
    /* quota — skip; boot falls back to the network */
  }
}

let bootFetch: Promise<WsPayload | null> | null =
  typeof window !== "undefined"
    ? fetch("/api/data")
        .then((r) => (r.ok ? (r.json() as Promise<WsPayload>) : null))
        .catch(() => null)
    : null;

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
  // saveNow needs refresh() on a 409, but refresh is declared below it. Held in a ref so the
  // two don't have to be reordered or made mutually dependent.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

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
        /* QA-4 — send the watermark this save was built from. The server refuses the write
           with 409 if the stored document has moved on since, instead of silently overwriting
           whatever the other person just saved.

           Omitted entirely when we have no watermark (the initial GET has not landed yet), so
           a client that never saw a version is not locked out by a conflict it cannot resolve. */
        body: JSON.stringify(
          store.lastUpdatedAt
            ? { data: store.db, baseUpdatedAt: store.lastUpdatedAt }
            : { data: store.db },
        ),
      });
      store.pendingSave = false;
      if (res.status === 409) {
        // Someone else saved first. Their version is authoritative; take it and tell the user,
        // rather than reapplying ours on top of a document we never saw.
        const j = await res.json().catch(() => null);
        await refreshRef.current?.();
        toast(
          (j && j.message) ||
            "Someone else saved a change while you were editing. Your view has been refreshed — reapply your change and save again.",
          "error",
        );
        return;
      }
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j && j.updatedAt) store.lastUpdatedAt = j.updatedAt;
        persistSnapshot(store.db, store.lastUpdatedAt);
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
  refreshRef.current = refresh;

  // Initial load: adopt the session snapshot immediately (if any), then swap in the fresh
  // copy the moment the network delivers it.
  useEffect(() => {
    let cancelled = false;
    const cached = readCachedSnapshot();
    if (cached) {
      store.db = cached.data;
      store.lastUpdatedAt = cached.updatedAt;
      setTimeout(() => {
        if (!cancelled) {
          setReady(true);
          bump();
        }
      }, 0);
    }
    (async () => {
      let json: WsPayload | null = null;
      if (bootFetch) {
        json = await bootFetch;
        bootFetch = null;
      }
      if (json == null) {
        try {
          const res = await fetch("/api/data");
          if (res.ok) json = (await res.json()) as WsPayload;
        } catch {
          /* cached/default copy stays */
        }
      }
      if (!cancelled && json && json.data && Array.isArray(json.data.audits)) {
        // Never clobber typing/edits that began on the cached copy — the poll adopts later.
        if (!(cached && (store.pendingSave || isSyncPaused()))) {
          store.db = json.data;
          if (json.updatedAt) store.lastUpdatedAt = String(json.updatedAt);
          persistSnapshot(json.data, String(json.updatedAt || ""));
        }
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
          persistSnapshot(store.db, store.lastUpdatedAt);
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
          // QA-4 — the watermark goes on this path too. The page is unloading so there is no
          // opportunity to resolve a conflict interactively; losing the flush is the correct
          // outcome, because the alternative is overwriting a colleague's saved work.
          body: JSON.stringify(
            store.lastUpdatedAt
              ? { data: store.db, baseUpdatedAt: store.lastUpdatedAt }
              : { data: store.db },
          ),
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
