"use client";

import { use } from "react";
import SopUpdatePage from "@/components/audits/SopUpdatePage";

export default function Page({
  params,
}: {
  params: Promise<{ audit: string; report: string; obs: string }>;
}) {
  const { audit, report, obs } = use(params);
  return <SopUpdatePage auditId={audit} reportId={report} obsId={obs} />;
}
