"use client";

import { Suspense } from "react";
import SelfAssessmentPage from "@/components/iasa/SelfAssessmentPage";

// useSearchParams requires a Suspense boundary in production builds (Next 16).
export default function Page() {
  return (
    <Suspense fallback={<div className="card">Loading…</div>}>
      <SelfAssessmentPage />
    </Suspense>
  );
}
