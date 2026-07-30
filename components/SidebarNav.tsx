"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { effectiveRole, isAdmin, visibleViews } from "@/lib/permissions";
import { pendingApprovalCount } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import RoleSwitcher from "./RoleSwitcher";
import {
  hrefForView,
  MIGRATED_VIEWS,
  viewForPathname,
  type ViewKey,
} from "@/lib/routes";

const ICON_SIZE = 20;

type NavItem = {
  view: ViewKey;
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
  /** "legacy": the audit-bot.js shell (window.go navigation, data-view buttons).
   *  "app": the React shell (Link/anchor navigation, pathname-based active state). */
  shell?: "legacy" | "app";
};

function formatRole(role: string) {
  if (role === "head_of_audit") return "Head of Audit";
  if (role === "action_owner") return "Action Owner";
  if (role === "admin") return "Admin";
  return "Audit Staff";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* Pending-approvals count on the Approvals item — port of legacy updateApprovalsBadge().
   Mounted only in the app shell (the legacy shell's script maintains its own badge on the
   data-view buttons) and only for the Head, who is the one the queue waits on. Split into a
   component so useWorkspace is called strictly inside the app shell's WorkspaceProvider. */
function ApprovalsBadge() {
  const { db } = useWorkspace();
  const n = pendingApprovalCount(db);
  if (!n) return null;
  return <span className="nav-badge">{n}</span>;
}

// Legacy-shell navigation: prefer window.go (the script's router — its bridge redirects
// migrated views to real URLs), with the historical fallbacks kept intact.
function legacyNavigate(view: string) {
  const w = window as Window & { go?: (v: string) => void };
  if (typeof w.go === "function") {
    w.go(view);
    return;
  }
  window.dispatchEvent(new CustomEvent("ams-navigate", { detail: { view } }));
  const btn = document.querySelector(
    `#nav button[data-view="${view}"]`,
  ) as HTMLButtonElement | null;
  btn?.click();
}

export default function SidebarNav({ user, shell = "legacy" }: SidebarNavProps) {
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const activeView = shell === "app" ? viewForPathname(pathname || "/") : null;

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  function onProfileNav(e: MouseEvent, view: ViewKey) {
    e.preventDefault();
    if (shell === "legacy") legacyNavigate(view);
    else window.location.assign(hrefForView(view));
  }

  const access = new Set(visibleViews(user));

  return (
    <>
      <nav className="nav" id="nav">
        {SECTIONS.map((section) => {
          const items = section.items.filter((item) => access.has(item.view));
          if (!items.length) return null;
          return (
            <div className="nav-section" key={section.label}>
              <div className="nav-label">{section.label}</div>
              {items.map((item) => {
                const icon = (
                  <span className="ic">
                    <HugeiconsIcon icon={item.icon} size={ICON_SIZE} strokeWidth={1.75} />
                  </span>
                );
                if (shell === "app") {
                  const href = hrefForView(item.view);
                  const active = activeView === item.view;
                  const badge =
                    item.view === "approvals" && effectiveRole(user) === "head_of_audit" ? (
                      <ApprovalsBadge />
                    ) : null;
                  // Migrated targets: client-side <Link>. Legacy targets: plain anchor —
                  // a full page load hands over to the audit-bot shell.
                  return MIGRATED_VIEWS.has(item.view) ? (
                    <Link
                      key={item.view}
                      href={href}
                      data-view={item.view}
                      className={active ? "active" : undefined}
                    >
                      {icon}
                      {item.label}
                      {badge}
                    </Link>
                  ) : (
                    <a key={item.view} href={href} data-view={item.view}>
                      {icon}
                      {item.label}
                      {badge}
                    </a>
                  );
                }
                return (
                  <button
                    key={item.view}
                    type="button"
                    data-view={item.view}
                    className={item.view === "dashboard" ? "active" : undefined}
                  >
                    {icon}
                    {item.label}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className="nav-spacer" aria-hidden="true" />
      </nav>

      <div className="sidebar-profile">
        <div className="sidebar-profile-head">
          <div className="sidebar-profile-avatar" aria-hidden="true">
            {user.photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL avatar
              <img src={user.photo} alt="" className="sidebar-profile-avatar-img" />
            ) : (
              initials(user.name)
            )}
          </div>
          <div className="sidebar-profile-meta">
            <div className="sidebar-profile-name">{user.name}</div>
            <div className="sidebar-profile-role">
              {isAdmin(user) && user.activeRole
                ? `${formatRole(user.activeRole)} (Admin)`
                : formatRole(user.role)}
            </div>
          </div>
          {isAdmin(user) && <RoleSwitcher user={user} />}
          {effectiveRole(user) === "head_of_audit" ? (
            <div className="sidebar-profile-dropdown">
              <div className="sidebar-profile-dropdown-panel">
                <button
                  type="button"
                  className="sidebar-profile-dropdown-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => onProfileNav(e, "settings")}
                >
                  <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
                  Settings
                </button>
                <button
                  type="button"
                  className="sidebar-profile-dropdown-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => onProfileNav(e, "auditlog")}
                >
                  <HugeiconsIcon icon={TransactionHistoryIcon} size={16} strokeWidth={1.75} />
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
