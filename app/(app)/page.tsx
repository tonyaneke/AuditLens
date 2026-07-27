"use client";

// Dashboard — the new-shell home page (staff/head variant + action-owner variant).

import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import OwnerDashboard from "@/components/dashboard/OwnerDashboard";
import StaffDashboard from "@/components/dashboard/StaffDashboard";

export default function DashboardPage() {
  const user = useUser();
  usePageChrome({ title: "Dashboard" });
  return user.role === "action_owner" ? <OwnerDashboard /> : <StaffDashboard />;
}
