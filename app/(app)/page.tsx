"use client";

// Dashboard — the new-shell home page (staff/head variant + action-owner variant).

import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import dynamic from "next/dynamic";

// Modal-only: the quarterly-report dialog (and its Word-export machinery) loads on first open,
// keeping it out of the dashboard's initial bundle.
const CaeReportDialog = dynamic(() => import("@/components/dashboard/CaeReportDialog"), {
  loading: () => null,
});
import OwnerDashboard from "@/components/dashboard/OwnerDashboard";
import StaffDashboard from "@/components/dashboard/StaffDashboard";
import ExecutiveDashboard from "@/components/dashboard/ExecutiveDashboard";
import { effectiveRole } from "@/lib/permissions";

export default function DashboardPage() {
  const user = useUser();
  const modal = useModal();
  const role = effectiveRole(user);
  const isOwner = role === "action_owner";
  const isExecutive = role === "executive";

  usePageChrome({
    title: isExecutive ? "Executive Governance Dashboard" : "Dashboard",
    actions: isOwner || isExecutive ? undefined : (
      <button className="btn sec sm" type="button" onClick={() => modal.open(<CaeReportDialog />)}>
        ⤓ Quarterly BAC report
      </button>
    ),
  });

  if (isExecutive) return <ExecutiveDashboard />;
  if (isOwner) return <OwnerDashboard />;
  return <StaffDashboard />;
}
