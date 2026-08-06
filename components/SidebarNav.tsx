"use client";

import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  MoreVerticalIcon,
  Settings01Icon,
  TaskDaily01Icon,
  TransactionHistoryIcon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import type { SessionUser } from "@/lib/permissions";
import { displayRoleLabel, effectiveRole, isAdmin, visibleViews } from "@/lib/permissions";
import { FULL_MANUAL, OWNER_MANUAL } from "@/lib/manuals";
import {
  myExtPendingCount,
  myFraudPendingCount,
  myObsPendingCount,
} from "@/lib/workspace/portal";
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

// Portal items that carry an outstanding-work dot (shown to whoever owns the items).
const PORTAL_DOT_VIEWS: ReadonlySet<ViewKey> = new Set<ViewKey>(["myobs", "myext", "myfraud"]);

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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* QA-15 — profile-menu entry. In the React shell this is a real <Link>, so Settings and the
   audit log navigate client-side instead of reloading the document and re-downloading the whole
   workspace. The legacy shell has no router, so it keeps the imperative navigate(). */
function ProfileNavItem({
  view,
  shell,
  onLegacyNav,
  onNavigate,
  children,
}: {
  view: ViewKey;
  shell: "app" | "legacy";
  onLegacyNav: (e: MouseEvent, view: ViewKey) => void;
  onNavigate: () => void;
  children: ReactNode;
}) {
  if (shell === "legacy") {
    return (
      <button
        type="button"
        role="menuitem"
        className="sidebar-profile-dropdown-item"
        onClick={(e) => {
          onNavigate();
          onLegacyNav(e, view);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <Link
      href={hrefForView(view)}
      role="menuitem"
      className="sidebar-profile-dropdown-item"
      onClick={onNavigate}
    >
      {children}
    </Link>
  );
}

/* SEC-06 — the profile menu holding Settings and the Audit log.
 *
 * The audit found the audit-log control "non-functional": clicking it produced no dialog, no
 * route change and no network request. The viewer itself was fine — there was simply no way to
 * open the menu. It had NO trigger element at all: the panel was revealed purely by CSS
 * :hover / :focus-within on the surrounding row, and because the panel was `visibility: hidden`
 * its links sat outside the tab order, so :focus-within could never fire from the keyboard and
 * the only way in was to happen to hover the right 220px strip. An `onMouseDown` preventDefault
 * on each item propped the hack up by stopping the click from moving focus.
 *
 * Replaced with an ordinary disclosure: a real button, aria-expanded, Escape to close with focus
 * returned to the trigger, and outside-click to dismiss. The panel is `hidden` when closed, so it
 * is out of the tab order because it is genuinely not available — not as a side effect of styling.
 */
function ProfileMenu({
  shell,
  onLegacyNav,
}: {
  shell: "app" | "legacy";
  onLegacyNav: (e: MouseEvent, view: ViewKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  return (
    <div className="sidebar-profile-dropdown" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="sidebar-profile-dropdown-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="sidebar-profile-menu"
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <HugeiconsIcon icon={MoreVerticalIcon} size={16} strokeWidth={1.75} aria-hidden={true} />
      </button>
      <div
        id="sidebar-profile-menu"
        role="menu"
        aria-label="Account"
        className="sidebar-profile-dropdown-panel"
        hidden={!open}
      >
        <ProfileNavItem
          view="settings"
          shell={shell}
          onLegacyNav={onLegacyNav}
          onNavigate={() => close(false)}
        >
          <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.75} />
          Settings
        </ProfileNavItem>
        <ProfileNavItem
          view="auditlog"
          shell={shell}
          onLegacyNav={onLegacyNav}
          onNavigate={() => close(false)}
        >
          <HugeiconsIcon icon={TransactionHistoryIcon} size={16} strokeWidth={1.75} />
          Audit log
        </ProfileNavItem>
      </div>
    </div>
  );
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

/* Action-owner portal: a red count on a portal item shows how many items are still open and
   awaiting a response, so they can see what is outstanding without opening each page.
   Items already sent back to Internal Audit are excluded — the ball is not with them.
   Observations and external findings count the whole DEPARTMENT (anyone in it can answer them);
   fraud actions stay personal, because those are still assigned to an individual. */
function PendingDot({ view, user }: { view: ViewKey; user: SessionUser }) {
  const { db } = useWorkspace();
  const n =
    view === "myobs"
      ? myObsPendingCount(db, user)
      : view === "myext"
        ? myExtPendingCount(db, user)
        : view === "myfraud"
          ? myFraudPendingCount(db, user.id)
          : 0;
  if (!n) return null;
  const label =
    view === "myfraud"
      ? `${n} open item${n === 1 ? "" : "s"} awaiting your response`
      : `${n} open item${n === 1 ? "" : "s"} awaiting a response from your department`;
  return (
    <span className="nav-badge" title={label} aria-label={label}>
      {n}
    </span>
  );
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
                    ) : PORTAL_DOT_VIEWS.has(item.view) ? (
                      <PendingDot view={item.view} user={user} />
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
              // eslint-disable-next-line @next/next/no-img-element -- see Avatar in components/ui
              <img src={user.photo} alt="" className="sidebar-profile-avatar-img" />
            ) : (
              initials(user.name)
            )}
          </div>
          <div className="sidebar-profile-meta">
            <div className="sidebar-profile-name">{user.name}</div>
            <div className="sidebar-profile-role">{displayRoleLabel(user)}</div>
          </div>
          {effectiveRole(user) === "head_of_audit" ? (
            <ProfileMenu shell={shell} onLegacyNav={onProfileNav} />
          ) : null}
        </div>
        {/* QA-13 — the role switcher used to sit inside .sidebar-profile-head, a horizontal
            flex row. Its max-content width (~170px) exceeded the space left beside the 36px
            avatar in a 220px row, so free space went negative, flex-grow never applied, and
            .sidebar-profile-meta stayed at its 0 flex-basis — rendering the user's name one
            character per line. It only ever reproduced for admins, because only admins render
            this control. It belongs on its own row anyway; its margin-top always assumed that. */}
        {isAdmin(user) && <RoleSwitcher user={user} />}
        {/* The manuals are Settings-linked for the Head of Audit, but an action owner never sees
            Settings — so the guide written FOR them would be unreachable. Everyone gets the link
            here instead, pointed at the manual for their role. A plain <a>: it is a static
            document under /docs, not an app route, and it opens in its own tab. */}
        <a
          className="sidebar-guide"
          href={effectiveRole(user) === "action_owner" ? OWNER_MANUAL.href : FULL_MANUAL.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <HugeiconsIcon icon={BookOpen01Icon} size={16} strokeWidth={1.75} />
          User guide
        </a>
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
