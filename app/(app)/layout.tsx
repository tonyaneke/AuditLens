"use client";

// Layout for all migrated (React-shell) routes: authentication, providers, permission guard,
// and the app chrome. The legacy shell (/legacy) does NOT pass through here.

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import AuthGate from "@/components/AuthGate";
import AppShell from "@/components/chrome/AppShell";
import { PageChromeProvider } from "@/components/chrome/PageChrome";
import { UserProvider } from "@/components/chrome/UserContext";
import AiBusyOverlay from "@/components/feedback/AiBusyOverlay";
import ToastHost from "@/components/feedback/ToastHost";
import { ModalProvider } from "@/components/modals/ModalProvider";
import { canAccessView, type SessionUser } from "@/lib/permissions";
import { hrefForView, isLegacyPath, viewForPathname } from "@/lib/routes";
import { WorkspaceProvider } from "@/lib/workspace/WorkspaceProvider";

function PermissionGuard({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const view = viewForPathname(pathname);
  const allowed = !view || canAccessView(user, view);

  useEffect(() => {
    if (!allowed) {
      const fallback = user.role === "action_owner" ? hrefForView("myobs") : "/";
      if (isLegacyPath(fallback)) window.location.assign(fallback);
      else router.replace(fallback);
    }
  }, [allowed, router, user.role]);

  if (!allowed) return null;
  return <>{children}</>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      {(user) => (
        <UserProvider user={user}>
          <WorkspaceProvider>
            <ModalProvider>
              <PageChromeProvider>
                <PermissionGuard user={user}>
                  <AppShell>{children}</AppShell>
                </PermissionGuard>
                <ToastHost />
                <AiBusyOverlay />
              </PageChromeProvider>
            </ModalProvider>
          </WorkspaceProvider>
        </UserProvider>
      )}
    </AuthGate>
  );
}
