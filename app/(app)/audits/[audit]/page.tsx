"use client";

import { use } from "react";
import AuditDetailPage from "@/components/audits/AuditDetailPage";

export default function Page({ params }: { params: Promise<{ audit: string }> }) {
  const { audit } = use(params);
  return <AuditDetailPage auditId={audit} />;
}
