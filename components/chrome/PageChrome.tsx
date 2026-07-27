"use client";

// Topbar slot system for the new shell — the React replacement for the legacy #pageTitle /
// #topActions / #topSearch / #topBack ids. Pages declare their chrome with usePageChrome();
// the Topbar (in AppShell) renders it.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PageChrome = {
  title: string;
  actions?: ReactNode;
  search?: ReactNode;
  back?: ReactNode;
};

type ChromeApi = {
  chrome: PageChrome;
  setChrome: (c: PageChrome) => void;
};

const ChromeContext = createContext<ChromeApi | null>(null);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<PageChrome>({ title: "" });
  const api = useMemo(() => ({ chrome, setChrome }), [chrome]);
  return <ChromeContext.Provider value={api}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeApi {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error("useChrome must be used inside <PageChromeProvider>");
  return ctx;
}

/** Declare the page title / topbar actions for the current page. */
export function usePageChrome(chrome: PageChrome, deps: unknown[] = []): void {
  const { setChrome } = useChrome();
  useEffect(() => {
    setChrome(chrome);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chrome.title, setChrome, ...deps]);
}
