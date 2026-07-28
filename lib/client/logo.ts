"use client";

// The org logo is a static asset (public/org-logo.png) — no longer stored in the workspace
// document. Word exports embed images as data URLs so the .doc works offline; this module
// fetches the static file once and caches the conversion. preloadOrgLogo() is kicked off by
// the app shell so the data URL is usually ready before the first export click.

export const ORG_LOGO_URL = "/org-logo.png";

let cached: string | undefined;
let inflight: Promise<string | undefined> | null = null;

export function preloadOrgLogo(): Promise<string | undefined> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(ORG_LOGO_URL);
      if (!res.ok) return undefined;
      const blob = await res.blob();
      cached = await new Promise<string>((resolve, reject) => {
        const rd = new FileReader();
        rd.onload = () => resolve(String(rd.result || ""));
        rd.onerror = () => reject(rd.error);
        rd.readAsDataURL(blob);
      });
      return cached;
    } catch {
      return undefined;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous read of the cached data URL (undefined until preload completes). */
export function orgLogoDataUrl(): string | undefined {
  if (!cached) void preloadOrgLogo();
  return cached;
}
