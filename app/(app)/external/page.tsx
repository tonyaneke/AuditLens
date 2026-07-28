"use client";

import { Suspense } from "react";
import ExternalPage from "@/components/external/ExternalPage";

// useSearchParams (?mode=register|insights) requires a Suspense boundary in production builds.
export default function Page() {
  return (
    <Suspense fallback={<div className="card">Loading…</div>}>
      <ExternalPage />
    </Suspense>
  );
}
