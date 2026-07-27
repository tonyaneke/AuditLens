export const MAIN_VIEWS = ["dashboard", "audits", "tracker"] as const;

export const ASSESSMENT_VIEWS = [
  "auditra",
  "fraud",
  "process",
  "external",
  "iasa",
] as const;

export const ADMIN_VIEWS = ["settings", "auditlog"] as const;

// Head-of-Audit oversight sections.
export const OVERSIGHT_VIEWS = ["approvals", "exco"] as const;

// Views available to a department-head "action owner" (their remediation portal).
export const OWNER_VIEWS = [
  "dashboard",
  "myobs",
  "myext",
  "myfraud",
  "observation",
  "extfinding",
] as const;

// Detail / helper views reachable from list pages (not shown in the sidebar).
export const DETAIL_VIEWS = [
  "audit",
  "report",
  "observation",
  "sopupdate",
  "extfinding",
  "raunit",
  "fraudrisk",
  "newobs",
  "insights",
  "guide",
] as const;

export const ALL_VIEWS = [
  ...new Set<string>([
    ...MAIN_VIEWS,
    ...ASSESSMENT_VIEWS,
    ...OVERSIGHT_VIEWS,
    ...ADMIN_VIEWS,
    ...OWNER_VIEWS,
    ...DETAIL_VIEWS,
  ]),
] as string[];

export type AppView =
  | (typeof MAIN_VIEWS)[number]
  | (typeof ASSESSMENT_VIEWS)[number]
  | (typeof OVERSIGHT_VIEWS)[number]
  | (typeof ADMIN_VIEWS)[number]
  | (typeof OWNER_VIEWS)[number]
  | (typeof DETAIL_VIEWS)[number];

export const KNOWN_ROLES = [
  "head_of_audit",
  "audit_staff",
  "action_owner",
] as const;

export function normalizeRole(raw: unknown): string {
  return (KNOWN_ROLES as readonly string[]).includes(String(raw))
    ? String(raw)
    : "audit_staff";
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  sidebarAccess: string[];
  mustChangePassword: boolean;
  // Microsoft profile photo (data URL). Present on DB-sourced sessions (/api/auth/me, directory),
  // not carried in the session cookie/JWT to keep it small.
  photo?: string | null;
};

export function normalizeSidebarAccess(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is string =>
      typeof v === "string" &&
      (ASSESSMENT_VIEWS as readonly string[]).includes(v),
  );
}

// Behavioral spec: canAccessView in public/audit-bot.js (frozen legacy copy). Owners get their
// portal + shared detail pages; the head gets everything; staff get the main sections, their
// granted assessment sections, and detail pages — never settings/audit log.
export function canAccessView(user: SessionUser, view: string): boolean {
  if (user.role === "action_owner") {
    return (OWNER_VIEWS as readonly string[]).includes(view);
  }
  if (user.role === "head_of_audit") {
    return (ALL_VIEWS as readonly string[]).includes(view);
  }
  if ((MAIN_VIEWS as readonly string[]).includes(view)) return true;
  if ((ADMIN_VIEWS as readonly string[]).includes(view)) return false;
  if ((DETAIL_VIEWS as readonly string[]).includes(view)) return true;
  return user.sidebarAccess.includes(view);
}

export function allowedViews(user: SessionUser): string[] {
  if (user.role === "action_owner") return [...OWNER_VIEWS];
  if (user.role === "head_of_audit") return [...ALL_VIEWS];
  const views: string[] = [...MAIN_VIEWS, ...DETAIL_VIEWS];
  for (const v of user.sidebarAccess) {
    if ((ASSESSMENT_VIEWS as readonly string[]).includes(v)) views.push(v);
  }
  return views;
}

// Sidebar sections a user actually sees (nav only — detail views are reached from lists).
export function visibleViews(user: SessionUser): string[] {
  if (user.role === "action_owner") return ["dashboard", "myobs", "myext", "myfraud"];
  if (user.role === "head_of_audit") {
    return [...MAIN_VIEWS, ...ASSESSMENT_VIEWS, ...OVERSIGHT_VIEWS];
  }
  return [
    ...MAIN_VIEWS,
    ...user.sidebarAccess.filter((v) =>
      (ASSESSMENT_VIEWS as readonly string[]).includes(v),
    ),
  ];
}
