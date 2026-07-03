export const MAIN_VIEWS = ["dashboard", "audits", "tracker"] as const;

export const ASSESSMENT_VIEWS = [
  "auditra",
  "fraud",
  "process",
  "external",
  "iasa",
] as const;

export const ALL_VIEWS = [...MAIN_VIEWS, ...ASSESSMENT_VIEWS, "settings"] as const;

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
  if ((MAIN_VIEWS as readonly string[]).includes(view)) return true;
  if (view === "settings") return user.role === "head_of_audit";
  return user.sidebarAccess.includes(view);
}

export function allowedViews(user: SessionUser): string[] {
  const views: string[] = [...MAIN_VIEWS];
  for (const v of user.sidebarAccess) {
    if ((ASSESSMENT_VIEWS as readonly string[]).includes(v)) views.push(v);
  }
  if (user.role === "head_of_audit") views.push("settings");
  return views;
}
