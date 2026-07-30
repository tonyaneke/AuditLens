"use client";

// Detail page for a single external finding at /external/[ext] — port of renderExtFinding.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import ObsRemediation from "@/components/audits/ObsRemediation";
import { ensureExtList } from "@/lib/workspace/external";
import { isActionOwner, isHead } from "@/lib/workspace/observations";
import { ck, fmtDate, isoToDate } from "@/lib/workspace/selectors";
import type { Observation } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { ExtAssignDialog, ExtEditDialog } from "./lazy";

export default function ExtFindingDetailPage({ fid }: { fid: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const router = useRouter();
  const list = ensureExtList(db);
  const f = list.find((x) => x.id === fid);

  // Legacy renderExtFinding: the Head of Audit, the auditor who raised it, or anyone when the
  // finding has no raiser (e.g. imported) can manage it; action owners never see the assign action.
  const owner = isActionOwner(user);
  const canManage = !!f && (isHead(user) || (!!f.raisedBy && f.raisedBy === user.id) || !f.raisedBy);
  const backHref = owner ? "/portal/external" : "/external";

  // Port of modalDelExt / delExt — go back to the register after deleting.
  function delFinding() {
    if (!f) return;
    const title = f.title;
    void modal.confirm({
      title: "Delete finding",
      message: (
        <>
          Delete finding <b>{title}</b>? This cannot be undone.
        </>
      ),
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.extFindings = (d.extFindings || []).filter((x) => x.id !== fid);
        });
        router.push(backHref);
      },
    });
  }

  usePageChrome(
    {
      title: f?.title || "External Finding",
      actions: f ? (
        <div style={{ display: "flex", gap: 8 }}>
          <Link href={backHref} className="btn sec sm">
            ← Back to List
          </Link>
          {canManage && !owner ? (
            <button
              className="btn sm"
              onClick={() => modal.open(<ExtAssignDialog findingId={f.id} />)}
            >
              {f.ownerUserId ? "Reassign owner" : "Assign owner"}
            </button>
          ) : null}
          {canManage ? (
            <>
              <button
                className="btn pri sm"
                onClick={() => modal.open(<ExtEditDialog findingId={f.id} />)}
              >
                Edit Finding
              </button>
              <button className="btn ghost sm danger" onClick={delFinding}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : undefined,
    },
    [fid, !!f, f?.ownerUserId, canManage, owner],
  );

  if (!f) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <h3>Finding not found</h3>
        <p className="hint">The requested external finding could not be found in the register.</p>
        <Link href={backHref} className="btn sec" style={{ marginTop: 16 }}>
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
        {f.isRepeat ? <span className="pill repeat-pill">↻ REPEAT</span> : null}
        {f.theme ? <span className="tag">Theme: {f.theme}</span> : null}
        {f.source ? <span className="tag">{f.source}</span> : null}
        {f.sourceRef ? <span className="tag">Ref: {f.sourceRef}</span> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
        <div>
          <div className="ttl">Action Owner</div>
          <div>{f.owner || "Unassigned"}</div>
        </div>
        {f.secondaryOwner ? (
          <div>
            <div className="ttl">Secondary Owner</div>
            <div>{f.secondaryOwner}</div>
          </div>
        ) : null}
        {f.year ? (
          <div>
            <div className="ttl">Year</div>
            <div>{f.year}</div>
          </div>
        ) : null}
        <div>
          <div className="ttl">Target Date</div>
          <div>{f.targetDate ? fmtDate(isoToDate(f.targetDate)) || f.targetDate : "Not specified"}</div>
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

      {f.isRepeat && f.repeatOf ? (
        <div className="hint" style={{ marginBottom: 16 }}>Repeat of: {f.repeatOf}</div>
      ) : null}

      {f.closureEvidence ? (
        <div style={{ marginBottom: 16 }}>
          <div className="ttl">Closure Evidence / Notes</div>
          <div className="txt"><RichText text={f.closureEvidence} /></div>
        </div>
      ) : null}

      {/* Legacy renderExtFinding called the SAME obsRemediationHTML as observations, keyed by
          the sentinel ids {id:"ext"} that findObsIn resolves against the external register.
          ExtFinding carries the identical workflow-chain fields (see types.ts), hence the cast. */}
      <ObsRemediation
        o={f as unknown as Observation}
        a={{ id: "ext" }}
        r={{ id: "ext" }}
        commentsHref={`/external/${f.id}/comments`}
      />
    </div>
  );
}
