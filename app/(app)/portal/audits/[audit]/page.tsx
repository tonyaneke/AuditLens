"use client";

import { use } from "react";
import MyAuditDetailPage from "@/components/portal/MyAuditDetailPage";

export default function Page({ params }: { params: Promise<{ audit: string }> }) {
  const { audit } = use(params);
  return <MyAuditDetailPage auditId={audit} />;
}
