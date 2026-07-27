"use client";

// Central "don't clobber the user" registry for the workspace poller — the React equivalent
// of the legacy pollData() guards (modal open, AI busy, user mid-input). Modal/AI providers
// register named pauses; composers register while they hold unposted text; and a live
// activeElement check covers plain focused fields, exactly like legacy userIsComposing().

import { useEffect } from "react";

const pauses = new Set<string>();

export function pauseSync(token: string): void {
  pauses.add(token);
}
export function resumeSync(token: string): void {
  pauses.delete(token);
}

function userIsComposing(): boolean {
  if (typeof document === "undefined") return false;
  const ae = document.activeElement as HTMLElement | null;
  return !!(
    ae &&
    (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.isContentEditable)
  );
}

export function isSyncPaused(): boolean {
  return pauses.size > 0 || userIsComposing();
}

/** Register a pause while `dirty` is true (e.g. a composer holding unposted text). */
export function useComposingGuard(token: string, dirty: boolean): void {
  useEffect(() => {
    if (dirty) pauseSync(token);
    else resumeSync(token);
    return () => resumeSync(token);
  }, [token, dirty]);
}
