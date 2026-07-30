"use client";

// Staff / Head dashboard — React port of viewDashboard() (+ watchlist expand, add-note).

import { Fragment, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import NewObsDialog from "@/components/obs/NewObsDialog";
import BusyButton from "@/components/feedback/BusyButton";
import NewResponsesDialog, { newResponseNotifs } from "./NewResponsesDialog";
import { CritPill, Empty, Kpi, RowOpen, StatusPill } from "@/components/ui";
import { displayRoleLabel } from "@/lib/permissions";
import {
  approvedObs,
  ck,
  closeBucketOf,
  CLOSE_BUCKETS,
  CRITS,
  daysToClose,
  effectiveClose,
  fmtDate,
  fmtDateTime,
  percentages,
  uid,
  type ObsWithContext,
} from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

const HEX: Record<string, string> = {
  Critical: "#7a0012",
  High: "#b00020",
  Moderate: "#e8590c",
  Low: "#2e7d32",
  "Process Improvement": "#2c5f8a",
};
const TIMELINES = ["Immediate", "Short-term", "Long-term"];

function Donut({ segs, total, label }: { segs: { value: number; color: string }[]; total: number; label: string }) {
  const r = 54;
  const C = 2 * Math.PI * r;
  // Precompute arc geometry with a plain loop — no closure mutation during JSX mapping.
  const arcs: { color: string; len: number; off: number; delay: number }[] = [];
  {
    let off = 0;
    let idx = 0;
    for (const s of segs) {
      if (s.value <= 0) continue;
      const len = total ? (s.value / total) * C : 0;
      arcs.push({ color: s.color, len, off, delay: idx * 0.12 });
      off += len;
      idx++;
    }
  }
  return (
    <svg className="donut-chart" viewBox="0 0 140 140" width="148" height="148" style={{ flexShrink: 0 }}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth="16" />
      {arcs.map((s, i) => (
        <circle
          key={i}
          className="donut-seg"
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDashoffset={(-s.off).toFixed(2)}
          transform="rotate(-90 70 70)"
          style={{ ["--seg-len" as string]: s.len.toFixed(2), ["--seg-delay" as string]: `${s.delay}s` }}
        />
      ))}
      <text className="donut-center-num" x="70" y="66" textAnchor="middle" fontSize="30" fontWeight="700" fill="#0d5a47">
        {total}
      </text>
      <text className="donut-center-lbl" x="70" y="86" textAnchor="middle" fontSize="11" fill="#64748b">
        {label}
      </text>
    </svg>
  );
}

function TlPill({ t }: { t: string | undefined }) {
  const map: Record<string, string> = { Immediate: "immediate", "Short-term": "short", "Long-term": "long" };
  const cls = map[t || ""];
  if (!cls) return <span className="timeline-pill empty">—</span>;
  return <span className={`timeline-pill ${cls}`}>{t}</span>;
}

function DetailSection({ title, text }: { title: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <div className="obs-field">
      <div className="ttl">{title}</div>
      <div className="txt" style={{ whiteSpace: "pre-wrap" }}>
        {text}
      </div>
    </div>
  );
}

function AddNoteDialog({ obsId }: { obsId: string }) {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const [text, setText] = useState("");
  const found = (() => {
    for (const a of db.audits || [])
      for (const r of a.reports || []) {
        const o = (r.observations || []).find((x) => x.id === obsId);
        if (o) return o;
      }
    return null;
  })();
  if (!found) return null;
  const notes = (found.notes || []) as { id: string; text: string; author?: string; at?: string }[];
  return (
    <ModalFrame
      title="Add note"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          {/* QA-18 — BusyButton disables itself while onClick runs, so a double-click cannot
              record the note twice. `disabled` on empty text also fixes the QA-17 complaint at
              source: the field is marked "Note *", so the control should be visibly unavailable
              rather than accepting the click and silently doing nothing. */}
          <BusyButton
            className="btn"
            busyLabel="Saving…"
            disabled={!text.trim()}
            onClick={() => {
              const body = text.trim();
              if (!body) {
                toast("Enter a note first.");
                return;
              }
              // QA-18 — a duplicate of the note most recently recorded on this observation is
              // almost always an accidental resubmit. Warn rather than silently accepting it:
              // duplicates clutter the remediation record and inflate apparent follow-up.
              const last = notes[notes.length - 1];
              if (last && String(last.text || "").trim() === body) {
                toast("That is identical to the last note on this observation.", "error");
                return;
              }
              mutate((d) => {
                for (const a of d.audits || [])
                  for (const r of a.reports || []) {
                    const o = (r.observations || []).find((x) => x.id === obsId);
                    if (o) {
                      o.notes = o.notes || [];
                      (o.notes as unknown[]).push({
                        id: uid(),
                        text: body,
                        author: user.name || "",
                        at: new Date().toISOString(),
                      });
                      // Observation ids are unique; without this the loop keeps scanning every
                      // remaining report and would append again on any duplicated id.
                      return;
                    }
                  }
              });
              modal.close();
            }}
          >
            Save note
          </BusyButton>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 8 }}>
        {found.ref ? found.ref + " — " : ""}
        {found.title}
      </div>
      <label>Note *</label>
      <textarea
        style={{ minHeight: 120 }}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Progress update, follow-up action, or context…"
      />
      {notes.length ? (
        <div style={{ marginTop: 14 }}>
          {notes
            .slice()
            .reverse()
            .map((n) => (
              <div className="obs-note" key={n.id}>
                <div className="obs-note-text">{n.text}</div>
                <div className="obs-note-meta">
                  {n.author || ""}
                  {n.at ? " · " + fmtDateTime(n.at) : ""}
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </ModalFrame>
  );
}

export default function StaffDashboard() {
  const { db } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const [watchOpen, setWatchOpen] = useState<Record<string, boolean>>({});

  /* Surface unread owner responses once per visit. The ref keeps it to once — the workspace
     poll swaps `db` regularly, and re-opening the modal under the user would be hostile. */
  const responses = newResponseNotifs(db, user.id);
  const responsesShown = useRef(false);
  useEffect(() => {
    if (responsesShown.current || !responses.length) return;
    responsesShown.current = true;
    modal.open(<NewResponsesDialog items={responses} />);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [responses.length]);

  // QA-11 — was allObs(db), which counted observations still awaiting approval. The Tracker
  // has always excluded them, so every headline figure here (Overdue, open, closed, the
  // criticality donut) read higher than the same figure one screen away.
  const obs = approvedObs(db);
  const total = obs.length;
  const nAudits = (db.audits || []).length;
  const nReports = (db.audits || []).reduce((s, a) => s + (a.reports || []).length, 0);
  const byC: Record<string, number> = {};
  CRITS.forEach((c) => (byC[c] = 0));
  obs.forEach((o) => {
    if (byC[o.criticality] != null) byC[o.criticality]++;
  });
  const open = obs.filter((o) => o.status !== "Closed").length;
  const closed = total - open;
  const keyExp = obs.filter(
    (o) => (o.criticality === "Critical" || o.criticality === "High") && o.status !== "Closed",
  ).length;
  const remRate = total ? Math.round((closed / total) * 100) : 0;

  const byArea: Record<string, Record<string, number>> = {};
  obs.forEach((o) => {
    const k = (o._a.area as string) || o._a.name;
    if (!byArea[k]) {
      byArea[k] = {};
      CRITS.forEach((c) => (byArea[k][c] = 0));
      byArea[k].t = 0;
    }
    byArea[k][o.criticality] = (byArea[k][o.criticality] || 0) + 1;
    byArea[k].t++;
  });
  const areaRows = Object.entries(byArea).sort(
    (a, b) => b[1].Critical * 100 + b[1].High * 10 + b[1].t - (a[1].Critical * 100 + a[1].High * 10 + a[1].t),
  );

  const critical = obs
    .filter((o) => (o.criticality === "Critical" || o.criticality === "High") && o.status !== "Closed")
    .sort((a, b) => CRITS.indexOf(a.criticality) - CRITS.indexOf(b.criticality));

  const openObs = obs.filter((o) => o.status !== "Closed");
  const closeB: Record<string, number> = {};
  CLOSE_BUCKETS.forEach((b) => (closeB[b] = 0));
  let closeNoDate = 0;
  const watchlist: { o: ObsWithContext; d: number }[] = [];
  openObs.forEach((o) => {
    // QA-11 — bucket via closeBucketOf so "Overdue" here is decided by exactly the same
    // predicate the Tracker's Overdue tile uses, rather than a rounded day count.
    const b = closeBucketOf(o, o._r);
    if (b == null) {
      closeNoDate++;
      return;
    }
    closeB[b]++;
    const d = daysToClose(o, o._r);
    if (d != null && d <= 14) watchlist.push({ o, d });
  });
  watchlist.sort((a, b) => a.d - b.d);
  const onTrackN = closeB["2–4 weeks"] + closeB["1–3 months"] + closeB["> 3 months"];

  const repeats = obs.filter((o) => o.isRepeat);
  const repeatOpen = repeats.filter((o) => o.status !== "Closed").length;

  const firstName = (user.name || db.signOffName || "there").trim().split(/\s+/)[0] || "there";
  /* QA-14 — this line used to print the user's DEPARTMENT ("Internal Audit") for anyone who
     wasn't Head of Audit, so the same session read "Head of Audit" in the sidebar and
     "Internal Audit" here. A department is not a role, and role denotes the authority to
     approve and close findings. Same label as everywhere else now. */
  const roleTitle = displayRoleLabel(user);

  const segs = CRITS.map((c) => ({ value: byC[c], color: HEX[c] }));
  const critPct = percentages(CRITS.map((c) => byC[c]));
  const tlUnspecified = openObs.filter((o) => !TIMELINES.includes(String(o.timeline || ""))).length;
  void tlUnspecified;

  return (
    <>
      <div className="dash-welcome anim-fade-in">
        <div className="dash-welcome-text">
          <h1>Welcome, {firstName}</h1>
          <p className="dash-welcome-role">{roleTitle}</p>
        </div>
        <div className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={() => modal.open(<NewObsDialog />, { wide: true })}
        >
          + New Observation
        </button>
      </div>

      <div className="dash-kpis">
        <Kpi tone="base" label="Audits" value={nAudits} sub={`${nReports} report${nReports !== 1 ? "s" : ""}`} icon="audit" />
        <Kpi tone="accent" label="Observations" value={total} sub={`${open} open · ${closed} closed`} icon="obs" />
        <Kpi tone="warn" label="Key exposures" value={keyExp} sub="open Critical & High" icon="alert" />
        <Kpi tone="good" label="Remediation rate" value={`${remRate}%`} sub={`${closed} of ${total} closed`} icon="check" />
      </div>

      <div className="dash2">
        <div className="card chart-card anim-fade-in anim-d2">
          <div className="seclabel">Observations by criticality</div>
          <div className="donutwrap">
            <Donut segs={segs} total={total} label="total" />
            <div className="legend" style={{ flex: 1 }}>
              {CRITS.map((c, i) => (
                <div className="li" key={c}>
                  <span className="dot" style={{ background: HEX[c] }} />
                  <span className="lname">{c}</span>
                  <span className="lval">{byC[c]}</span>
                  {/* QA-21 — largest-remainder, so these always total exactly 100%. */}
                  <span className="lpct">{critPct[i]}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="card anim-fade-in anim-d3">
          <div className="seclabel">Due status · open observations</div>
          <div className="tline">
            <div className="tcell tcell-overdue">
              <div className="tn">{closeB["Overdue"]}</div>
              <div className="tl">Overdue</div>
            </div>
            <div className="tcell tcell-watch">
              <div className="tn">{closeB["≤ 2 weeks"]}</div>
              <div className="tl">Watchlist · ≤2 wks</div>
            </div>
            <div className="tcell tcell-track">
              <div className="tn">{onTrackN}</div>
              <div className="tl">On track</div>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 11 }}>
            By expected close date.
            {closeNoDate
              ? ` ${closeNoDate} open observation(s) have no expected close date (set a target date or timeline + report date).`
              : ""}
          </div>
        </div>
      </div>

      <div className="card anim-fade-in anim-d3">
        <div className="seclabel">Risk by process / department</div>
        {areaRows.length ? (
          <>
            <table style={{ marginTop: -2 }}>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  {CRITS.map((c) => (
                    <th scope="col" key={c} style={{ textAlign: "center" }} title={c}>
                      {({ Critical: "Crit", High: "High", Moderate: "Mod", Low: "Low", "Process Improvement": "PI" } as Record<string, string>)[c]}
                    </th>
                  ))}
                  <th scope="col" style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.slice(0, 6).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    {CRITS.map((c) => (
                      <td key={c} style={{ textAlign: "center", color: HEX[c], fontWeight: v[c] ? 700 : 400 }}>
                        {v[c] || "·"}
                      </td>
                    ))}
                    <td style={{ textAlign: "right" }}>
                      <b>{v.t}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {areaRows.length > 6 ? (
              <div className="hint" style={{ marginTop: 8 }}>
                Showing top 6 of {areaRows.length} areas.
              </div>
            ) : null}
          </>
        ) : (
          <Empty>No observations yet.</Empty>
        )}
      </div>

      <div className="dash2 anim-fade-in anim-d4">
        <div className="card obs-close-card">
          <div className="card-head">
            <div>
              <div className="seclabel" style={{ margin: 0 }}>
                Open observations
              </div>
              <div className="card-sub">Expected close timeline across the portfolio</div>
            </div>
            <div className="obs-close-stats">
              <span className="obs-close-stat overdue">{closeB["Overdue"]} overdue</span>
              <span className="obs-close-stat watch">{closeB["≤ 2 weeks"]} due ≤2 wks</span>
              <span className="obs-close-stat track">{onTrackN} on track</span>
            </div>
          </div>
          <div className="obs-close-grid">
            {CLOSE_BUCKETS.map((b) => {
              const cls =
                b === "Overdue" ? "overdue" : b === "≤ 2 weeks" ? "soon" : b === "2–4 weeks" ? "mid" : b === "1–3 months" ? "plan" : "ok";
              return (
                <div className={`obs-close-item ${cls}`} key={b}>
                  <div className="val">{closeB[b]}</div>
                  <div className="lbl">{b}</div>
                </div>
              );
            })}
          </div>
          {closeNoDate ? (
            <div className="hint" style={{ marginTop: 14 }}>
              {closeNoDate} open observation(s) have no expected close date. Set a target date or timeline plus report date.
            </div>
          ) : null}
        </div>
        <div className="card">
          <div className="seclabel">Repeat findings</div>
          <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#6b3fa0" }}>{repeats.length}</div>
            <div className="hint">recurring from prior audits · {repeatOpen} still open</div>
          </div>
          {repeats.length ? (
            <>
              <table style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th scope="col">Observation</th>
                    <th scope="col">Audit</th>
                    <th scope="col">Prior ref</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {repeats.slice(0, 5).map((o) => (
                    <tr key={o.id}>
                      <td>{o.title}</td>
                      <td>{o._a.name}</td>
                      <td>{o.repeatOf || "—"}</td>
                      <td>
                        <StatusPill status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {repeats.length > 5 ? (
                <div className="hint" style={{ marginTop: 6 }}>
                  Showing 5 of {repeats.length}.
                </div>
              ) : null}
            </>
          ) : (
            <div className="hint" style={{ marginTop: 8 }}>
              No repeat findings flagged yet. Tick “Repeat observation” when editing an observation.
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="seclabel">Watchlist — open observations due within 2 weeks</div>
        {watchlist.length ? (
          <>
            <div className="hint" style={{ margin: "-2px 0 8px" }}>
              Click a row to see the details and add notes.
            </div>
            <table>
              <thead>
                <tr>
                  <th scope="col">Expected close</th>
                  <th scope="col">Criticality</th>
                  <th scope="col">Observation</th>
                  <th scope="col">Audit / Area</th>
                  <th scope="col">Action owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.slice(0, 15).map(({ o, d }) => {
                  const ec = effectiveClose(o, o._r);
                  const isOpen = !!watchOpen[o.id];
                  const nc = (o.notes || []).length;
                  return (
                    <Fragment key={o.id}>
                      <tr
                        className={`watch-row${isOpen ? " open" : ""}`}
                        onClick={() => setWatchOpen((cur) => ({ ...cur, [o.id]: !cur[o.id] }))}
                        title="Click for details"
                      >
                        <td>
                          {ec ? fmtDate(ec) : "—"}{" "}
                          {d < 0 ? (
                            <span className="pill c-Critical">{-d}d overdue</span>
                          ) : (
                            <span className="pill c-Moderate">{d}d left</span>
                          )}
                        </td>
                        <td>
                          <CritPill crit={o.criticality} />
                        </td>
                        <td>
                          <RowOpen
                            onOpen={() => setWatchOpen((cur) => ({ ...cur, [o.id]: !cur[o.id] }))}
                            label={`${isOpen ? "Hide" : "Show"} details for ${o.title}`}
                            expanded={isOpen}
                            controls={`watch-detail-${o.id}`}
                          >
                            <span className="watch-caret" aria-hidden="true">
                              {isOpen ? "▾" : "▸"}
                            </span>{" "}
                            <b>{o.title}</b>
                          </RowOpen>
                        </td>
                        <td>
                          {o._a.name}
                          <div className="hint">{(o._a.area as string) || ""}</div>
                        </td>
                        <td>{o.owner || "—"}</td>
                        <td>
                          <StatusPill status={o.status} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            className="btn ghost sm watch-note-btn"
                            type="button"
                            title="Add / view notes"
                            onClick={() => modal.open(<AddNoteDialog obsId={o.id} />)}
                          >
                            {nc ? (
                              <span className="pill note-count">
                                {nc} note{nc !== 1 ? "s" : ""}
                              </span>
                            ) : (
                              "+ Add note"
                            )}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="watch-detail-row">
                          <td colSpan={7} id={`watch-detail-${o.id}`}>
                            <div className="watch-detail anim-fade-in">
                              <div className="watch-detail-meta">
                                {[
                                  o.category ? ["Category", o.category] : null,
                                  ["Audit / report", `${o._a.name}${o._r ? " · " + o._r.title : ""}`],
                                  o.timeline ? ["Resolution timeline", o.timeline] : null,
                                  ec ? ["Expected close", fmtDate(ec)] : null,
                                  ["Action owner", o.owner || "—"],
                                ]
                                  .filter(Boolean)
                                  .map((m) => (
                                    <div className="watch-meta-item" key={(m as string[])[0]}>
                                      <span className="watch-meta-label">{(m as string[])[0]}</span>
                                      <span className="watch-meta-value">{(m as string[])[1] as string}</span>
                                    </div>
                                  ))}
                                <div className="watch-meta-item">
                                  <span className="watch-meta-label">Status</span>
                                  <span className="watch-meta-value">
                                    <StatusPill status={o.status} />
                                  </span>
                                </div>
                              </div>
                              <div className="obs-detail-sections">
                                <DetailSection title="Detailed description" text={o.description} />
                                <DetailSection title="Impact / risk" text={o.risk} />
                                <DetailSection title="Recommendation" text={o.recommendation} />
                                <DetailSection title="Management response" text={o.managementResponse} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {watchlist.length > 15 ? (
              <div className="hint" style={{ marginTop: 8 }}>
                Showing 15 of {watchlist.length}.
              </div>
            ) : null}
          </>
        ) : (
          <Empty>No open observations due within 2 weeks.</Empty>
        )}
      </div>

      <div className="card">
        <div className="seclabel">Top open Critical &amp; High exposures</div>
        {critical.length ? (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">Criticality</th>
                  <th scope="col">Observation</th>
                  <th scope="col">Audit / Area</th>
                  <th scope="col">Action owner</th>
                  <th scope="col">Timeline</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {critical.slice(0, 12).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className={`pill c-${ck(o.criticality)}`}>{o.criticality}</span>
                    </td>
                    <td>
                      <b>{o.title}</b>
                    </td>
                    <td>
                      {o._a.name}
                      <div className="hint">{(o._a.area as string) || ""}</div>
                    </td>
                    <td>{o.owner || "—"}</td>
                    <td className="timeline-cell">
                      <TlPill t={o.timeline as string} />
                    </td>
                    <td>
                      <StatusPill status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {critical.length > 12 ? (
              <div className="hint" style={{ marginTop: 8 }}>
                Showing 12 of {critical.length} open key exposures.
              </div>
            ) : null}
          </>
        ) : (
          <Empty>No open Critical or High observations.</Empty>
        )}
      </div>
    </>
  );
}
