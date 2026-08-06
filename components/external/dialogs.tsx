"use client";

// External-findings dialogs — ports of modalExt/saveExt, extRaiseStart/extDetailsStep/
// extAssignStep/saveExtRaise, extAssignOwner/saveExtAssign, modalExtImport/doImportExtCSV and
// modalExtCommentary/generateExtCommentary from public/audit-bot.js.

import { useRef, useState } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { runAiText } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { countReplacementChars, readTextFile } from "@/lib/client/csv-encoding";
import {
  buildExtInsightPrompt,
  ensureExtList,
  extFindingsFromCsv,
  extNextRef,
  EXT_SEVERITIES,
  EXT_SOURCES,
  EXT_THEMES,
} from "@/lib/workspace/external";
import {
  departments,
  notifyBoth,
  notifyDeptOfObs,
  notifyOwnerAssigned,
} from "@/lib/workspace/observations";
import { isoNow, uid } from "@/lib/workspace/selectors";
import type { ExtFinding, Observation, WorkspaceDb } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import { useUser } from "@/components/chrome/UserContext";
import { useDirectoryUsers } from "./use-directory";
import { downloadExtTemplate } from "./exports";

const STATUSES = ["Open", "In Progress", "Closed"];

/* ---------------- owner select (port of ownerOptions) ---------------- */

function OwnerSelect({
  db,
  value,
  placeholder,
  onChange,
}: {
  db: WorkspaceDb;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const dir = useDirectoryUsers();
  // Skip departments whose head's login was deactivated (keep an existing selection visible).
  const D = departments(db)
    .filter((d) => d.headUserId)
    .filter((d) => {
      const u = dir.find((x) => x.id === d.headUserId);
      return !u || u.active !== false || d.headUserId === value;
    });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {D.map((d) => (
        <option key={d.id} value={d.headUserId}>
          {d.headName} · {d.name}
        </option>
      ))}
    </select>
  );
}

/* ---------------- add / edit finding (modalExt / saveExt) ---------------- */

type ExtForm = {
  source: string;
  sourceRef: string;
  year: string;
  ref: string;
  theme: string;
  severity: string;
  title: string;
  detail: string;
  risk: string;
  recommendation: string;
  owner: string;
  targetDate: string;
  status: string;
  isRepeat: boolean;
  repeatOf: string;
  verifiedBy: string;
  closureEvidence: string;
  closedDateISO: string;
};

function editFormFor(db: WorkspaceDb, f: ExtFinding | undefined): ExtForm {
  return {
    source: f?.source || "Statutory / External Audit",
    sourceRef: f?.sourceRef || "",
    year: f?.year ?? String(new Date().getFullYear()),
    ref: f?.ref || extNextRef(db),
    theme: f ? f.theme || "" : "Governance & compliance",
    severity: f?.severity || "Medium",
    title: f?.title || "",
    detail: f?.detail || "",
    risk: f?.risk || "",
    recommendation: f?.recommendation || "",
    owner: f?.owner || "",
    targetDate: f?.targetDate || "",
    status: f?.status || "Open",
    isRepeat: !!f?.isRepeat,
    repeatOf: f?.repeatOf || "",
    verifiedBy: f?.verifiedBy || "",
    closureEvidence: f?.closureEvidence || "",
    closedDateISO: f?.closedDateISO || "",
  };
}

