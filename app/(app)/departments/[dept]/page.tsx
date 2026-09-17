"use client";

import { useParams } from "next/navigation";
import DepartmentObservationsPage from "@/components/departments/DepartmentObservationsPage";

export default function Page() {
  const params = useParams<{ dept: string }>();
  const dept = Array.isArray(params.dept) ? params.dept[0] : params.dept;

  return <DepartmentObservationsPage deptSlug={dept || ""} type="internal" />;
}
