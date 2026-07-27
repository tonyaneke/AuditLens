"use client";

import { useParams } from "next/navigation";
import ProcessDetailPage from "@/components/process/ProcessDetailPage";

export default function Page() {
  const params = useParams<{ proc: string }>();
  const proc = Array.isArray(params.proc) ? params.proc[0] : params.proc;
  return <ProcessDetailPage procId={proc || ""} />;
}
