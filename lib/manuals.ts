/* The two published user manuals.
 *
 * Both are generated into public/docs by scripts/build-docs.mts and served as ordinary static
 * documents at these relative paths. They are NOT in proxy.ts's PUBLIC_PATHS, so a request without
 * a valid session is redirected to /login like any other page — the figures inside them are real
 * screenshots of real observations, names and email addresses, and must stay behind the cookie.
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
