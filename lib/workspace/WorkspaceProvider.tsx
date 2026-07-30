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

/* QA-7 — adaptive poll interval. Starts fast so an active editing session sees a colleague's
   change within a few seconds, then eases off while nothing is happening. Any observed change,
   or the user returning to the tab, snaps it straight back to POLL_MIN_MS. */
const POLL_MIN_MS = 4000;
const POLL_MAX_MS = 30000;
const POLL_BACKOFF = 1.5;

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

/* QA-7 — the eager first fetch, started at module-eval time so the download overlaps hydration.
   It used to fire unconditionally, including on /login, where there is no session: proxy.ts
   401s it and the .catch swallowed the failure silently. That is a wasted round trip on the one
   page where the user is waiting, and it made the network panel look busier than the app is.
   Skipped on the public routes, which are the only ones that render without a session. */
const PUBLIC_PATHS = ["/login", "/brief"];

function shouldBootFetch(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  return !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

let bootFetch: Promise<WsPayload | null> | null = shouldBootFetch()
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
  // Assigned in an effect, not during render — a ref write during render is not a legal
  // side effect and React can discard the render it happened in.
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

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

  /* Poll for other users' changes (legacy pollData semantics). Two-step: a byte-sized
     ?meta=1 watermark check every tick; the full multi-MB blob is fetched only on change.

     QA-7 — the audit counted 40+ watermark requests on one screen. A fixed 4s tick is ~900
     requests per hour per open tab, and it ran whether or not anyone was looking at the page.
     Two changes, neither of which weakens the "see colleagues' edits promptly" guarantee:

       1. Nothing polls while the tab is hidden. A background tab has no reader to keep current,
          and the visibilitychange handler below re-syncs immediately on return — so coming back
          to a tab is *fresher* than before, not staler.
       2. The interval backs off from 4s toward 30s while the document is unchanged, and resets
          to 4s the moment anything changes. Active collaboration keeps the fast tick; a tab left
          open on a quiet document settles down to two requests a minute. */
  useEffect(() => {
    if (!ready) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = POLL_MIN_MS;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (stopped) return;
      // Skip a beat rather than fighting an in-flight save or an open modal.
      if (store.pendingSave || isSyncPaused() || document.hidden) {
        schedule();
        return;
      }
      try {
        const metaRes = await fetch("/api/data?meta=1");
        if (!metaRes.ok) return;
        const meta = await metaRes.json();
        if (!meta || !meta.updatedAt || meta.updatedAt === store.lastUpdatedAt) {
          // Unchanged: ease off, up to the ceiling.
          delay = Math.min(POLL_MAX_MS, Math.round(delay * POLL_BACKOFF));
          return;
        }
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
          delay = POLL_MIN_MS; // someone is working — go back to the fast tick
        }
      } catch {
        /* transient */
      } finally {
        schedule();
      }
    }

    // Returning to the tab re-syncs at once and restarts fast, so a hidden tab never shows a
    // stale document to someone who has just looked at it.
    const onVisible = () => {
      if (document.hidden || stopped) return;
      delay = POLL_MIN_MS;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
