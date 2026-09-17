"use client";

import { Suspense } from "react";
import UpdatesPage from "@/components/updates/UpdatesPage";

export default function Page() {
  return (
    <Suspense fallback={<div className="card">Loading updates…</div>}>
      <UpdatesPage />
    </Suspense>
  );
}
