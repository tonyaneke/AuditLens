"use client";

// Dashboard — the new-shell home page (staff/head variant + action-owner variant).

import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import CaeReportDialog from "@/components/dashboard/CaeReportDialog";
import OwnerDashboard from "@/components/dashboard/OwnerDashboard";
import StaffDashboard from "@/components/dashboard/StaffDashboard";

export default function DashboardPage() {
  const user = useUser();
  const modal = useModal();
  const isOwner = user.role === "action_owner";
  usePageChrome({
    title: "Dashboard",
    actions: isOwner ? undefined : (
      <button className="btn sec sm" type="button" onClick={() => modal.open(<CaeReportDialog />)}>
        ⤓ Quarterly BAC report
      </button>
    ),
  });
  return isOwner ? <OwnerDashboard /> : <StaffDashboard />;
}