export function ExtEditDialog({ findingId }: { findingId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const existing = findingId ? (db.extFindings || []).find((x) => x.id === findingId) : undefined;
  const [f, setF] = useState<ExtForm>(() => editFormFor(db, existing));
  const set = <K extends keyof ExtForm>(k: K, v: ExtForm[K]) => setF((c) => ({ ...c, [k]: v }));

  function save() {
    if (!f.title) {
      toast("Finding title required");
      return;
    }
    const data = {
      source: f.source,
      sourceRef: f.sourceRef,
      year: f.year,
      ref: f.ref,
      theme: f.theme,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
      risk: f.risk,
      recommendation: f.recommendation,
      owner: f.owner,
      targetDate: f.targetDate,
      status: f.status,
      isRepeat: f.isRepeat,
      repeatOf: f.repeatOf,
      verifiedBy: f.verifiedBy,
      closureEvidence: f.closureEvidence,
    };
    mutate((d) => {
      const F = ensureExtList(d);
      let o = findingId ? F.find((x) => x.id === findingId) : undefined;
      if (o) Object.assign(o, data);
      else {
        o = { id: uid(), ...data, createdAt: new Date().toISOString() };
        F.push(o);
      }
      o.closedDateISO = f.status === "Closed" ? f.closedDateISO || o.closedDateISO || isoNow() : "";
    });
    modal.close();
  }

  return (
    <ModalFrame
      title={findingId ? "Edit external finding" : "Add external finding"}
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
          <label>Source (external body)</label>
          <select value={f.source} onChange={(e) => set("source", e.target.value)}>
            {EXT_SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Source report / ref</label>
          <input
            value={f.sourceRef}
            onChange={(e) => set("sourceRef", e.target.value)}
            placeholder="e.g. 2024 Statutory Mgmt Letter"
          />
        </div>
        <div>
          <label>Year</label>
          <input value={f.year} onChange={(e) => set("year", e.target.value)} />
        </div>
      </div>
      <div className="f3">
        <div>
          <label>
            Finding ref <span className="hint">(auto)</span>
          </label>
          <input value={f.ref} readOnly style={{ background: "var(--bg)" }} />
        </div>
        <div>
          <label>
            Theme <span className="hint">(pick or type)</span>
          </label>
          <input
            list="extThemeListEdit"
            value={f.theme}
            onChange={(e) => set("theme", e.target.value)}
            autoComplete="off"
          />
          <datalist id="extThemeListEdit">
            {EXT_THEMES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label>Severity</label>
          <select value={f.severity} onChange={(e) => set("severity", e.target.value)}>
            {EXT_SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <label>Finding / observation *</label>
      <input value={f.title} onChange={(e) => set("title", e.target.value)} />
      <label>Detail</label>
      <textarea value={f.detail} onChange={(e) => set("detail", e.target.value)} />
      <label>Risk / impact</label>
      <textarea value={f.risk} onChange={(e) => set("risk", e.target.value)} />
      <label>Recommendation</label>
      <textarea value={f.recommendation} onChange={(e) => set("recommendation", e.target.value)} />
      <div className="f3">
        <div>
          <label>Owner</label>
          <input value={f.owner} onChange={(e) => set("owner", e.target.value)} />
        </div>
        <div>
          <label>Target date</label>
          <input
            value={f.targetDate}
            onChange={(e) => set("targetDate", e.target.value)}
            placeholder="e.g. 30 Sep 2026"
          />
        </div>
        <div>
          <label>Status</label>
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="f2" style={{ marginTop: 4 }}>
        <div>
          <label>Repeat finding?</label>
          <label
            style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400, marginTop: 4 }}
          >
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={f.isRepeat}
              onChange={(e) => set("isRepeat", e.target.checked)}
            />{" "}
            Raised in a prior external audit
          </label>
        </div>
        <div>
          <label>Repeat of (prior audit / year)</label>
          <input value={f.repeatOf} onChange={(e) => set("repeatOf", e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
        <div className="ttl">Closure verification (when Closed)</div>
      </div>
      <div className="f3">
        <div>
          <label>Verified by</label>
          <input value={f.verifiedBy} onChange={(e) => set("verifiedBy", e.target.value)} />
        </div>
        <div>
          <label>Evidence / ref</label>
          <input
            value={f.closureEvidence}
            onChange={(e) => set("closureEvidence", e.target.value)}
          />
        </div>
        <div>
          <label>Closed date</label>
          <input
            type="date"
            value={f.closedDateISO}
            onChange={(e) => set("closedDateISO", e.target.value)}
          />
        </div>
      </div>
    </ModalFrame>
  );
}

/* ---------------- add finding wizard (details → assign owner) ---------------- */

type RaiseForm = {
  source: string;
  sourceRef: string;
  year: string;
  theme: string;
  severity: string;
  title: string;
  detail: string;
  risk: string;
  recommendation: string;
  ownerUserId: string;
  secondaryOwnerUserId: string;
  dueDate: string;
};

export function ExtRaiseDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const [step, setStep] = useState<1 | 2>(1);
  const [err, setErr] = useState("");
  const [f, setF] = useState<RaiseForm>({
    source: "Statutory / External Audit",
    sourceRef: "",
    year: String(new Date().getFullYear()),
    theme: EXT_THEMES[0],
    severity: "Medium",
    title: "",
    detail: "",
    risk: "",
    recommendation: "",
    ownerUserId: "",
    secondaryOwnerUserId: "",
    dueDate: "",
  });
  const set = <K extends keyof RaiseForm>(k: K, v: RaiseForm[K]) =>
    setF((c) => ({ ...c, [k]: v }));

  const haveOwners = departments(db).filter((d) => d.headUserId).length > 0;

  function next() {
    if (!f.title.trim()) {
      setErr("A finding title is required.");
      return;
    }
    setErr("");
    setStep(2);
  }

  function save() {
    /* Same rule as raising an observation: a finding with no action owner has nobody accountable
       for remediating it, so it can never be marked Ready for Closure and sits in the register
       forever. The label has always carried the required marker — the guard was missing. */
    if (!f.ownerUserId) {
      setErr(
        haveOwners
          ? "Assign a primary action owner — a finding cannot be raised without someone accountable for remediating it."
          : "No department heads exist yet. Add a department with a head in Settings, then add this finding.",
      );
      return;
    }
    setErr("");
    // Read everything needed from state up front — the mutate callback must not await.
    mutate((d) => {
      const dept = departments(d).find((x) => x.headUserId === f.ownerUserId);
      const theme =
        EXT_THEMES.find((t) => t.toLowerCase() === String(f.theme || "").toLowerCase()) ||
        f.theme ||
        "Other";
      const finding: ExtFinding = {
        id: uid(),
        ref: extNextRef(d),
        isExternal: true,
        source: f.source,
        sourceRef: f.sourceRef,
        year: f.year,
        theme,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        risk: f.risk,
        recommendation: f.recommendation,
        owner: dept ? dept.headName : "",
        ownerUserId: f.ownerUserId || "",
        secondaryOwnerUserId:
          f.secondaryOwnerUserId && f.secondaryOwnerUserId !== f.ownerUserId
            ? f.secondaryOwnerUserId
            : "",
        departmentId: dept ? dept.id : "",
        dueDate: f.dueDate || "",
        targetDate: f.dueDate || "",
        status: "Open",
        updates: [],
        raisedBy: user.id || "",
        raisedByName: user.name || "",
        raisedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      const dept2 = departments(d).find((x) => x.headUserId === finding.secondaryOwnerUserId);
      finding.secondaryOwner = dept2 ? dept2.headName : "";
      ensureExtList(d).push(finding);
      notifyOwnerAssigned(d, finding as unknown as Observation);
      // The rest of the department can see and answer it too — tell them (bell only).
      notifyDeptOfObs(
        d,
        finding as unknown as Observation,
        "assigned",
        "Raised against your department: " + finding.title,
        "myext",
      );
      modal.closeAll();
      modal.success(
        finding.ownerUserId
          ? "External finding added. The action owner has been notified."
          : "External finding added to the register.",
      );
      logAudit("ext.raised", "Added external finding: " + finding.title, {
        findingId: finding.id,
      });
    });
  }

  if (step === 1) {
    return (
      <ModalFrame
        title="Add external finding — details"
        footer={
          <>
            <button className="btn sec" type="button" onClick={modal.close}>
              Cancel
            </button>
            <button className="btn" type="button" onClick={next}>
              Next: assign owner →
            </button>
          </>
        }
      >
        <div className="f3">
          <div>
            <label>Source (external body)</label>
            <select value={f.source} onChange={(e) => set("source", e.target.value)}>
              {EXT_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Source report / ref</label>
            <input
              value={f.sourceRef}
              onChange={(e) => set("sourceRef", e.target.value)}
              placeholder="e.g. 2024 Statutory Mgmt Letter"
            />
          </div>
          <div>
            <label>Year</label>
            <input value={f.year} onChange={(e) => set("year", e.target.value)} />
          </div>
        </div>
        <div className="f2">
          <div>
            <label>
              Theme <span className="hint">(pick one or type your own)</span>
            </label>
            <input
              list="extThemeList"
              value={f.theme}
              onChange={(e) => set("theme", e.target.value)}
              autoComplete="off"
            />
            <datalist id="extThemeList">
              {EXT_THEMES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label>Severity</label>
            <select value={f.severity} onChange={(e) => set("severity", e.target.value)}>
              {EXT_SEVERITIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <label>Finding / observation *</label>
        <input value={f.title} onChange={(e) => set("title", e.target.value)} />
        <label>Detail</label>
        <textarea value={f.detail} onChange={(e) => set("detail", e.target.value)} />
        <label>Risk / impact</label>
        <textarea value={f.risk} onChange={(e) => set("risk", e.target.value)} />
        <label>Recommendation</label>
        <textarea
          value={f.recommendation}
          onChange={(e) => set("recommendation", e.target.value)}
        />
        <div className="hint" style={{ marginTop: 8 }}>
          A finding reference is assigned automatically.
        </div>
        {err ? (
          <div style={{ marginTop: 8 }}>
            <div className="ai-err">{err}</div>
          </div>
        ) : null}
      </ModalFrame>
    );
  }

  return (
    <ModalFrame
      title="Add external finding — assign owner"
      footer={
        <>
          <button
            className="btn sec"
            type="button"
            onClick={() => {
              setErr("");
              setStep(1);
            }}
          >
            ← Back
          </button>
          <button className="btn" type="button" onClick={save}>
            Add &amp; notify owner
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>{f.title}</b> ·{" "}
        <span className="pill" style={{ background: "#eef2ff", color: "#4b3fa0" }}>
          {f.severity}
        </span>
      </div>
      <label>Primary action owner (responds &amp; closes) *</label>
      <OwnerSelect
        db={db}
        value={f.ownerUserId}
        placeholder="— select primary owner —"
        onChange={(v) => set("ownerUserId", v)}
      />
      {haveOwners ? null : (
        <div className="hint" style={{ color: "var(--crit)", marginTop: 4 }}>
          No department heads exist yet — add a department with a head in Settings to assign an
          owner. A finding cannot be raised without one.
        </div>
      )}
      <label style={{ marginTop: 8 }}>
        Secondary action owner <span className="hint">(oversight only — optional)</span>
      </label>
      <OwnerSelect
        db={db}
        value={f.secondaryOwnerUserId}
        placeholder="— none —"
        onChange={(v) => set("secondaryOwnerUserId", v)}
      />
      <label style={{ marginTop: 8 }}>Closure date</label>
      <input type="date" value={f.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
      <div className="hint" style={{ marginTop: 10 }}>
        The finding is added to the External Findings register and the action owner is notified. It
        follows the same respond → verify → close flow as observations, but is tracked only on this
        page (not the Remediation Tracker).
      </div>
      {err ? (
        <div style={{ marginTop: 8 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- assign / reassign owner (extAssignOwner / saveExtAssign) ---------------- */

export function ExtAssignDialog({ findingId }: { findingId: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const user = useUser();
  const o = (db.extFindings || []).find((x) => x.id === findingId);
  const [ownerUserId, setOwnerUserId] = useState(o?.ownerUserId || "");
  const [owner2UserId, setOwner2UserId] = useState(o?.secondaryOwnerUserId || "");
  const [due, setDue] = useState(o?.dueDate || "");
  if (!o) return null;

  function save() {
    mutate((d) => {
      const f = (d.extFindings || []).find((x) => x.id === findingId);
      if (!f) return;
      const dept = departments(d).find((x) => x.headUserId === ownerUserId);
      const prevOwner = f.ownerUserId;
      const prevSec = f.secondaryOwnerUserId;
      f.ownerUserId = ownerUserId || "";
      f.owner = dept ? dept.headName : "";
      f.departmentId = dept ? dept.id : "";
      f.secondaryOwnerUserId = owner2UserId && owner2UserId !== ownerUserId ? owner2UserId : "";
      const dept2 = departments(d).find((x) => x.headUserId === f.secondaryOwnerUserId);
      f.secondaryOwner = dept2 ? dept2.headName : "";
      if (due) {
        f.dueDate = due;
        f.targetDate = due;
      }
      f.updates = f.updates || [];
      if (!f.raisedBy) {
        f.raisedBy = user.id || "";
        f.raisedByName = user.name || "";
      }
      if (!f.raisedAt) f.raisedAt = new Date().toISOString();
      if (f.ownerUserId && f.ownerUserId !== prevOwner) {
        notifyBoth(
          d,
          f.ownerUserId,
          "assigned",
          "New finding assigned to you: " + f.title,
          "myobs",
          "AuditLens — a finding was assigned to your department",
          `An external finding "${f.title}" has been assigned to your department. Sign in to AuditLens to respond and close.`,
          f.id,
        );
      }
      if (f.secondaryOwnerUserId && f.secondaryOwnerUserId !== prevSec) {
        notifyBoth(
          d,
          f.secondaryOwnerUserId,
          "assigned",
          "You have oversight on: " + f.title,
          "myobs",
          "AuditLens — finding oversight",
          `You have oversight of the external finding "${f.title}".`,
          f.id,
        );
      }
      logAudit("ext.assigned", "Assigned owner for finding: " + f.title, { findingId });
      modal.closeAll();
      modal.success(
        f.ownerUserId ? "Owner assigned. The action owner has been notified." : "Owner cleared.",
      );
    });
  }

  return (
    <ModalFrame
      title="Assign action owner"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={save}>
            Save &amp; notify
          </button>
        </>
      }
    >
      <div className="note" style={{ marginBottom: 10 }}>
        <b>{o.title}</b>
      </div>
      <label>Primary action owner (responds &amp; closes)</label>
      <OwnerSelect
        db={db}
        value={ownerUserId}
        placeholder="— select primary owner —"
        onChange={setOwnerUserId}
      />
      <label style={{ marginTop: 8 }}>
        Secondary action owner <span className="hint">(oversight — optional)</span>
      </label>
      <OwnerSelect db={db} value={owner2UserId} placeholder="— none —" onChange={setOwner2UserId} />
      <label style={{ marginTop: 8 }}>Closure date</label>
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
    </ModalFrame>
  );
}

/* ---------------- import CSV (modalExtImport / doImportExtCSV) ---------------- */

export function ExtImportDialog() {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const [fileName, setFileName] = useState("No file chosen");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    const file = files && files[0];
    if (!file) return;
    setFileName(file.name);
    setErr("");
    // QA-2 — see lib/client/csv-encoding.ts. readAsText() assumed UTF-8 and silently replaced
    // anything else with U+FFFD, writing corruption straight into the findings register.
    let text: string;
    let encoding: string;
    try {
      ({ text, encoding } = await readTextFile(file));
    } catch {
      setErr("Could not read that file.");
      return;
    }
    const bad = countReplacementChars(text);
    if (bad) {
      setErr(
        `Read as ${encoding}, but the file already contains ${bad} unreadable character${bad === 1 ? "" : "s"}. ` +
          "Re-export it as UTF-8 CSV before importing.",
      );
      return;
    }
    const res = extFindingsFromCsv(text);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    mutate((d) => {
      ensureExtList(d).push(...res.findings);
    });
    modal.close();
    toast(res.findings.length + " external finding(s) imported.", "success");
  }

  return (
    <ModalFrame
      title="Import external findings"
      footer={
        <button className="btn sec" type="button" onClick={modal.close}>
          Close
        </button>
      }
    >
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Upload a CSV of external / regulatory findings — each row is imported and analysed into a
        finding in the register. Use the template to get the columns right.
      </p>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn dark sm" style={{ display: "inline-block", margin: 0 }}>
          ⤒ Import CSV file
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files)}
          />
        </label>
        <button className="btn sec sm" type="button" onClick={downloadExtTemplate}>
          ⤓ Download CSV template
        </button>
        <span className="hint">{fileName}</span>
      </div>
      {err ? (
        <div style={{ color: "var(--crit)", fontSize: 12.5, marginTop: 12 }}>{err}</div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- insight commentary (modalExtCommentary) ---------------- */

export function ExtCommentaryDialog() {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const [text, setText] = useState(() => db.extCommentary || "");
  const [err, setErr] = useState("");

  async function generate() {
    setErr("");
    // Build the prompt from the live db at click time (never across the await).
    const prompt = buildExtInsightPrompt(db);
    try {
      const out = await runAiText(prompt);
      setText(out.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI request failed.");
    }
  }

  return (
    <ModalFrame
      title="External findings — insight commentary"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn sec ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate
          </BusyButton>
          <button
            className="btn"
            type="button"
            onClick={() => {
              mutate((d) => {
                d.extCommentary = text.trim();
              });
              modal.close();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <textarea
        style={{ minHeight: 150 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {err ? (
        <div style={{ marginTop: 10 }}>
          <div className="ai-err">{err}</div>
        </div>
      ) : null}
    </ModalFrame>
  );
}
