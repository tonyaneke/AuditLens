"use client";

import { useParams } from "next/navigation";
import RaUnitPage from "@/components/ra/RaUnitPage";

export default function Page() {
  const params = useParams<{ unit: string }>();
  const unit = Array.isArray(params.unit) ? params.unit[0] : params.unit;
  return <RaUnitPage unitId={unit || ""} />;
}
