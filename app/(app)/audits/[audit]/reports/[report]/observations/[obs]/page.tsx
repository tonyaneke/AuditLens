"use client";

import { use } from "react";
import ObsDetailPage from "@/components/audits/ObsDetailPage";

export default function Page({
  params,
}: {
  params: Promise<{ audit: string; report: string; obs: string }>;
}) {
  const { audit, report, obs } = use(params);
  return <ObsDetailPage auditId={audit} reportId={report} obsId={obs} />;
}
