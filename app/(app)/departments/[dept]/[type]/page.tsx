"use client";

import { useParams } from "next/navigation";
import DepartmentObservationsPage from "@/components/departments/DepartmentObservationsPage";

export default function Page() {
  const params = useParams<{ dept: string; type: string }>();
  const dept = Array.isArray(params.dept) ? params.dept[0] : params.dept;
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const type = rawType === "external" ? "external" : "internal";

  return <DepartmentObservationsPage deptSlug={dept || ""} type={type} />;
}
