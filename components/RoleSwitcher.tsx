"use client";

import { Fragment, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserSwitchIcon, CheckmarkBadge01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { DEPARTMENTS } from "@/components/settings/staff";
import { useDirectoryUsers } from "@/components/external/use-directory";
import { deptLabel, normalizeDept } from "@/lib/dept-scope";
import { effectiveRole, roleLabel, type SessionUser } from "@/lib/permissions";
import { commDepartmentOptions } from "@/lib/workspace/audit-comms";

type RoleOption = {
  value: string;
  label: string;
  description: string;
};

// QA-14 — labels come from lib/permissions so this control cannot drift from the sidebar.
const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "head_of_audit",
    label: roleLabel("head_of_audit"),
    description: "Full access to all sections and approvals",
  },
  {
    value: "audit_staff",
    label: roleLabel("audit_staff"),
    description: "Standard audit team member view",
  },
  {
    value: "action_owner",
    label: roleLabel("action_owner"),
    description: "A department's remediation portal — pick the department",
  },
  {
    value: "executive",
    label: roleLabel("executive"),
    description: "MD & EXCO governance view across all departments",
  },
];

type RoleSwitcherProps = {
  user: SessionUser;
};

export default function RoleSwitcher({ user }: RoleSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  // The action owner's department list, opened from its row. Starts open when that is the current
  // view, because changing department is the usual reason to open the menu then.
  const [deptsOpen, setDeptsOpen] = useState(false);

  /* The same list a notice can be addressed to: the roster, then any department someone belongs to
     that it does not name — so a department that can be sent something can also be viewed as.
     Read from the directory rather than the workspace because this control also sits in the
     legacy shell, which has no workspace provider. */
  const dir = useDirectoryUsers();

  if (user.role !== "admin") return null;

  const currentRole = effectiveRole(user);
  const currentDept = currentRole === "action_owner" ? user.activeDepartment || "" : "";
  const departments = commDepartmentOptions(DEPARTMENTS, dir, currentDept ? [currentDept] : []);
  // Was `?? currentRole`, which printed a raw role code (e.g. "admin") whenever the active role
  // had no entry in ROLE_OPTIONS — one of the three labels the audit saw for a single session.
  const currentLabel = roleLabel(currentRole) + (currentDept ? ` · ${deptLabel(currentDept)}` : "");

  async function handleSwitch(role: string, department?: string) {
    if (switching) return;
    if (role === currentRole && (role !== "action_owner" || normalizeDept(department) === normalizeDept(currentDept))) {
      setIsOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch("/api/auth/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(department ? { role, department } : { role }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      /* ignore */
    } finally {
      setSwitching(false);
      setIsOpen(false);
    }
  }

  function toggleMenu() {
    if (!isOpen) setDeptsOpen(currentRole === "action_owner");
    setIsOpen(!isOpen);
  }

  return (
    <div className="role-switcher">
      <button
        type="button"
        className="role-switcher-trigger"
        onClick={toggleMenu}
        disabled={switching}
        aria-expanded={isOpen}
      >
        <HugeiconsIcon icon={UserSwitchIcon} size={14} strokeWidth={1.75} />
        <span className="role-switcher-label">{currentLabel}</span>
        <span className="role-switcher-badge">Admin</span>
      </button>

      {isOpen && (
        <div className="role-switcher-dropdown">
          <div className="role-switcher-header">Switch View</div>
          {ROLE_OPTIONS.map((option) => {
            const isOwner = option.value === "action_owner";
            const active = option.value === currentRole;
            return (
              <Fragment key={option.value}>
                <button
                  type="button"
                  className={`role-switcher-option ${active ? "active" : ""}`}
                  // The action owner's view needs a department, so its row opens the list instead.
                  onClick={() => (isOwner ? setDeptsOpen(!deptsOpen) : handleSwitch(option.value))}
                  disabled={switching}
                  aria-expanded={isOwner ? deptsOpen : undefined}
                >
                  <div className="role-switcher-option-content">
                    <div className="role-switcher-option-label">{option.label}</div>
                    <div className="role-switcher-option-desc">
                      {isOwner && currentDept ? `Acting for ${deptLabel(currentDept)}` : option.description}
                    </div>
                  </div>
                  {isOwner ? (
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={16}
                      strokeWidth={2}
                      style={{ transform: deptsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.12s ease" }}
                    />
                  ) : (
                    active && <HugeiconsIcon icon={CheckmarkBadge01Icon} size={16} strokeWidth={2} />
                  )}
                </button>
                {isOwner && deptsOpen && (
                  <div className="role-switcher-depts" role="group" aria-label="Department to act for">
                    {departments.map((d) => {
                      const on = !!currentDept && normalizeDept(d) === normalizeDept(currentDept);
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`role-switcher-dept ${on ? "active" : ""}`}
                          onClick={() => handleSwitch("action_owner", d)}
                          disabled={switching}
                        >
                          <span>{deptLabel(d)}</span>
                          {on && <HugeiconsIcon icon={CheckmarkBadge01Icon} size={14} strokeWidth={2} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
