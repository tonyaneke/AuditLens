"use client";

import { Suspense } from "react";
import TrackerPage from "@/components/tracker/TrackerPage";

// useSearchParams requires a Suspense boundary in production builds (Next 16).
export default function Page() {
  return (
    <Suspense fallback={<div className="card">Loading…</div>}>
      <TrackerPage />
    </Suspense>
  );
}
