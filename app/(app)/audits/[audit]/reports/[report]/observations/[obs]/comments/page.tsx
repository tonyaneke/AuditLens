"use client";

import { use } from "react";
import ObsComments from "@/components/audits/ObsComments";

export default function Page({
  params,
}: {
  params: Promise<{ audit: string; report: string; obs: string }>;
}) {
  const { audit, report, obs } = use(params);
  return (
    <ObsComments
      auditId={audit}
      reportId={report}
      obsId={obs}
      backHref={`/audits/${audit}/reports/${report}/observations/${obs}`}
    />
  );
}
