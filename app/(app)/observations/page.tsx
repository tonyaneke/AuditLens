"use client";

import { Suspense } from "react";
import AllObservationsPage from "@/components/observations/AllObservationsPage";

// useSearchParams requires a Suspense boundary in production builds (Next 16).
export default function Page() {
  return (
    <Suspense fallback={<div className="card" style={{ padding: 24 }}>Loading observations…</div>}>
      <AllObservationsPage />
    </Suspense>
  );
}
