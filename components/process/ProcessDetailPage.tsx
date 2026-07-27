"use client";

// Process review detail — React port of procDetail()/procFindingCard()/downloadFlowchart(),
// plus the topbar Export (Word) / Edit details actions and the legacy delete confirmations
// (modalDelProcFinding/delProcFinding, delProcStep). The review id comes from /process/[proc].

import { useEffect, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { BackButton } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { dl } from "@/lib/client/exports";
import { urlForView } from "@/lib/routes";
import {
  flowchartSVG,
  PROC_CATS,
  PROC_RATING_HEX,
  PROC_SEV_HEX,
  procCatCounts,
  procList,
  procStepHex,
} from "@/lib/workspace/process";
import { hx2rgba } from "@/lib/workspace/selectors";
import type { ProcFinding } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ProcFindingDialog,
  ProcMetaDialog,
  ProcStepDialog,
  ProposeProcessDialog,
  RaiseProcFindingDialog,
} from "./dialogs";
import { exportProc } from "./exports";

const TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export default function ProcessDetailPage({ procId }: { procId: string }) {
  const { db, mutate, ready, version } = useWorkspace();
  const modal = useModal();
  const router = useRouter();

  const p = procList(db).find((x) => x.id === procId);
  const backHref = urlForView("process");

  usePageChrome(
    {
      title: "Process Review",
      back: <BackButton href={backHref} />,
      actions: p ? (
        <>
          <button className="btn sec sm" type="button" onClick={() => exportProc(db, p)}>
            ⤓ Export (Word)
          </button>
          <button
            className="btn sm"
            type="button"
            onClick={() => modal.open(<ProcMetaDialog id={procId} />)}
          >
            Edit details
          </button>
        </>
      ) : null,
    },
    // `version` keeps the Word export bound to the live blob — the store swaps its object
    // identity whenever a poll adopts another user's copy.
    [procId, !!p, version],
  );

  // Legacy viewProcess() cleared curProc when the id no longer resolved. Only bounce once the
  // workspace has loaded — a direct deep-link renders before the blob arrives.
  useEffect(() => {
    if (ready && !p) router.replace(backHref);
  }, [ready, p, router, backHref]);

  if (!p) return null;

  const f = p.findings || [];
  const rh = PROC_RATING_HEX[p.overallRating || ""] || "#64748b";
  const counts = procCatCounts(f);
  const ps = p.proposedSteps || [];

  function delFinding(x: ProcFinding) {
    void modal.confirm({
      title: "Delete finding",
      message: (
        <>
          Delete finding <b>{x.title}</b>? This cannot be undone.
        </>
      ),
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          const cur = procList(d).find((r) => r.id === procId);
          if (!cur) return;
          cur.findings = (cur.findings || []).filter((y) => y.id !== x.id);
        });
      },
    });
  }

  function delStep(sid: string) {
    // Legacy delProcStep — the audit-log label reads p.name||p.title verbatim (blank here).
    const label = p ? String((p.name as string) || (p.title as string) || "") : "";
    void modal.confirm({
      message: "Delete this step?",
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          const cur = procList(d).find((r) => r.id === procId);
          if (!cur) return;
          cur.proposedSteps = (cur.proposedSteps || []).filter((y) => y.id !== sid);
        });
        logAudit(
          "process.step_deleted",
          "Deleted a proposed step in process review: " + label,
          { processReviewId: procId, stepId: sid },
        );
      },
    });
  }

  // Legacy downloadFlowchart().
  function downloadChart() {
    const cur = procList(db).find((x) => x.id === procId);
    if (!cur || !(cur.proposedSteps || []).length) {
      toast("No proposed process to chart yet.");
      return;
    }
    dl(
      flowchartSVG(cur.proposedSteps),
      "process-chart-" + String(cur.unit || "unit").replace(/[^\w \-]/g, "") + ".svg",
      "image/svg+xml",
    );
  }

  function findingCard(x: ProcFinding) {
    const cat = x.category || "Process gap";
    const catEntry = PROC_CATS.find((c) => c[0] === cat) || ["Process gap", "#64748b"];
    const hex = catEntry[1];
    const sh = PROC_SEV_HEX[x.severity || ""] || "#64748b";
    return (
      <article className="proc-finding-card" key={x.id}>
        <div className="proc-finding-top">
          <span className="proc-cat-pill" style={{ "--cat-color": hex } as CSSProperties}>
            {cat}
          </span>
          {x.severity && cat !== "Strength" ? (
            <span className="pill" style={{ background: hx2rgba(sh, 0.12), color: sh }}>
              {x.severity}
            </span>
          ) : null}
        </div>
        <h4 className="proc-finding-title">{x.title}</h4>
        {x.detail ? <p className="proc-finding-text">{x.detail}</p> : null}
        {x.recommendation ? (
          <div className="proc-finding-rec">
            <span className="proc-finding-rec-label">Recommendation</span>
            <p className="proc-finding-text">{x.recommendation}</p>
          </div>
        ) : null}
        <div className="proc-finding-actions">
          <button
            className="btn sm"
            type="button"
            onClick={() => modal.open(<ProcFindingDialog pid={procId} fid={x.id} />)}
          >
            Edit
          </button>
          {cat !== "Strength" ? (
            <button
              className="btn sm"
              type="button"
              onClick={() => modal.open(<RaiseProcFindingDialog pid={procId} fid={x.id} />)}
            >
              Raise observation
            </button>
          ) : null}
          <button
            className="btn-icon-action danger"
            type="button"
            title="Delete"
            onClick={() => delFinding(x)}
          >
            {TRASH}
          </button>
        </div>
      </article>
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <h3 style={{ margin: 0 }}>{p.unit || "(unit)"}</h3>
            <div className="hint" style={{ marginTop: 3 }}>
              {p.sopTitle || ""}
              {p.sopFileName ? `${p.sopTitle ? " · " : ""}${p.sopFileName}` : ""}
              {p.period ? " · " + p.period : ""}
            </div>
          </div>
          <div className="spacer" />
          <span
            className="pill"
            style={{ background: hx2rgba(rh, 0.16), color: rh, fontSize: 13 }}
          >
            Effectiveness: {p.overallRating || "—"}
          </span>
        </div>
        {p.summary ? (
          <div className="txt" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
            {p.summary}
          </div>
        ) : null}
      </div>

      <div className="card proc-findings-section">
        <div className="proc-findings-head">
          <div>
            <div className="seclabel" style={{ margin: 0 }}>
              Findings
            </div>
            <div className="proc-findings-count">
              {f.length} item{f.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="spacer" />
          {f.length ? (
            <div className="proc-findings-chips">
              {PROC_CATS.filter(([c]) => counts[c]).map(([c, hex]) => (
                <span
                  key={c}
                  className="proc-findings-chip"
                  style={{ "--chip-color": hex } as CSSProperties}
                >
                  <strong>{counts[c]}</strong> {c}
                </span>
              ))}
            </div>
          ) : null}
          <button
            className="btn sm"
            type="button"
            onClick={() => modal.open(<ProcFindingDialog pid={procId} />)}
          >
            + Add finding
          </button>
        </div>
        {!f.length ? (
          <div className="proc-findings-empty">No findings recorded yet.</div>
        ) : (
          <div className="proc-findings-grid">{f.map((x) => findingCard(x))}</div>
        )}
      </div>

      {(p.keyRecommendations || []).length ? (
        <div className="card">
          <div className="seclabel">Key recommendations</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {p.keyRecommendations!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="seclabel" style={{ margin: 0 }}>
            Proposed updated process
          </div>
          <div className="spacer" />
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => modal.open(<ProposeProcessDialog pid={procId} />)}
          >
            {ps.length || p.proposedSummary ? "↻ Regenerate" : "✦ Generate"}
          </button>
          {ps.length ? (
            <>
              <button
                className="btn ghost sm"
                type="button"
                onClick={() => modal.open(<ProcStepDialog pid={procId} />)}
              >
                + Add step
              </button>
              <button className="btn ghost sm" type="button" onClick={downloadChart}>
                ⤓ Chart (SVG)
              </button>
            </>
          ) : null}
        </div>
        {p.proposedSummary ? (
          <div className="txt" style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>
            {p.proposedSummary}
          </div>
        ) : null}
        {ps.length ? (
          <>
            <div
              style={{
                overflow: "auto",
                marginTop: 10,
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 14,
                background: "#fafbfc",
              }}
              // Trusted markup: flowchartSVG builds the SVG itself and escapes all step text.
              dangerouslySetInnerHTML={{ __html: flowchartSVG(ps) }}
            />
            <div className="seclabel" style={{ marginTop: 14 }}>
              Process steps
            </div>
            <div>
              {ps.map((s, i) => {
                const c = procStepHex(s.type);
                return (
                  <div
                    className="row"
                    key={s.id}
                    style={{
                      alignItems: "center",
                      gap: 8,
                      borderTop: "1px solid var(--line)",
                      padding: "7px 0",
                    }}
                  >
                    <span className="hint" style={{ width: 20, textAlign: "right" }}>
                      {i + 1}
                    </span>
                    <span className="pill" style={{ background: hx2rgba(c, 0.16), color: c }}>
                      {s.type}
                    </span>
                    <div style={{ flex: 1 }}>
                      {s.actor ? <b>{s.actor}:</b> : null}
                      {s.actor ? " " : null}
                      {s.action}
                      {s.note ? <span className="hint"> — {s.note}</span> : null}
                    </div>
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => modal.open(<ProcStepDialog pid={procId} sid={s.id} />)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-icon-action danger"
                      type="button"
                      title="Delete"
                      onClick={() => delStep(s.id)}
                    >
                      {TRASH}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        ) : p.proposedSummary ? null : (
          <div className="hint" style={{ margin: "8px 0" }}>
            Resolve the findings into a redesigned, controlled, efficient process — with a
            flowchart. Click <b>✦ Generate</b>.
          </div>
        )}
      </div>
    </>
  );
}
