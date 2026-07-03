export const MAIN_VIEWS = ["dashboard", "audits", "tracker"] as const;

export const ASSESSMENT_VIEWS = [
  "auditra",
  "fraud",
  "process",
  "external",
  "iasa",
] as const;

export const ADMIN_VIEWS = ["settings", "auditlog"] as const;

export const ALL_VIEWS = [
  ...MAIN_VIEWS,
  ...ASSESSMENT_VIEWS,
  ...ADMIN_VIEWS,
] as const;

export type AppView = (typeof ALL_VIEWS)[number];

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  department: string;
  role: string;
  sidebarAccess: string[];
  mustChangePassword: boolean;
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
  if (user.role === "head_of_audit") return [...ALL_VIEWS];
  const views: string[] = [...MAIN_VIEWS];
  for (const v of user.sidebarAccess) {
    if ((ASSESSMENT_VIEWS as readonly string[]).includes(v)) views.push(v);
  }
  return views;
}
