"use client";

import { use } from "react";
import ObsComments from "@/components/audits/ObsComments";

// External findings share the observation conversation view — legacy rendered the same
// comments branch for both, keyed by the sentinel audit/report id "ext" (see findObsIn).
export default function Page({ params }: { params: Promise<{ ext: string }> }) {
  const { ext } = use(params);
  return <ObsComments auditId="ext" reportId="ext" obsId={ext} backHref={`/external/${ext}`} />;
}
