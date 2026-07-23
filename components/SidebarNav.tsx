"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Analytics01Icon,
  BookOpen01Icon,
  CheckmarkBadge01Icon,
  DashboardSquare01Icon,
  File01Icon,
  Folder01Icon,
  JusticeScale01Icon,
  Logout01Icon,
  Settings01Icon,
  TaskDaily01Icon,
  TransactionHistoryIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import type { SessionUser } from "@/lib/permissions";
import { ASSESSMENT_VIEWS, MAIN_VIEWS } from "@/lib/permissions";

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
    label: "Oversight",
    items: [
      { view: "approvals", label: "Approvals", icon: CheckmarkBadge01Icon },
      { view: "exco", label: "Executive Assurance Brief", icon: JusticeScale01Icon },
    ],
  },
  {
    label: "Portal",
    items: [
      { view: "myobs", label: "Internal Observations", icon: Folder01Icon },
      { view: "myext", label: "External Observations", icon: BookOpen01Icon },
      { view: "myfraud", label: "Fraud Risk Control Tracker", icon: Alert02Icon },
    ],
  },
];

type SidebarNavProps = {
  user: SessionUser;
};

function formatRole(role: string) {
  if (role === "head_of_audit") return "Head of Audit";
  if (role === "action_owner") return "Action Owner";
  return "Audit Staff";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function navigate(view: string) {
  const w = window as Window & { go?: (v: string) => void };
  if (typeof w.go === "function") {
    w.go(view);
    return;
  }
  window.dispatchEvent(
    new CustomEvent("ams-navigate", { detail: { view } }),
  );
  const btn = document.querySelector(
    `#nav button[data-view="${view}"]`,
  ) as HTMLButtonElement | null;
  btn?.click();
}

function onProfileNav(
  e: MouseEvent,
  view: string,
) {
  e.preventDefault();
  navigate(view);
}

export default function SidebarNav({ user }: SidebarNavProps) {
  const [signingOut, setSigningOut] = useState(false);
  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }
  const isHead = user.role === "head_of_audit";
  const isOwner = user.role === "action_owner";
  const access = isHead
    ? new Set<string>([...MAIN_VIEWS, ...ASSESSMENT_VIEWS, "approvals", "exco"])
    : isOwner
      ? new Set<string>(["dashboard", "myobs", "myext", "myfraud"])
      : new Set<string>([...MAIN_VIEWS, ...(user.sidebarAccess || [])]);

  return (
    <>
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
                    <HugeiconsIcon
                      icon={item.icon}
                      size={ICON_SIZE}
                      strokeWidth={1.75}
                    />
                  </span>
                  {item.label}
                </button>
              ))}
            </div>
          );
        })}
        <div className="nav-spacer" aria-hidden="true" />
      </nav>

      <div className="sidebar-profile">
        <div className="sidebar-profile-head">
          <div className="sidebar-profile-avatar" aria-hidden="true">
            {user.photo ? (
              <img src={user.photo} alt="" className="sidebar-profile-avatar-img" />
            ) : (
              initials(user.name)
            )}
          </div>
          <div className="sidebar-profile-meta">
            <div className="sidebar-profile-name">{user.name}</div>
            <div className="sidebar-profile-role">{formatRole(user.role)}</div>
          </div>
          {isHead ? (
            <div className="sidebar-profile-dropdown">
              <div className="sidebar-profile-dropdown-panel">
              <button
                type="button"
                className="sidebar-profile-dropdown-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => onProfileNav(e, "settings")}
              >
                <HugeiconsIcon
                  icon={Settings01Icon}
                  size={16}
                  strokeWidth={1.75}
                />
                Settings
              </button>
              <button
                type="button"
                className="sidebar-profile-dropdown-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => onProfileNav(e, "auditlog")}
              >
                <HugeiconsIcon
                  icon={TransactionHistoryIcon}
                  size={16}
                  strokeWidth={1.75}
                />
                Audit log
              </button>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="sidebar-signout"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
        >
          {signingOut ? (
            <span className="btn-spin" aria-hidden="true" />
          ) : (
            <HugeiconsIcon icon={Logout01Icon} size={16} strokeWidth={1.75} />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );
}
