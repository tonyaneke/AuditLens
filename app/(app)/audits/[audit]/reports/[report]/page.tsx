"use client";

import { use } from "react";
import ReportDetailPage from "@/components/audits/ReportDetailPage";

export default function Page({ params }: { params: Promise<{ audit: string; report: string }> }) {
  const { audit, report } = use(params);
  return <ReportDetailPage auditId={audit} reportId={report} />;
}
