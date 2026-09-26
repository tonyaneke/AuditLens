"use client";

import { use } from "react";
import TestDetailPage from "@/components/audits/TestDetailPage";

export default function Page({ params }: { params: Promise<{ audit: string; test: string }> }) {
  const { audit, test } = use(params);
  return <TestDetailPage auditId={audit} testId={test} />;
}
