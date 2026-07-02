"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Analytics01Icon,
  Audit01Icon,
  BookOpen01Icon,
  DashboardSquare01Icon,
  File01Icon,
  HelpCircleIcon,
  JusticeScale01Icon,
  Settings01Icon,
  TaskDaily01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";

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
  {
    label: "System",
    items: [
      { view: "guide", label: "How to use AMS", icon: HelpCircleIcon },
      { view: "settings", label: "Settings & Backup", icon: Settings01Icon },
    ],
  },
];

export default function SidebarNav() {
  return (
    <nav className="nav" id="nav">
      {SECTIONS.map((section) => (
        <div className="nav-section" key={section.label}>
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => (
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
      ))}
    </nav>
  );
}
