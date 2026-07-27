// Single source of truth for the view ↔ URL mapping during the audit-bot.js → App Router
// migration. Both shells consult this module:
//  - React pages/components build hrefs with urlForView()/legacyUrlFor().
//  - The legacy script receives { migrated, url } as window.AMS_ROUTES (see LegacyBridge) and
//    its go() redirects to the new shell whenever the target view has been migrated.
// A view lives in exactly one world at a time: flip it into MIGRATED_VIEWS as the last step of
// its migration phase (one-line revert if something breaks).

export type ViewKey =
  | "dashboard"
  | "audits"
  | "audit"
  | "report"
  | "observation"
  | "sopupdate"
  | "tracker"
  | "insights"
  | "auditra"
  | "raunit"
  | "fraud"
  | "fraudrisk"
  | "process"
  | "external"
  | "extfinding"
  | "iasa"
  | "approvals"
  | "exco"
  | "myobs"
  | "myext"
  | "myfraud"
  | "settings"
  | "auditlog"
  | "guide"
  | "newobs";

export type ViewOpts = {
  audit?: string;
  report?: string;
  obs?: string;
  ext?: string;
  unit?: string;
  fraud?: string;
  proc?: string;
  mode?: string;
  tab?: string;
  comments?: boolean;
};

// Views served by the new React shell. Grown per migration phase.
export const MIGRATED_VIEWS: ReadonlySet<ViewKey> = new Set<ViewKey>([
  "guide",
  "auditlog",
  "exco",
  "dashboard",
  "tracker",
  "insights",
  "auditra",
  "raunit",
  "iasa",
  "audits",
]);

// Where the legacy shell lives. Stage B (dashboard takes "/") moved it to /legacy.
export const LEGACY_BASE = "/legacy";

const q = (params: Record<string, string | undefined>) => {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
  const s = usp.toString();
  return s ? `?${s}` : "";
};

// Clean URL for a MIGRATED view. (Calling it for an unmigrated view still returns the future
// URL — use hrefForView() when you want automatic legacy fallback.)
export function urlForView(view: ViewKey, opts: ViewOpts = {}): string {
  switch (view) {
    case "dashboard":
      return "/";
    case "audits":
      return "/audits";
    case "audit":
      return `/audits/${opts.audit}`;
    case "report":
      return `/audits/${opts.audit}/reports/${opts.report}`;
    case "observation":
      return `/audits/${opts.audit}/reports/${opts.report}/observations/${opts.obs}${opts.comments ? "?comments=1" : ""}`;
    case "sopupdate":
      return `/audits/${opts.audit}/reports/${opts.report}/observations/${opts.obs}/sop`;
    case "tracker":
      return `/tracker${q({ mode: opts.mode })}`;
    case "insights":
      return "/tracker?mode=insights";
    case "auditra":
      return "/risk-assessment";
    case "raunit":
      return `/risk-assessment/${opts.unit}`;
    case "fraud":
      return "/fraud";
    case "fraudrisk":
      return `/fraud/${opts.fraud}`;
    case "process":
      return opts.proc ? `/process/${opts.proc}` : "/process";
    case "external":
      return `/external${q({ mode: opts.mode })}`;
    case "extfinding":
      return `/external/${opts.ext}`;
    case "iasa":
      return `/self-assessment${q({ tab: opts.tab })}`;
    case "approvals":
      return "/approvals";
    case "exco":
      return "/exco";
    case "myobs":
      return "/portal/observations";
    case "myext":
      return "/portal/external";
    case "myfraud":
      return "/portal/fraud";
    case "settings":
      return "/settings";
    case "auditlog":
      return "/audit-log";
    case "guide":
      return "/guide";
    case "newobs":
      // The "raise observation" modal — legacy-only until the audits phase migrates it.
      return legacyUrlFor("newobs");
  }
}

// URL that opens the LEGACY shell at a given view (the shell seeds its state from these params).
export function legacyUrlFor(view: ViewKey, opts: ViewOpts = {}): string {
  return (
    LEGACY_BASE +
    q({
      view,
      audit: opts.audit,
      report: opts.report,
      obs: opts.obs,
      ext: opts.ext,
      unit: opts.unit,
      fraud: opts.fraud,
      proc: opts.proc,
      mode: opts.mode,
      tab: opts.tab,
    })
  );
}

// The right href for a view wherever it currently lives.
export function hrefForView(view: ViewKey, opts: ViewOpts = {}): string {
  return MIGRATED_VIEWS.has(view) ? urlForView(view, opts) : legacyUrlFor(view, opts);
}

// Reverse-map a new-shell pathname to its view (permission guard). null = not a guarded
// app path (e.g. /legacy, /login, /brief).
export function viewForPathname(pathname: string): ViewKey | null {
  if (pathname === "/") return "dashboard";
  const seg = pathname.split("/").filter(Boolean);
  switch (seg[0]) {
    case "audits":
      if (seg.length === 1) return "audits";
      if (seg[2] === "reports") {
        if (seg[4] === "observations") return seg[6] === "sop" ? "sopupdate" : "observation";
        return "report";
      }
      return "audit";
    case "tracker":
      return "tracker";
    case "risk-assessment":
      return seg.length > 1 ? "raunit" : "auditra";
    case "fraud":
      return seg.length > 1 ? "fraudrisk" : "fraud";
    case "process":
      return "process";
    case "external":
      return seg.length > 1 ? "extfinding" : "external";
    case "self-assessment":
      return "iasa";
    case "approvals":
      return "approvals";
    case "exco":
      return "exco";
    case "portal":
      return seg[1] === "external" ? "myext" : seg[1] === "fraud" ? "myfraud" : "myobs";
    case "settings":
      return "settings";
    case "audit-log":
      return "auditlog";
    case "guide":
      return "guide";
    default:
      return null;
  }
}

// Payload for window.AMS_ROUTES on the legacy page. Kept serializable-simple: the legacy go()
// passes its opts object straight through to url().
export function legacyBridgeRoutes() {
  return {
    migrated: [...MIGRATED_VIEWS],
    url: (view: ViewKey, opts?: ViewOpts) => urlForView(view, opts || {}),
  };
}
