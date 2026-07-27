"use client";

// The raise → assign → approval flow (port of raiseReviewStep/raiseAssignStep/raiseObs from
// audit-bot.js). Entry points hand a drafted Observation here (AI one-liner, raise-exception
// from a test, manual). Step 1 reviews/edits the draft; step 2 assigns owners + timing and
// submits — Head raises immediately (owner notified), staff submit for Head approval.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiJson } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { directory, loadDirectory } from "@/lib/client/directory";
import { urlForView } from "@/lib/routes";
import {
  departments,
  isHead,
  notifyHeadsApproval,
  notifyOwnerAssigned,
  priorObsForRepeat,
  TIMELINES,
} from "@/lib/workspace/observations";
import { approvals, ck, uid } from "@/lib/workspace/selectors";
import type { Observation } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function RaiseFlow({
  auditId,
  reportId,
  draft,
}: {
  auditId: string;
  reportId: string;
  draft: Observation;
}) {
  const { db, mutate } = useWorkspace();
  const user = useUser();
  const modal = useModal();
  const router = useRouter();
  const head = isHead(user);

  const [step, setStep] = useState<1 | 2>(1);
  const [o, setO] = useState<Observation>({ ...draft });
  const [err, setErr] = useState("");

  // Step 2 state
  const [ownerId, setOwnerId] = useState(String(o.ownerUserId || ""));
  const [owner2Id, setOwner2Id] = useState(String(o.secondaryOwnerUserId || ""));
  const [timeline, setTimeline] = useState(String(o.timeline || ""));
  const [due, setDue] = useState(String(o.dueDate || ""));
  const [isRepeat, setIsRepeat] = useState(!!o.isRepeat);
  const [repeatOf, setRepeatOf] = useState(String(o.repeatOf || ""));
  const [repMenuOpen, setRepMenuOpen] = useState(false);
  const [aiRepMsg, setAiRepMsg] = useState<React.ReactNode>(null);
  const [dirVersion, setDirVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDirectory().then(() => {
      if (!cancelled) setTimeout(() => setDirVersion((v) => v + 1), 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  void dirVersion;

  const set = (k: keyof Observation) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setO((cur) => ({ ...cur, [k]: e.target.value }));

  const dir = directory();
  // Skip departments whose head's login was deactivated (keep an existing selection visible).
  const ownerDepts = departments(db)
    .filter((d) => d.headUserId)
    .filter((d) => {
      const u = dir.find((x) => x.id === d.headUserId);
      return !u || u.active !== false || d.headUserId === ownerId || d.headUserId === owner2Id;
    });
  const priors = priorObsForRepeat(db, reportId);
  const [repQ, setRepQ] = useState("");

  function next() {
    if (!String(o.title || "").trim()) {
      setErr("A title is required.");
      return;
    }
    setErr("");
    setStep(2);
  }

  async function aiScanRepeats() {
    if (!priors.length) {
      setAiRepMsg(<div className="hint">No prior observations in other reports to compare against.</div>);
      return;
    }
    setAiRepMsg(<div className="hint">AI scanning {priors.length} prior observation(s)…</div>);
    try {
      const d = await runAiJson<{ isRepeat?: unknown; repeatOf?: string; reason?: string }>(
        `You are checking whether a new internal-audit observation repeats a prior finding. New observation:\nTitle: ${o.title}\nDescription: ${o.description}\n\nPrior observations from other reports:\n${priors
          .slice(0, 60)
          .map((p, i) => `${i + 1}. [${p.ref}] ${p.title} (${p.audit} · ${p.report} · ${p.status})`)
          .join("\n")}\n\nReturn ONLY a JSON object: {"isRepeat": true or false, "repeatOf": "the [ref] of the best matching prior observation, else empty", "reason": "one short sentence"}`,
      );
      if (d && (d.isRepeat === true || String(d.isRepeat).toLowerCase() === "true")) {
        setIsRepeat(true);
        if (d.repeatOf) setRepeatOf(String(d.repeatOf));
        setAiRepMsg(
          <>
            <div className="hint" style={{ color: "var(--low)", fontWeight: 600 }}>
              ✓ AI flagged this as a likely repeat of {d.repeatOf || "a prior finding"}.
            </div>
            {d.reason ? <div className="hint">{d.reason}</div> : null}
          </>,
        );
      } else {
        setAiRepMsg(
          <div className="hint">AI found no strong repeat match.{d && d.reason ? " " + d.reason : ""}</div>,
        );
      }
    } catch (e) {
      setAiRepMsg(<div className="ai-err">{e instanceof Error ? e.message : "AI scan failed."}</div>);
    }
  }

  function submit() {
    const dept = departments(db).find((d) => d.headUserId === ownerId);
    const sec2 = ownerId && owner2Id === ownerId ? "" : owner2Id;
    const dept2 = departments(db).find((d) => d.headUserId === sec2);
    const now = new Date().toISOString();
    const finalObs: Observation = {
      ...o,
      timeline,
      dueDate: due || "",
      isRepeat,
      repeatOf,
      ownerUserId: ownerId || "",
      owner: dept ? dept.headName : o.owner || "",
      departmentId: dept ? dept.id : "",
      secondaryOwnerUserId: sec2 || "",
      secondaryOwner: dept2 ? dept2.headName : "",
      raisedBy: user.id || "",
      raisedByName: user.name || "",
      raisedAt: now,
      obsApproval: head ? "approved" : "pending",
    };
    mutate((d) => {
      const a = (d.audits || []).find((x) => x.id === auditId);
      const r = a && (a.reports || []).find((x) => x.id === reportId);
      if (!r) return;
      r.observations.push(finalObs);
      if (head) {
        notifyOwnerAssigned(d, finalObs);
      } else {
        approvals(d).push({
          id: uid(),
          kind: "observation_raise",
          obsId: finalObs.id,
          auditId,
          reportId,
          obsTitle: finalObs.title,
          ownerUserId: finalObs.ownerUserId || "",
          requestedBy: finalObs.raisedBy,
          requestedByName: finalObs.raisedByName,
          requestedAt: finalObs.raisedAt,
          status: "pending",
        });
        notifyHeadsApproval(d, finalObs.title);
      }
    });
    logAudit(
      head ? "obs.raised" : "obs.raise_requested",
      (head ? "Raised observation: " : "Submitted observation for approval: ") + finalObs.title,
      { auditId, reportId, observationId: finalObs.id },
    );
    modal.closeAll();
    router.push(urlForView("report", { audit: auditId, report: reportId }));
    toast(
      head ? "Observation raised. The action owner has been notified." : "Submitted to the Head of Audit for approval.",
      "success",
    );
  }

  if (step === 1)
    return (
      <ModalFrame
        title="Review & edit observation"
        footer={
          <>
            <button className="btn sec" type="button" onClick={() => modal.close()}>
              Cancel
            </button>
            <button className="btn" type="button" onClick={next}>
              Next: assign owner →
            </button>
          </>
        }
      >
        <div className="hint" style={{ marginBottom: 12 }}>
          Review what was drafted and edit anything before assigning an owner.
        </div>
        <div className="f3">
          <div>
            <label>Ref</label>
            <input value={String(o.ref || "")} onChange={set("ref")} placeholder="e.g. 1.1" />
          </div>
          <div>
            <label>Criticality *</label>
            <select value={String(o.criticality || "Moderate")} onChange={set("criticality")}>
              {["Critical", "High", "Moderate", "Low", "Process Improvement"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Category / theme</label>
            <input value={String(o.category || "")} onChange={set("category")} />
          </div>
        </div>
        <label>Title *</label>
        <input value={String(o.title || "")} onChange={set("title")} />
        <label>Detailed description (condition)</label>
        <textarea className="rv-area" value={String(o.description || "")} onChange={set("description")} />
        <label>Criteria / expectation</label>
        <textarea className="rv-area" value={String(o.criteria || "")} onChange={set("criteria")} />
        <label>Impact / risk</label>
        <textarea className="rv-area" value={String(o.risk || "")} onChange={set("risk")} />
        <label>Possible root cause</label>
        <textarea className="rv-area" value={String(o.rootCause || "")} onChange={set("rootCause")} />
        <label>Recommendation</label>
        <textarea className="rv-area" value={String(o.recommendation || "")} onChange={set("recommendation")} />
        {err ? (
          <div style={{ marginTop: 8 }}>
            <div className="ai-err">{err}</div>
          </div>
        ) : null}
      </ModalFrame>
    );

  const visiblePriors = priors.filter((p) => {
    const q = repQ.toLowerCase().trim();
    if (!q) return true;
    return (p.ref + " " + p.title + " " + p.audit + " " + p.report).toLowerCase().includes(q);
  });

  return (
    <ModalFrame
      title="Raise observation — assign owner"
      footer={
        <>
          <button className="btn sec" type="button" onClick={() => setStep(1)}>
            ← Back
          </button>
          <button className="btn" type="button" onClick={submit}>
            {head ? "Raise & notify owner" : "Submit for approval"}
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>
          {o.ref ? o.ref + " — " : ""}
          {String(o.title)}
        </b>{" "}
        · <span className={`pill c-${ck(String(o.criticality))}`}>{String(o.criticality)}</span>
      </div>
      <label>Primary action owner (responds &amp; closes) *</label>
      <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
        <option value="">— select primary owner —</option>
        {ownerDepts.map((d) => (
          <option key={d.id} value={d.headUserId}>
            {d.headName} · {d.name}
          </option>
        ))}
      </select>
      {ownerDepts.length ? null : (
        <div className="hint" style={{ color: "var(--crit)", marginTop: 4 }}>
          No department heads exist yet — add departments in Settings to assign an owner (you can still raise without one).
        </div>
      )}
      <label style={{ marginTop: 8 }}>
        Secondary action owner <span className="hint">(oversight only — optional)</span>
      </label>
      <select value={owner2Id} onChange={(e) => setOwner2Id(e.target.value)}>
        <option value="">— none —</option>
        {ownerDepts.map((d) => (
          <option key={d.id} value={d.headUserId}>
            {d.headName} · {d.name}
          </option>
        ))}
      </select>
      <div className="hint" style={{ marginTop: 4 }}>
        The secondary owner is notified and can follow the remediation and comment, but only the primary owner responds and marks it Ready for Closure.
      </div>
      <div className="f2" style={{ marginTop: 8 }}>
        <div>
          <label>Resolution timeline</label>
          <select value={timeline} onChange={(e) => setTimeline(e.target.value)}>
            <option value="">— select —</option>
            {TIMELINES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Closure date</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
          <input
            type="checkbox"
            style={{ width: "auto" }}
            checked={isRepeat}
            onChange={(e) => setIsRepeat(e.target.checked)}
          />{" "}
          Repeat observation (raised in a prior audit)
        </label>
      </div>
      <label style={{ marginTop: 6 }}>
        Repeat of <span className="hint">(search prior observations)</span>
      </label>
      <div className="ra-link-search">
        <input
          className="ra-link-input"
          placeholder="Search prior observations…"
          autoComplete="off"
          value={repeatOf || repQ}
          onChange={(e) => {
            setRepeatOf("");
            setRepQ(e.target.value);
            setRepMenuOpen(true);
          }}
          onFocus={() => setRepMenuOpen(true)}
          onBlur={() => setTimeout(() => setRepMenuOpen(false), 150)}
        />
        {repMenuOpen ? (
          <div className="ra-link-menu" style={{ display: "block" }}>
            {visiblePriors.length ? (
              visiblePriors.slice(0, 40).map((p, i) => {
                const label = (p.ref ? p.ref + " — " : "") + p.title;
                return (
                  <div
                    key={i}
                    className="ra-link-opt"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setRepeatOf(label);
                      setIsRepeat(true);
                      setRepMenuOpen(false);
                    }}
                  >
                    {label}
                    <div className="hint">
                      {p.audit} · {p.report} · {p.status}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="ra-link-opt" style={{ color: "#94a3b8" }}>
                No prior observations in other reports.
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="btn sec sm ai-generate-btn" type="button" onClick={aiScanRepeats}>
          AI scan for repeats
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 13 }}>{aiRepMsg}</div>
      <div className="hint" style={{ marginTop: 10 }}>
        {head
          ? "As Head of Audit, this observation is raised and the action owner is notified immediately."
          : "This observation will be sent to the Head of Audit for approval before the action owner is notified."}
      </div>
    </ModalFrame>
  );
}
