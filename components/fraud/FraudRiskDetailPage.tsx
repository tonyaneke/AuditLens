"use client";

// Fraud risk detail (/fraud/[fraud]) — React port of renderFraudRisk from audit-bot.js:
// hero with residual band, the ratings meta grid, description/controls sections and the
// prevention-actions plan with add/edit/delete via FraudActionDialog.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import RichText from "@/components/ui/RichText";
import { TintPill } from "@/components/ui";
import { canManageFraudRegister } from "@/lib/workspace/observations";
import { rollupFraud } from "@/lib/workspace/fraud";
import { fraudActionsView } from "@/lib/workspace/portal";
import {
  BAND_HEX,
  fraudBand,
  fraudList,
  fraudResidual,
  hx2rgba,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { FraudActionDialog, FraudDialog } from "./lazy";

function DetailSection({ title, text }: { title: string; text: unknown }) {
  if (!text) return null;
  return (
    <section className="obs-detail-section">
      <h4 className="obs-detail-label">{title}</h4>
      <div className="obs-detail-content">
        <RichText text={text} />
      </div>
    </section>
  );
}

export default function FraudRiskDetailPage({ riskId }: { riskId: string }) {
  const { db, mutate, ready } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const canManage = canManageFraudRegister(user);

  const f = fraudList(db).find((x) => x.id === riskId);

  // Legacy renderFraudRisk bounced to the register when the id no longer resolves —
  // only once the workspace has loaded (deep links render before the blob arrives).
  useEffect(() => {
    if (ready && !f) router.replace("/fraud");
  }, [ready, f, router]);

  function delRisk() {
    if (!canManage) {
      toast("Only Internal Audit can perform this action.", "error");
      return;
    }
    void modal.confirm({
      title: "Delete fraud risk",
      message: (
        <>
          Delete fraud risk <b>{f?.scheme}</b> and its prevention actions? This cannot be undone.
        </>
      ),
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.fraudRisks = (d.fraudRisks || []).filter((x) => x.id !== riskId);
        });
        router.push("/fraud");
      },
    });
  }

  function delAction(aid: string) {
    void modal.confirm({
      message: "Delete this prevention action?",
      danger: true,
      confirmLabel: "Delete",
      onConfirm: () => {
        mutate((d) => {
          const r = (d.fraudRisks || []).find((x) => x.id === riskId);
          if (!r) return;
          r.actions = (r.actions || []).filter((x) => x.id !== aid);
          rollupFraud(r);
        });
      },
    });
  }

  usePageChrome(
    {
      title: "Fraud Risk Assessment",
      back: (
        <button className="btn sec sm" type="button" onClick={() => router.push("/fraud")}>
          ← Back
        </button>
      ),
      actions: f ? (
        canManage ? (
          <>
            <button className="btn sec sm" type="button" onClick={() => modal.open(<FraudDialog fraudId={f.id} />)}>
              Edit
            </button>
            <button className="btn ghost sm danger" type="button" onClick={delRisk}>
              Delete
            </button>
          </>
        ) : null
      ) : null,
    },
    [riskId, !!f],
  );

  if (!f) return null;

  const score = (f.likelihood || 0) * (f.impact || 0);
  const inh = fraudBand(score);
  const res = fraudResidual(f);
  const acts = fraudActionsView(f);
  const implN = acts.filter((a) => a.status === "Implemented").length;

  const meta: [string, React.ReactNode][] = [
    ["Category", f.category || "—"],
    ["Process / area", f.process || "—"],
    ["Year", String(f.year || "—")],
    ["Likelihood × Impact", `${f.likelihood} × ${f.impact} = ${score}`],
    ["Inherent risk", <TintPill key="inh" hex={BAND_HEX[inh]}>{inh}</TintPill>],
    ["Control strength", f.controlStrength || "—"],
    ["Residual risk", <TintPill key="res" hex={BAND_HEX[res]}>{res}</TintPill>],
    ["Owner", f.owner || "—"],
  ];

  return (
    <div className="obs-detail-page anim-fade-in">
      <header className="obs-detail-hero">
        <div className="obs-detail-badges">
          <span
            className="pill"
            style={{ background: hx2rgba(BAND_HEX[res], 0.16), color: BAND_HEX[res] }}
          >
            Residual {res}
          </span>
          {f.category ? <span className="tag">{f.category}</span> : null}
          <span className="tag">{String(f.status || "Identified")}</span>
        </div>
        <h2 className="obs-detail-title">{f.scheme || "Fraud risk"}</h2>
        {f.process ? (
          <p className="hint" style={{ margin: "8px 0 0" }}>
            {f.process}
          </p>
        ) : null}
      </header>

      <div className="obs-detail-meta">
        {meta.map(([k, v]) => (
          <div className="obs-meta-item" key={k}>
            <span className="obs-meta-label">{k}</span>
            <span className="obs-meta-value">{v}</span>
          </div>
        ))}
      </div>

      <div className="obs-detail-sections">
        <DetailSection title="Description" text={f.description} />
        <DetailSection title="Existing controls" text={f.existingControls} />
        <DetailSection title="Prevention / response action" text={f.preventionAction} />
      </div>

      <div className="obs-notes">
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <div className="obs-notes-label" style={{ margin: 0 }}>
            Prevention actions{acts.length ? ` — ${implN}/${acts.length} implemented` : ""}
          </div>
          <div className="spacer" />
          <button
            className="btn sm"
            type="button"
            onClick={() => modal.open(<FraudActionDialog riskId={f.id} />)}
          >
            + Add action
          </button>
        </div>
        {acts.length ? (
          acts.map((a) => (
            <div className="obs-note" key={a.id}>
              <div className="obs-note-text">
                <b>{a.text}</b>
              </div>
              <div className="obs-note-meta">
                {[a.type, a.status, a.owner, a.targetDate ? "target " + a.targetDate : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {a.update ? (
                <div className="hint" style={{ marginTop: 4 }}>
                  {a.update}
                </div>
              ) : null}
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <button
                  className="btn ghost sm"
                  type="button"
                  onClick={() => modal.open(<FraudActionDialog riskId={f.id} actionId={a.id} />)}
                >
                  Edit
                </button>
                <button className="btn ghost sm danger" type="button" onClick={() => delAction(a.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="hint">No prevention actions captured yet.</div>
        )}
      </div>
    </div>
  );
}
