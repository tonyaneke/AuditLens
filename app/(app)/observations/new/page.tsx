"use client";

// Deep link /observations/new — legacy `view=newobs` semantics: land on the dashboard with
// the New Observation modal open. The modal survives the client-side redirect because the
// ModalProvider lives in the (app) layout.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import NewObsDialog from "@/components/obs/NewObsDialog";
import { useModal } from "@/components/modals/ModalProvider";

export default function NewObservationPage() {
  const modal = useModal();
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => {
      modal.open(<NewObsDialog />, { wide: true });
      router.replace("/");
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
