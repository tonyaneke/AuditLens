"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserSwitchIcon, CheckmarkBadge01Icon } from "@hugeicons/core-free-icons";
import { effectiveRole, type SessionUser } from "@/lib/permissions";

type RoleOption = {
  value: string;
  label: string;
  description: string;
};

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "head_of_audit",
    label: "Head of Audit",
    description: "Full access to all sections and approvals",
  },
  {
    value: "audit_staff",
    label: "Audit Staff",
    description: "Standard audit team member view",
  },
  {
    value: "action_owner",
    label: "Action Owner",
    description: "Department head remediation portal",
  },
];

type RoleSwitcherProps = {
  user: SessionUser;
};

export default function RoleSwitcher({ user }: RoleSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (user.role !== "admin") return null;

  const currentRole = effectiveRole(user);
  const currentLabel =
    ROLE_OPTIONS.find((r) => r.value === currentRole)?.label || currentRole;

  async function handleSwitch(role: string) {
    if (role === currentRole || switching) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/auth/switch-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
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

  return (
    <div className="role-switcher">
      <button
        type="button"
        className="role-switcher-trigger"
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
      >
        <HugeiconsIcon icon={UserSwitchIcon} size={14} strokeWidth={1.75} />
        <span className="role-switcher-label">{currentLabel}</span>
        <span className="role-switcher-badge">Admin</span>
      </button>

      {isOpen && (
        <div className="role-switcher-dropdown">
          <div className="role-switcher-header">Switch View</div>
          {ROLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`role-switcher-option ${option.value === currentRole ? "active" : ""}`}
              onClick={() => handleSwitch(option.value)}
              disabled={switching}
            >
              <div className="role-switcher-option-content">
                <div className="role-switcher-option-label">{option.label}</div>
                <div className="role-switcher-option-desc">
                  {option.description}
                </div>
              </div>
              {option.value === currentRole && (
                <HugeiconsIcon
                  icon={CheckmarkBadge01Icon}
                  size={16}
                  strokeWidth={2}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
