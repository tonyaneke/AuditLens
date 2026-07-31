/* The two published user manuals.
 *
 * Both are generated into public/docs by scripts/build-docs.mts and served as ordinary static
 * documents at these relative paths. THEY DIFFER IN WHO MAY READ THEM:
 *
 *   user-manual.html          requires a session. Its Figure 11 is the Settings page — the live
 *                             user directory, with names, work addresses and personal Gmail
 *                             addresses — so it is absent from proxy.ts's PUBLIC_PATHS and a
 *                             request without a valid cookie is redirected to /login.
 *   action-owner-manual.html  is public, and listed in PUBLIC_PATHS. Action owners are given the
 *                             link before their accounts exist, so requiring a session to read the
 *                             page that explains how to sign in would defeat the point. Its figures
 *                             carry staff names and observation titles, but no addresses.
 *
 * Anything added to this list is NOT public by default — say so in proxy.ts deliberately, having
 * looked at the figures the document actually embeds.
 *
 * Kept here rather than inline so the Settings card and the sidebar's Help entry cannot drift
 * apart, and so a rename is one edit.
 */

export type Manual = {
  href: string;
  title: string;
  blurb: string;
  ico: string;
  /** Who the document is written for — the sidebar shows owners only their own. */
  audience: "all" | "owner";
};

export const MANUALS: Manual[] = [
  {
    href: "/docs/user-manual.html",
    title: "AuditLens User Manual",
    blurb:
      "The complete manual — audits, reports, observations, remediation, the assessment modules, oversight and administration.",
    ico: "📘",
    audience: "all",
  },
  {
    href: "/docs/action-owner-manual.html",
    title: "Action Owner Guide",
    blurb:
      "The short guide for department heads: finding your observations, responding to them, attaching evidence and closing them out.",
    ico: "📗",
    audience: "owner",
  },
];

export const OWNER_MANUAL = MANUALS.find((m) => m.audience === "owner")!;
export const FULL_MANUAL = MANUALS.find((m) => m.audience === "all")!;
