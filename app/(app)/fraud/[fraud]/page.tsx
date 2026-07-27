"use client";

import { use } from "react";
import FraudPage from "@/components/fraud/FraudPage";

export default function Page({ params }: { params: Promise<{ fraud: string }> }) {
  use(params);
  return <FraudPage />;
}
