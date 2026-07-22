export const MAIN_VIEWS = ["dashboard", "audits", "tracker"] as const;

export const ASSESSMENT_VIEWS = [
  "auditra",
  "fraud",
  "process",
  "external",
  "iasa",
] as const;

export const ADMIN_VIEWS = ["settings", "auditlog"] as const;

// Views available to a department-head "action owner" (their remediation portal).
export const OWNER_VIEWS = ["myobs"] as const;

export const ALL_VIEWS = [
  ...MAIN_VIEWS,
  ...ASSESSMENT_VIEWS,
  ...ADMIN_VIEWS,
  ...OWNER_VIEWS,
] as const;

export type AppView = (typeof ALL_VIEWS)[number];

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

export function canAccessView(user: SessionUser, view: string): boolean {
  if (user.role === "action_owner") {
    return (OWNER_VIEWS as readonly string[]).includes(view);
  }
  if (user.role === "head_of_audit") {
    if (
      [
        "audit",
        "report",
        "observation",
        "newobs",
        "insights",
        "guide",
      ].includes(view)
    ) {
      return true;
    }
    return (ALL_VIEWS as readonly string[]).includes(view);
  }
  if ((MAIN_VIEWS as readonly string[]).includes(view)) return true;
  if (view === "settings" || view === "auditlog") return false;
  return user.sidebarAccess.includes(view);
}

export function allowedViews(user: SessionUser): string[] {
  if (user.role === "action_owner") return [...OWNER_VIEWS];
  if (user.role === "head_of_audit") return [...ALL_VIEWS];
  const views: string[] = [...MAIN_VIEWS];
  for (const v of user.sidebarAccess) {
    if ((ASSESSMENT_VIEWS as readonly string[]).includes(v)) views.push(v);
  }
  return views;
}
