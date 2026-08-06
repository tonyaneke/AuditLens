"use client";

// Detail page for a single external finding at /external/[ext] — port of renderExtFinding.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton, StatusPill } from "@/components/ui";
import { DetailHero, Meta, Section } from "@/components/audits/detail-parts";
import ObsRemediation from "@/components/audits/ObsRemediation";
import { deptLabel, deptNameOf } from "@/lib/dept-scope";
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
      title: f ? `${f.ref ? f.ref + " — " : ""}${f.title}` : "External Finding",
      /* Back belongs on the LEFT of the chrome, as it does on every other detail page. It used to
         be the first item in `actions`, which the chrome renders right-aligned alongside Edit and
         Delete — so on this one page the way out sat at the far right, beside a destructive
         button. */
      back: <BackButton href={backHref} />,
      actions: f ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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

  /* Same shape as an internal observation's page — hero, meta strip, prose sections, remediation
     block — using the shared parts in components/audits/detail-parts.tsx. A regulator's finding
     and an internal one are the same kind of thing to the person answering it, and they now read
     that way. */
  return (
    <div className="obs-detail-page anim-fade-in">
      <DetailHero
        title={`${f.ref ? f.ref + " — " : ""}${f.title}`}
        badges={
          <>
            <span className={`pill ${ck(f.severity)}`}>{f.severity || "—"} Severity</span>
            <StatusPill status={f.status} />
            {f.isRepeat ? (
              <span className="pill repeat-pill" title={f.repeatOf || "Repeat finding"}>↻ REPEAT</span>
            ) : null}
            <span className="tag">External</span>
            {deptLabel(deptNameOf(db, f)) ? (
              <span className="tag">{deptLabel(deptNameOf(db, f))}</span>
            ) : null}
            {f.theme ? <span className="tag">Theme: {f.theme}</span> : null}
            {f.source ? <span className="tag">{f.source}</span> : null}
            {f.sourceRef ? <span className="tag">Ref: {f.sourceRef}</span> : null}
          </>
        }
      />

      <div className="obs-detail-meta">
        <Meta label="Action owner">{f.owner || "Unassigned"}</Meta>
        <Meta label="Co-owner">{f.secondaryOwner}</Meta>
        <Meta label="Year">{f.year}</Meta>
        <Meta label="Target date">
          {f.targetDate ? fmtDate(isoToDate(f.targetDate)) || f.targetDate : "Not specified"}
        </Meta>
        <Meta label="Closed date">
          {f.closedDateISO ? fmtDate(isoToDate(f.closedDateISO)) : ""}
        </Meta>
        <Meta label="Verified by">{f.verifiedBy}</Meta>
      </div>

      <div className="obs-detail-sections">
        <Section title="Detailed description" text={f.detail} />
        <Section title="Impact / risk" text={f.risk} />
        <Section title="Recommendation" text={f.recommendation} />
        <Section title="Management response" text={f.managementResponse} />
        <Section title="Closure evidence / notes" text={f.closureEvidence} />
        {f.isRepeat && f.repeatOf ? (
          <Section title="Repeat of" text={String(f.repeatOf)} />
        ) : null}
      </div>

      {/* Legacy renderExtFinding called the SAME obsRemediationHTML as observations, keyed by
          the sentinel ids {id:"ext"} that findObsIn resolves against the external register.
          ExtFinding carries the identical workflow-chain fields (see types.ts), hence the cast. */}
      <ObsRemediation
        o={f as unknown as Observation}
        a={{ id: "ext" }}
        r={{ id: "ext" }}
        commentsHref={`/external/${f.id}/comments`}
      />

      {f.status === "Closed" ? (
        <div className="obs-detail-closure hint">
          ✓ Closed{f.closedDateISO ? " " + fmtDate(isoToDate(f.closedDateISO)) : ""} · Verified by{" "}
          {f.headVerifiedByName || f.verifiedBy || "—"}
          {f.raisedByName ? (<><br />Raised by {f.raisedByName}</>) : null}
          {f.reportVerifiedByName ? " · Verified by auditor " + f.reportVerifiedByName : ""}
        </div>
      ) : null}
    </div>
  );
}
