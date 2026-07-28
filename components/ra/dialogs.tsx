"use client";

// Dialogs for the audit risk assessment — ports of modalRA/saveRA, modalNewAuditPlan/
// createAuditPlan, modalRAPrompt/generateRAUniverse, modalAnnualPlanPrompt/generateAnnualPlan
// and modalRADownload in audit-bot.js.

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiJson } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { urlForView } from "@/lib/routes";
import {
  ENG_STATUS,
  ensureUniverse,
  engIsComplete,
  planYear,
  planYearHasData,
  RA_BANDS,
  RA_FACTORS,
  RA_HEX,
  raBand,
  raComposite,
  raDue,
  raFreqLabel,
  parseQuarters,
  universe,
} from "@/lib/workspace/ra";
import { hx2rgba, uid } from "@/lib/workspace/selectors";
import type { AuditUniverseUnit, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { exportAuditPlan, exportRA } from "./exports";

/* ---------------- add / edit auditable unit ---------------- */

type UnitForm = {
  name: string;
  category: string;
  owner: string;
  factors: Record<string, number>;
  lastAudited: string;
  ratingOverride: string;
  frequencyOverride: string;
  quarters: number[];
  rationale: string;
};

function formFor(e: AuditUniverseUnit | undefined): UnitForm {
  const factors: Record<string, number> = {};
  RA_FACTORS.forEach(([k]) => (factors[k] = Number(e?.factors?.[k]) || 3));
  const quarters = [
    ...new Set(
      parseQuarters(e?.plannedPeriod)
        .map((q) => {
          const m = String(q).match(/Q\s*([1-4])/i);
          return m ? +m[1] : 0;
        })
        .filter(Boolean),
    ),
  ].sort((a, b) => a - b);
  return {
    name: e?.name || "",
    category: e?.category || "",
    owner: e?.owner || "",
    factors,
    lastAudited: e?.lastAudited || "",
    ratingOverride: e?.ratingOverride || "",
    frequencyOverride: e?.frequencyOverride || "",
    quarters,
    rationale: e?.rationale || "",
  };
}

export function RaUnitDialog({ unitId }: { unitId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const existing = unitId ? universe(db).find((x) => x.id === unitId) : undefined;
  const [f, setF] = useState<UnitForm>(() => formFor(existing));
  // Timing year: keep the year already on the unit; NEW units default to the current calendar
  // year — not the active plan year, which may already be opened for a future year.
  const py =
    (existing?.plannedPeriod || "").match(/20\d{2}/)?.[0] ||
    String(new Date().getFullYear());

  function toggleQuarter(q: number) {
    setF((cur) => ({
      ...cur,
      quarters: cur.quarters.includes(q)
        ? cur.quarters.filter((x) => x !== q)
        : [...cur.quarters, q].sort((a, b) => a - b),
    }));
  }

  function save() {
    const name = f.name.trim();
    if (!name) {
      toast("Unit name required");
      return;
    }
    const data = {
      name,
      category: f.category,
      owner: f.owner,
      factors: f.factors,
      lastAudited: f.lastAudited,
      ratingOverride: f.ratingOverride,
      frequencyOverride: f.frequencyOverride,
      plannedPeriod: f.quarters.length ? f.quarters.map((n) => "Q" + n).join(", ") + " " + py : "",
      rationale: f.rationale,
    };
    mutate((d) => {
      const U = ensureUniverse(d);
      const cur = unitId ? U.find((x) => x.id === unitId) : undefined;
      if (cur) Object.assign(cur, data);
      else U.push({ id: uid(), ...data, createdAt: new Date().toISOString() });
    });
    modal.close();
  }

  return (
    <ModalFrame
      title={unitId ? "Edit auditable unit" : "Add auditable unit"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="f3">
        <div>
          <label>Auditable unit *</label>
          <input
            value={f.name}
            onChange={(e) => setF((c) => ({ ...c, name: e.target.value }))}
            placeholder="e.g. Credit Operations"
          />
        </div>
        <div>
          <label>Category</label>
          <input
            value={f.category}
            onChange={(e) => setF((c) => ({ ...c, category: e.target.value }))}
            placeholder="Process / Dept / Function"
          />
        </div>
        <div>
          <label>Owner</label>
          <input value={f.owner} onChange={(e) => setF((c) => ({ ...c, owner: e.target.value }))} />
        </div>
      </div>

      <div className="seclabel" style={{ margin: "14px 0 8px" }}>
        Risk factors (1 = low, 5 = high)
      </div>
      <div className="f2">
        {RA_FACTORS.map(([k, lab, w]) => (
          <div key={k}>
            <label>
              {lab} <span className="hint">({Math.round(w * 100)}%)</span>
            </label>
            <select
              value={f.factors[k]}
              onChange={(e) =>
                setF((c) => ({ ...c, factors: { ...c.factors, [k]: +e.target.value } }))
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="f3" style={{ marginTop: 8 }}>
        <div>
          <label>Last audited (year)</label>
          <input
            value={f.lastAudited}
            onChange={(e) => setF((c) => ({ ...c, lastAudited: e.target.value }))}
            placeholder="e.g. 2024"
          />
        </div>
        <div>
          <label>Rating override</label>
          <select
            value={f.ratingOverride}
            onChange={(e) => setF((c) => ({ ...c, ratingOverride: e.target.value }))}
          >
            <option value="">Auto</option>
            {[...RA_BANDS].reverse().map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Frequency override</label>
          <input
            value={f.frequencyOverride}
            onChange={(e) => setF((c) => ({ ...c, frequencyOverride: e.target.value }))}
            placeholder="blank = auto"
          />
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <label>
          Planned timing{" "}
          <span className="hint">
            (tick each quarter this unit is audited — e.g. Q1 &amp; Q3 for twice a year)
          </span>
        </label>
        <div className="row" style={{ gap: 16, flexWrap: "wrap", marginTop: 4 }}>
          {[1, 2, 3, 4].map((q) => (
            <label
              key={q}
              className="filter-check"
              style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 500, margin: 0 }}
            >
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={f.quarters.includes(q)}
                onChange={() => toggleQuarter(q)}
              />{" "}
              Q{q} <span className="hint">{py}</span>
            </label>
          ))}
        </div>
      </div>

      <label>Rationale / notes (for the plan)</label>
      <textarea
        value={f.rationale}
        onChange={(e) => setF((c) => ({ ...c, rationale: e.target.value }))}
      />
    </ModalFrame>
  );
}

/* ---------------- new annual plan ---------------- */

export function NewPlanDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const U = universe(db)
    .slice()
    .sort((a, b) => raComposite(b.factors) - raComposite(a.factors));
  const cur = new Date().getFullYear();
  const [year, setYear] = useState(String(cur));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(U.map((e) => e.id)));
  const [err, setErr] = useState("");

  if (!U.length) {
    return (
      <ModalFrame
        title="New annual audit plan"
        footer={
          <>
            <button className="btn sec" type="button" onClick={modal.close}>
              Close
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                modal.close();
                router.push(urlForView("auditra"));
              }}
            >
              Go to Audit Risk Assessment
            </button>
          </>
        }
      >
        <div className="empty">
          <div className="big">🗂</div>
          Your audit universe is empty.
          <br />
          Add or generate auditable units in <b>Audit Risk Assessment</b> first — the annual plan
          is built from them.
        </div>
      </ModalFrame>
    );
  }

  function apply() {
    mutate((d) => {
      ensureUniverse(d).forEach((e) => {
        if (picked.has(e.id)) {
          e.includeInPlan = true;
          if ((e.plannedPeriod || "").trim())
            e.plannedPeriod = e.plannedPeriod!.replace(/20\d{2}/g, year);
        } else {
          e.includeInPlan = false;
        }
      });
      d.planYears = d.planYears || [];
      if (!d.planYears.map(String).includes(year)) d.planYears.push(year);
      d.planYear = year;
    });
    logAudit(
      "plan.year_created",
      "Opened annual plan for " + year + " (" + picked.size + " unit(s))",
      { year },
    );
    modal.close();
  }

  async function create() {
    if (!/^20\d{2}$/.test(year)) {
      setErr(`Enter a valid year, e.g. ${new Date().getFullYear()}.`);
      return;
    }
    if (!picked.size) {
      setErr("Select at least one unit for the plan.");
      return;
    }
    setErr("");
    if (planYearHasData(db, year)) {
      const ok = await modal.confirm({
        message: `A plan already exists for ${year}. Switch to it and re-apply the selected units?`,
        confirmLabel: "Switch & apply",
      });
      if (!ok) return;
    }
    apply();
  }

  const allChecked = picked.size === U.length;

  return (
    <ModalFrame
      title="New annual audit plan"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={() => void create()}>
            Create plan
          </button>
        </>
      }
    >
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Open a plan year and choose which auditable units are scheduled into it. Checked units roll
        their timing to the plan year; set each unit&rsquo;s quarters afterwards from the Audit Risk
        Assessment.
      </p>
      <label>Plan year *</label>
      <input
        type="number"
        min="2000"
        max="2100"
        value={year}
        placeholder={`e.g. ${cur}`}
        onChange={(e) => setYear(e.target.value)}
      />
      {err ? (
        <div className="hint" style={{ color: "var(--crit)", marginTop: 8 }}>
          {err}
        </div>
      ) : null}

      <div className="row" style={{ alignItems: "center", margin: "16px 0 8px" }}>
        <div className="seclabel" style={{ margin: 0 }}>
          Units in this plan
        </div>
        <div className="spacer" />
        <span className="hint">
          {picked.size} of {U.length} selected
        </span>
      </div>
      <label
        className="filter-check"
        style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 8 }}
      >
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={allChecked}
          onChange={(e) => setPicked(e.target.checked ? new Set(U.map((x) => x.id)) : new Set())}
        />{" "}
        Include all {U.length} unit(s)
      </label>
      <div className="np-unit-list">
        {U.map((e) => {
          const band = e.ratingOverride || raBand(raComposite(e.factors));
          return (
            <label className="filter-check np-unit-row" key={e.id}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={picked.has(e.id)}
                onChange={(ev) =>
                  setPicked((cur) => {
                    const n = new Set(cur);
                    if (ev.target.checked) n.add(e.id);
                    else n.delete(e.id);
                    return n;
                  })
                }
              />
              <span className="np-unit-name">{e.name}</span>
              {e.category ? <span className="hint np-unit-cat">{e.category}</span> : null}
              <span
                className="pill"
                style={{ background: hx2rgba(RA_HEX[band], 0.16), color: RA_HEX[band] }}
              >
                {band}
              </span>
            </label>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Unchecked units are excluded from this year&rsquo;s plan.
      </div>
    </ModalFrame>
  );
}

/* ---------------- AI: generate the audit universe ---------------- */

function buildRAPrompt(db: WorkspaceDb, ctx: string): string {
  const factorList = RA_FACTORS.map(
    ([k, lab, w]) => `    "${k}": 3,   // ${lab} (weight ${Math.round(w * 100)}%), 1-5`,
  ).join("\n");
  return `Act as Chief Audit Executive for ${db.org}. Perform a risk-based annual audit risk assessment to build the audit universe and recommend the annual audit plan, in line with IIA Standard 2010.

Context / areas:
${ctx || "(infer the typical auditable units for a consumer-credit corporation)"}

List the auditable units (processes, departments, functions). For each, score the risk factors on a 1–5 scale (1 low, 5 high) and give a brief rationale. The composite weighted score sets the rating and audit frequency: Critical/High = annual, Medium = every 2 years, Low = every 3 years. Return ONLY a JSON array (no commentary):
[
  {
    "name": "auditable unit",
    "category": "Process | Department | Function",
    "owner": "responsible executive / role",
    "factors": {
${factorList}
    },
    "lastAudited": "year if known, else empty string",
    "rationale": "why this risk level and audit frequency"
  }
]`;
}

type RawUnit = {
  name?: string;
  unit?: string;
  category?: string;
  owner?: string;
  factors?: Record<string, unknown>;
  lastAudited?: unknown;
  ratingOverride?: string;
  rating?: string;
  frequencyOverride?: string;
  frequency?: string;
  plannedPeriod?: string;
  timing?: string;
  engStatus?: string;
  includeInPlan?: unknown;
  rationale?: string;
};

export function GenerateUniverseDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [ctx, setCtx] = useState("");
  const [err, setErr] = useState("");

  async function generate() {
    setErr("");
    let data: unknown;
    try {
      data = await runAiJson(buildRAPrompt(db, ctx));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const arr = (Array.isArray(data) ? data : [data]) as RawUnit[];
    const rows: AuditUniverseUnit[] = [];
    arr.forEach((x) => {
      if (!x || typeof x !== "object") return;
      const factors: Record<string, number> = {};
      RA_FACTORS.forEach(([k]) => {
        factors[k] = Math.min(5, Math.max(1, Math.round(Number(x.factors?.[k]) || 3)));
      });
      const ro =
        RA_BANDS.find(
          (b) => b.toLowerCase() === String(x.ratingOverride || x.rating || "").toLowerCase(),
        ) || "";
      const es = ENG_STATUS.find((s) => s.toLowerCase() === String(x.engStatus || "").toLowerCase());
      rows.push({
        id: uid(),
        name: x.name || x.unit || "(unnamed)",
        category: x.category || "",
        owner: x.owner || "",
        factors,
        lastAudited: x.lastAudited ? String(x.lastAudited) : "",
        ratingOverride: ro,
        frequencyOverride: x.frequencyOverride || x.frequency || "",
        plannedPeriod: x.plannedPeriod || x.timing || "",
        engStatus: es || "Not started",
        includeInPlan: x.includeInPlan != null ? !!x.includeInPlan : undefined,
        rationale: x.rationale || "",
        createdAt: new Date().toISOString(),
      });
    });
    if (!rows.length) {
      setErr("No auditable units found in that JSON.");
      return;
    }
    mutate((d) => ensureUniverse(d).push(...rows));
    logAudit("plan.universe_generated", `Generated ${rows.length} auditable unit(s) with AI`, {
      count: rows.length,
    });
    modal.close();
    toast(`${rows.length} auditable unit(s) added.`, "success");
  }

  return (
    <ModalFrame
      title="Generate audit universe"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate audit universe
          </BusyButton>
        </>
      }
    >
      <label>Organisation context / areas</label>
      <textarea
        style={{ minHeight: 90 }}
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
        placeholder="e.g. CREDICORP: Credit Operations, Treasury, Finance, IT, HR, Procurement, Risk & Compliance, Internal Control. New core banking go-live 2026; regulated by CBN."
      />
      {err ? <div className="ai-err">{err}</div> : null}
    </ModalFrame>
  );
}

/* ---------------- AI: generate the annual plan ---------------- */

function buildAnnualPlanPrompt(db: WorkspaceDb, ctx: string): string {
  const py = planYear(db);
  const units = universe(db)
    .map((e) => {
      const band = e.ratingOverride || raBand(raComposite(e.factors));
      const due = raDue(db, e, band);
      return `- "${e.name}" [${e.category || "unit"}] · rating ${band} · frequency ${e.frequencyOverride || raFreqLabel(band)} · last audited ${e.lastAudited || "never"} · ${due ? "DUE" : "not due"} in ${py}`;
    })
    .join("\n");
  return `Act as Chief Audit Executive for ${db.org}. Build the risk-based Annual Audit Plan for ${py} from the audit universe below, in line with IIA Standard 2010. Prioritise Critical/High-rated and due units; balance the workload across the four quarters (Q1–Q4 ${py}). Only defer a due unit if capacity requires it.
${ctx ? `\nConstraints / context:\n${ctx}\n` : ""}
Audit universe:
${units}

Return ONLY a JSON array (no commentary). One object per unit above, matched by exact name:
[
  {
    "name": "must exactly match a unit name above",
    "include": true,
    "timing": "Q2 ${py}"  /* one of: "Q1 ${py}", "Q2 ${py}", "Q3 ${py}", "Q4 ${py}", "Q1-Q2 ${py}", "Q3-Q4 ${py}", "Q1-Q4 ${py}", or "" when not included */,
    "rationale": "why included/deferred and why this timing"
  }
]`;
}

type RawPlanRow = {
  name?: string;
  unit?: string;
  include?: unknown;
  timing?: string;
  plannedPeriod?: string;
  rationale?: string;
};

export function GeneratePlanDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [ctx, setCtx] = useState("");
  const [err, setErr] = useState("");
  const py = planYear(db);
  const count = universe(db).length;

  async function generate() {
    setErr("");
    let data: unknown;
    try {
      data = await runAiJson(buildAnnualPlanPrompt(db, ctx));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
      return;
    }
    const arr = (Array.isArray(data) ? data : [data]) as RawPlanRow[];
    let n = 0;
    mutate((d) => {
      const U = ensureUniverse(d);
      arr.forEach((x) => {
        if (!x || typeof x !== "object") return;
        const nm = String(x.name || x.unit || "")
          .trim()
          .toLowerCase();
        if (!nm) return;
        const e = U.find((u) => u.name.trim().toLowerCase() === nm);
        if (!e) return;
        const inc = x.include != null ? !!x.include : !!x.timing;
        e.includeInPlan = inc;
        const tm = String(x.timing || x.plannedPeriod || "").trim();
        if (inc && tm) e.plannedPeriod = tm.replace(/20\d{2}/g, planYear(d)).trim();
        if (x.rationale) e.rationale = String(x.rationale);
        if (inc && !engIsComplete(e) && e.engStatus !== "In progress")
          e.engStatus = e.engStatus || "Not started";
        n++;
      });
    });
    if (!n) {
      setErr("No matching units found in that JSON. Names must match your audit universe.");
      return;
    }
    logAudit("plan.generated", `Generated the ${py} annual audit plan with AI (${n} unit(s))`, {
      year: py,
      count: n,
    });
    modal.close();
    toast(`Annual plan updated for ${n} unit(s).`, "success");
  }

  return (
    <ModalFrame
      title="Generate annual audit plan"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate annual audit plan
          </BusyButton>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 8 }}>
        AI will select which units belong in the <b>{py}</b> plan (by risk rating &amp; the
        audit-frequency cycle) and schedule each into quarters. This updates the plan selection,
        timing and rationale for the {count} unit(s) in your universe.
      </div>
      <label>Constraints / context (optional)</label>
      <textarea
        style={{ minHeight: 80 }}
        value={ctx}
        onChange={(e) => setCtx(e.target.value)}
        placeholder="e.g. Only 2 auditors; core banking go-live in Q2 so defer IT audit to Q3; regulator expects Credit & Treasury covered this year."
      />
      {err ? (
        <div className="ai-err" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- download picker ---------------- */

export function RaDownloadDialog() {
  const { db } = useWorkspace();
  const modal = useModal();
  return (
    <ModalFrame
      title="Download"
      footer={
        <button className="btn sec" type="button" onClick={modal.close}>
          Cancel
        </button>
      }
    >
      <p className="hint">Choose a Word export:</p>
      <div className="download-choices">
        <button
          className="btn"
          type="button"
          onClick={() => {
            modal.close();
            exportRA(db);
          }}
        >
          Risk assessment
        </button>
        <button
          className="btn sec"
          type="button"
          onClick={() => {
            modal.close();
            exportAuditPlan(db);
          }}
        >
          Audit plan
        </button>
      </div>
    </ModalFrame>
  );
}
