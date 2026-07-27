"use client";

import { use } from "react";
import ExtFindingDetailPage from "@/components/external/ExtFindingDetailPage";

export default function Page({ params }: { params: Promise<{ ext: string }> }) {
  const { ext } = use(params);
  return <ExtFindingDetailPage fid={ext} />;
}
