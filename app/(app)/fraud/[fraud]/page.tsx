"use client";

import { useParams } from "next/navigation";
import FraudRiskDetailPage from "@/components/fraud/FraudRiskDetailPage";

export default function Page() {
  const params = useParams<{ fraud: string }>();
  const fraud = Array.isArray(params.fraud) ? params.fraud[0] : params.fraud;
  return <FraudRiskDetailPage riskId={fraud || ""} />;
}
