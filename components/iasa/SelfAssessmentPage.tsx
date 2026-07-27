"use client";

// IA Self-Assessment — React port of viewIASA/iasaOverview/iasaTopActions and the assessment
// lifecycle (startIASA/openIASA/completeIASA/reopenIASA/deleteIASA). The legacy `iasaMode`
// global becomes ?tab=assessment|insights on /self-assessment.

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePageChrome } from "@/components/chrome/PageChrome";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { Empty } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import {
  CONF_HEX,
  currentIaSa,
  ensureIaSaList,
  iaSaList,
  iasaNextDue,
  iasaPeriodForDate,
  iasaSummary,
  needsIaSaMigration,
  newIaSa,
} from "@/lib/workspace/iasa";
import { fmtDate } from "@/lib/workspace/selectors";
import type { IaSaRecord } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import AssessmentPanel from "./AssessmentPanel";
import IasaKpi from "./IasaKpi";
import InsightsPanel from "./InsightsPanel";
import { exportIASA } from "./exports";
import { generateIASA } from "./generate";

type Tab = "overview" | "assessment" | "insights";

export default function SelfAssessmentPage() {
  const { db, mutate, version } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const search = useSearchParams();
  const raw = search.get("tab");
  const tab: Tab = raw === "assessment" ? "assessment" : raw === "insights" ? "insights" : "overview";

  const all = iaSaList(db)
    .slice()
    .sort((a, b) =>
      String(b.startedAt || b.completedAt || "").localeCompare(
        String(a.startedAt || a.completedAt || ""),
      ),
    );
  const cur = currentIaSa(db);

  // Fold a pre-list single assessment into the list once (legacy iaSAAll()).
  useEffect(() => {
    if (needsIaSaMigration(db)) mutate((d) => void ensureIaSaList(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // The assessment/insights tabs need a record; without one there is nothing to show.
  useEffect(() => {
    if (tab !== "overview" && !cur) router.replace("/self-assessment");
  }, [tab, cur, router]);

  const goTab = (t: Tab) =>
    router.replace(t === "overview" ? "/self-assessment" : `/self-assessment?tab=${t}`);

  function startNew() {
    mutate((d) => void newIaSa(d, iasaPeriodForDate(new Date())));
    goTab("assessment");
  }
  function openRecord(s: IaSaRecord) {
    mutate((d) => {
      d.iaSACurrentId = s.id;
    });
    goTab("assessment");
  }
  function complete() {
    if (!cur) return;
    mutate((d) => {
      const r = ensureIaSaList(d).find((x) => x.id === cur.id);
      if (r) {
        r.status = "completed";
        r.completedAt = new Date().toISOString();
      }
    });
    goTab("overview");
    toast("Assessment marked complete.", "success");
  }
  function reopen(s: IaSaRecord) {
    mutate((d) => {
      const r = ensureIaSaList(d).find((x) => x.id === s.id);
      if (r) {
        r.status = "in_progress";
        r.completedAt = "";
      }
    });
  }
  function remove(s: IaSaRecord) {
    void modal.confirm({
      message: "Delete this self-assessment? This cannot be undone.",
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.iaSAList = ensureIaSaList(d).filter((x) => x.id !== s.id);
          if (d.iaSACurrentId === s.id) d.iaSACurrentId = "";
        });
        logAudit(
          "iasa.deleted",
          "Deleted self-assessment" + (s.period ? " (" + s.period + ")" : ""),
          { selfAssessmentId: s.id },
        );
      },
    });
  }

  usePageChrome(
    {
      title: "IA Self-Assessment",
      actions:
        tab === "overview" ? (
          <button className="btn sm" type="button" onClick={startNew}>
            + New assessment
          </button>
        ) : (
          <>
            <button className="btn ghost sm" type="button" onClick={() => goTab("overview")}>
              ← All assessments
            </button>
            <button
              className="btn sec sm"
              type="button"
              onClick={() => cur && exportIASA(db, cur)}
            >
              ⤓ Word
            </button>
            {cur && cur.status !== "completed" ? (
              <>
                <BusyButton
                  className="btn sm dark ai-generate-btn"
                  busyLabel="Generating…"
                  onClick={() => generateIASA(db, cur.id, mutate)}
                >
                  Generate
                </BusyButton>
                <button className="btn sm" type="button" onClick={complete}>
                  ✓ Mark complete
                </button>
              </>
            ) : cur ? (
              <button className="btn sec sm" type="button" onClick={() => reopen(cur)}>
                Reopen
              </button>
            ) : null}
          </>
        ),
    },
    // `version` keeps the Word export and Generate handlers bound to the live blob — the store
    // swaps its object identity whenever a poll adopts another user's copy.
    [tab, cur?.id, cur?.status, version],
  );

  /* ---- overview ---- */
  if (tab === "overview") {
    const nd = iasaNextDue(db);
    const done = all.filter((s) => s.status === "completed");
    const inprog = all.filter((s) => s.status !== "completed");
    return (
      <>
        <div className="dash-kpis anim-fade-in" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <IasaKpi tone="accent" label="Completed" value={done.length} sub="self-assessments on record" />
          <IasaKpi tone="base" label="In progress" value={inprog.length} sub="awaiting completion" />
          <IasaKpi
            tone={nd.overdue ? "bad" : "good"}
            label="Next assessment"
            value={nd.overdue ? "Due now" : nd.due ? fmtDate(nd.due) : "Due now"}
            sub="6-monthly cadence"
          />
        </div>

        <div className="seclabel" style={{ margin: "16px 0 8px" }}>
          Assessments
        </div>

        {!all.length ? (
          <div className="card">
            <Empty big="⚖">
              No self-assessments yet.
              <br />
              Run one every 6 months to track conformance with the Global Internal Audit Standards.
              <br />
              <br />
              <button className="btn dark" type="button" onClick={startNew}>
                Start first assessment
              </button>
            </Empty>
          </div>
        ) : (
          <div className="iasa-card-grid">
            {all.map((s) => {
              const sum = iasaSummary(s);
              const when =
                s.status === "completed"
                  ? "Completed " + (s.completedAt ? fmtDate(new Date(s.completedAt)) : "—")
                  : "Started " + (s.startedAt ? fmtDate(new Date(s.startedAt)) : "—");
              return (
                <div className="card iasa-assess-card anim-fade-in" key={s.id}>
                  <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>
                        {s.period || "Untitled period"}
                      </div>
                      <div className="hint">{when}</div>
                    </div>
                    {s.status === "completed" ? (
                      <span className="pill c-Low">Completed</span>
                    ) : (
                      <span className="pill" style={{ background: "#fbf3dd", color: "#a67c00" }}>
                        In progress
                      </span>
                    )}
                  </div>
                  <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: "wrap" }}>
                    <div>
                      <div className="hint">Opinion</div>
                      <b style={{ color: CONF_HEX[sum.op] || "#475569" }}>{sum.op}</b>
                    </div>
                    <div>
                      <div className="hint">Rated</div>
                      <b>
                        {sum.rated}/{sum.total}
                      </b>
                    </div>
                    <div>
                      <div className="hint">Avg maturity</div>
                      <b>{sum.avgMat ? sum.avgMat.toFixed(1) + " / 5" : "—"}</b>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <button className="btn sm" type="button" onClick={() => openRecord(s)}>
                      {s.status === "completed" ? "View" : "Continue"}
                    </button>
                    <div className="spacer" style={{ flex: 1 }} />
                    <button className="btn ghost sm danger" type="button" onClick={() => remove(s)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </>
    );
  }

  if (!cur) return null;

  /* ---- assessment / insights ---- */
  return (
    <>
      <div className="iasa-tabs anim-fade-in">
        <div className="iasa-tab-group">
          <button className="iasa-tab" type="button" onClick={() => goTab("overview")}>
            Overview
          </button>
          <button
            className={`iasa-tab${tab === "assessment" ? " active" : ""}`}
            type="button"
            onClick={() => goTab("assessment")}
          >
            Assessment
          </button>
          <button
            className={`iasa-tab${tab === "insights" ? " active" : ""}`}
            type="button"
            onClick={() => goTab("insights")}
          >
            Insights
          </button>
        </div>
        <span className="iasa-tab-meta">
          {cur.period || "Current period"} ·{" "}
          {cur.status === "completed"
            ? "Completed " + (cur.completedAt ? fmtDate(new Date(cur.completedAt)) : "")
            : "In progress"}{" "}
          · 52 standards
        </span>
      </div>
      {tab === "insights" ? <InsightsPanel rec={cur} /> : <AssessmentPanel rec={cur} />}
    </>
  );
}
