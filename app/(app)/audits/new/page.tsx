"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { ModalAuditDialog } from "@/components/audits/lazy";
import { useModal } from "@/components/modals/ModalProvider";

export default function NewAuditPage() {
  const modal = useModal();
  const router = useRouter();

  usePageChrome({ title: "New Audit Engagement" });

  useEffect(() => {
    modal.open(<ModalAuditDialog />);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card" style={{ padding: 40, textAlign: "center" }}>
      <p className="hint">Opening audit creation dialog...</p>
      <button className="btn sec" onClick={() => router.push("/audits")} style={{ marginTop: 12 }}>
        ← Cancel and Return to Audits List
      </button>
    </div>
  );
}
