"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Analytics01Icon,
  BookOpen01Icon,
  DashboardSquare01Icon,
  File01Icon,
  JusticeScale01Icon,
  Settings01Icon,
  TaskDaily01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import type { SessionUser } from "@/lib/permissions";
import {
  ASSESSMENT_VIEWS,
  MAIN_VIEWS,
} from "@/lib/permissions";

const ICON_SIZE = 20;

type NavItem = {
  view: string;
  label: string;
  icon: typeof DashboardSquare01Icon;
};

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Main",
    items: [
      { view: "dashboard", label: "Dashboard", icon: DashboardSquare01Icon },
      { view: "audits", label: "Audits & Reports", icon: File01Icon },
      { view: "tracker", label: "Remediation Tracker", icon: TaskDaily01Icon },
    ],
  },
  {
    label: "Assessment",
    items: [
      { view: "auditra", label: "Audit Risk Assessment", icon: Analytics01Icon },
      { view: "fraud", label: "Fraud Risk", icon: Alert02Icon },
      { view: "process", label: "Process Review", icon: WorkflowSquare01Icon },
      { view: "external", label: "External Findings", icon: BookOpen01Icon },
      { view: "iasa", label: "IA Self-Assessment", icon: JusticeScale01Icon },
    ],
  },
];

type SidebarNavProps = {
  user: SessionUser;
};

export default function SidebarNav({ user }: SidebarNavProps) {
  const access = new Set<string>([
    ...MAIN_VIEWS,
    ...(user.sidebarAccess || []),
  ]);
  if (user.role === "head_of_audit") access.add("settings");

  return (
    <nav className="nav" id="nav">
      {SECTIONS.map((section) => {
        const items = section.items.filter((item) => access.has(item.view));
        if (!items.length) return null;
        return (
          <div className="nav-section" key={section.label}>
            <div className="nav-label">{section.label}</div>
            {items.map((item) => (
              <button
                key={item.view}
                type="button"
                data-view={item.view}
                className={item.view === "dashboard" ? "active" : undefined}
              >
                <span className="ic">
                  <HugeiconsIcon icon={item.icon} size={ICON_SIZE} strokeWidth={1.75} />
                </span>
                {item.label}
              </button>
            ))}
          </div>
        );
      })}
      {user.role === "head_of_audit" ? (
        <>
          <div className="nav-spacer" aria-hidden="true" />
          <div className="nav-section nav-section-footer">
            <div className="nav-label">System</div>
            <button type="button" data-view="settings">
              <span className="ic">
                <HugeiconsIcon icon={Settings01Icon} size={ICON_SIZE} strokeWidth={1.75} />
              </span>
              Settings
            </button>
          </div>
        </>
      ) : null}
    </nav>
  );
}

export { ASSESSMENT_VIEWS };
