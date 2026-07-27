"use client";

// Detail page for a single external finding at /external/[ext].

import Link from "next/link";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { ensureExtList } from "@/lib/workspace/external";
import { ck, fmtDate, isoToDate } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { ExtAssignDialog, ExtEditDialog } from "./dialogs";

export default function ExtFindingDetailPage({ fid }: { fid: string }) {
  const { db } = useWorkspace();
  const modal = useModal();
  const list = ensureExtList(db);
  const f = list.find((x) => x.id === fid);

  usePageChrome({
    title: f?.title || "External Finding",
    actions: f ? (
      <div style={{ display: "flex", gap: 8 }}>
        <Link href="/external" className="btn sec sm">
          ← Back to List
        </Link>
        <button className="btn sec sm" onClick={() => modal.open(<ExtAssignDialog findingId={f.id} />)}>
          Assign Owner
        </button>
        <button className="btn pri sm" onClick={() => modal.open(<ExtEditDialog findingId={f.id} />)}>
          Edit Finding
        </button>
      </div>
    ) : undefined,
  });

  if (!f) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Finding not found</h3>
        <p className="hint">The requested external finding could not be found in the register.</p>
        <Link href="/external" className="btn sec" style={{ marginTop: 16 }}>
          ← Back to Register
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <span className={`pill ${ck(f.severity)}`}>{f.severity} Severity</span>
        <span className={`pill ${f.status === "Closed" ? "c-Low" : f.status === "In Progress" ? "c-Medium" : "c-High"}`}>
          Status: {f.status || "Open"}
        </span>
        {f.theme ? <span className="tag">Theme: {f.theme}</span> : null}
        {f.sourceRef ? <span className="tag">Ref: {f.sourceRef}</span> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div>
          <div className="ttl">Action Owner</div>
          <div>{f.owner || "Unassigned"}</div>
        </div>
        <div>
          <div className="ttl">Target Date</div>
          <div>{f.targetDate ? fmtDate(isoToDate(f.targetDate)) : "Not specified"}</div>
        </div>
        {f.closedDateISO ? (
          <div>
            <div className="ttl">Closed Date</div>
            <div>{fmtDate(isoToDate(f.closedDateISO))}</div>
          </div>
        ) : null}
        {f.verifiedBy ? (
          <div>
            <div className="ttl">Verified By</div>
            <div>{f.verifiedBy}</div>
          </div>
        ) : null}
      </div>

      {f.detail ? (
        <div style={{ marginBottom: 16 }}>
          <div className="ttl">Detailed Description</div>
          <div className="txt"><RichText text={f.detail} /></div>
        </div>
      ) : null}

      {f.risk ? (
        <div style={{ marginBottom: 16 }}>
          <div className="ttl">Risk / Impact</div>
          <div className="txt"><RichText text={f.risk} /></div>
        </div>
      ) : null}

      {f.recommendation ? (
        <div style={{ marginBottom: 16 }}>
          <div className="ttl">Recommendation</div>
          <div className="txt"><RichText text={f.recommendation} /></div>
        </div>
      ) : null}

      {f.closureEvidence ? (
        <div style={{ marginBottom: 16 }}>
          <div className="ttl">Closure Evidence / Notes</div>
          <div className="txt"><RichText text={f.closureEvidence} /></div>
        </div>
      ) : null}
    </div>
  );
}
