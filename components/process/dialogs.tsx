"use client";

// Dialogs for the process & control effectiveness review — ports of modalProcNew/
// handleProcSopUpload/generateProcReview/doImportProc, modalProcMeta/saveProcMeta/delProc,
// modalProcFinding/saveProcFinding, raiseProcFinding/doRaiseProcFinding,
// modalProposeProcess/generateProposedProcess/doImportProposed and modalProcStep/saveProcStep/
// moveProcStep in audit-bot.js.

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { parseAiJson, withAiBusy } from "@/lib/client/ai";
import { logAudit } from "@/lib/client/audit-log";
import { isLegacyPath, urlForView } from "@/lib/routes";
import {
  DEPARTMENTS,
  ensureProcList,
  mapProcAnalysis,
  PROC_CATS,
  PROC_RATINGS,
  PROC_SEV,
  PROC_STEP_TYPES,
  procList,
  type RawProcAnalysis,
} from "@/lib/workspace/process";
import { uid } from "@/lib/workspace/selectors";
import type { ProcessReview } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

/* ---------------- new process review (SOP upload + AI analysis) ---------------- */

type SopUpload = { name: string; file: File };

export function ProcNewDialog() {
  const { mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const [unit, setUnit] = useState("");
  const [sop, setSop] = useState("");
  const [period, setPeriod] = useState("");
  const [upload, setUpload] = useState<SopUpload | null>(null);
  const [err, setErr] = useState("");

  // Legacy handleProcSopUpload — PDF-only, 12 MB cap, SOP title auto-filled from the file name.
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    const name = f.name.toLowerCase();
    if (!name.endsWith(".pdf")) {
      setUpload(null);
      setErr("Upload a PDF file.");
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      setUpload(null);
      setErr("PDF is too large. Maximum size is 12 MB.");
      return;
    }
    setUpload({ name: f.name, file: f });
    setErr("");
    if (!sop.trim()) setSop(String(f.name).replace(/\.pdf$/i, ""));
  }

  // Legacy generateProcReview + doImportProc: analyse the PDF, then create the review with
  // the EXACT legacy field names (sopPdfBase64 included) and open it.
  async function generate() {
    const unitVal = unit.trim();
    if (!unitVal) {
      setErr("Enter the business unit.");
      return;
    }
    if (!upload) {
      setErr("Upload a PDF SOP first.");
      return;
    }
    setErr("");
    const sopTitle = sop.trim() || upload.name.replace(/\.pdf$/i, "");
    const periodVal = period.trim();
    try {
      const p = await withAiBusy(async () => {
        const fd = new FormData();
        fd.append("file", upload.file);
        fd.append("unit", unitVal);
        fd.append("sopTitle", sopTitle);
        fd.append("period", periodVal);
        const res = await fetch("/api/process/analyse", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          analysis?: unknown;
          sopPdfBase64?: string;
        };
        if (!res.ok) throw new Error(data.error || "Analysis failed.");
        const raw = data.analysis;
        if (raw == null) throw new Error("Nothing to import.");
        const d =
          typeof raw === "string" ? parseAiJson<RawProcAnalysis>(raw) : (raw as RawProcAnalysis);
        const mapped = mapProcAnalysis(d);
        const review: ProcessReview = {
          id: uid(),
          unit: unitVal,
          sopTitle,
          sopFileName: upload.name,
          sopPdfBase64: data.sopPdfBase64 || "",
          period: periodVal,
          overallRating: mapped.rating,
          summary: mapped.summary,
          findings: mapped.findings,
          keyRecommendations: mapped.keyRecommendations,
          createdAt: new Date().toISOString(),
        };
        return review;
      });
      mutate((d) => ensureProcList(d).push(p));
      modal.close();
      router.push(urlForView("process", { proc: p.id }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    }
  }

  return (
    <ModalFrame
      title="New process review"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate analysis
          </BusyButton>
        </>
      }
    >
      <div className="f3">
        <div>
          <label>Department / business unit *</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">— select department —</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>SOP title</label>
          <input
            value={sop}
            onChange={(e) => setSop(e.target.value)}
            placeholder="Auto-filled from file name"
          />
        </div>
        <div>
          <label>Period / version</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. 2026" />
        </div>
      </div>
      <label>SOP document (PDF) *</label>
      <div className="proc-upload-row">
        <label className="btn sec proc-upload-btn">
          Upload PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
            onChange={onFile}
          />
        </label>
      </div>
      <div>
        {upload ? (
          <div className="note">
            Ready: <b>{upload.name}</b> · {Math.round(upload.file.size / 1024)} KB — Gemini will
            read the PDF directly
          </div>
        ) : (
          <div className="hint">Upload the SOP as a PDF for AI analysis.</div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>{err ? <div className="ai-err">{err}</div> : null}</div>
    </ModalFrame>
  );
}

/* ---------------- edit review details / delete review ---------------- */

export function ProcMetaDialog({ id }: { id: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const p = procList(db).find((x) => x.id === id);
  const [f, setF] = useState(() => ({
    unit: p?.unit || "",
    sop: p?.sopTitle || "",
    period: p?.period || "",
    rating: p?.overallRating || "",
    sum: p?.summary || "",
    recs: (p?.keyRecommendations || []).join("\n"),
  }));
  if (!p) return null;

  function save() {
    mutate((d) => {
      const cur = procList(d).find((x) => x.id === id);
      if (!cur) return;
      cur.unit = f.unit.trim();
      cur.sopTitle = f.sop.trim();
      cur.period = f.period.trim();
      cur.overallRating = f.rating;
      cur.summary = f.sum.trim();
      cur.keyRecommendations = f.recs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    });
    modal.close();
  }

  // Legacy delProc — the audit-log label reads p.name||p.title verbatim (blank for reviews).
  async function delReview() {
    const label = String((p!.name as string) || (p!.title as string) || "");
    const ok = await modal.confirm({
      message: "Delete this process review?",
      danger: true,
      confirmLabel: "Delete",
      busyLabel: "Deleting…",
      onConfirm: () => {
        mutate((d) => {
          d.processReviews = procList(d).filter((x) => x.id !== id);
        });
        logAudit("process.review_deleted", "Deleted process review: " + label, {
          processReviewId: id,
        });
      },
    });
    if (ok) {
      modal.closeAll();
      router.replace(urlForView("process"));
    }
  }

  return (
    <ModalFrame
      title="Edit review details"
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
          <label>Business unit</label>
          <input value={f.unit} onChange={(e) => setF((c) => ({ ...c, unit: e.target.value }))} />
        </div>
        <div>
          <label>SOP title</label>
          <input value={f.sop} onChange={(e) => setF((c) => ({ ...c, sop: e.target.value }))} />
        </div>
        <div>
          <label>Period / version</label>
          <input
            value={f.period}
            onChange={(e) => setF((c) => ({ ...c, period: e.target.value }))}
          />
        </div>
      </div>
      <label>Overall effectiveness rating</label>
      <select value={f.rating} onChange={(e) => setF((c) => ({ ...c, rating: e.target.value }))}>
        <option value="">—</option>
        {PROC_RATINGS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <label>Summary</label>
      <textarea
        style={{ minHeight: 100 }}
        value={f.sum}
        onChange={(e) => setF((c) => ({ ...c, sum: e.target.value }))}
      />
      <label>Key recommendations (one per line)</label>
      <textarea value={f.recs} onChange={(e) => setF((c) => ({ ...c, recs: e.target.value }))} />
      <div style={{ marginTop: 12 }}>
        <button className="btn danger sm" type="button" onClick={() => void delReview()}>
          Delete review
        </button>
      </div>
    </ModalFrame>
  );
}

/* ---------------- add / edit finding ---------------- */

export function ProcFindingDialog({ pid, fid }: { pid: string; fid?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const p = procList(db).find((x) => x.id === pid);
  const existing = fid ? (p?.findings || []).find((y) => y.id === fid) : undefined;
  const [f, setF] = useState(() => ({
    category: existing?.category || "Control gap",
    severity: existing?.severity || "Medium",
    title: existing?.title || "",
    detail: existing?.detail || "",
    recommendation: existing?.recommendation || "",
  }));
  if (!p) return null;

  function save() {
    const title = f.title.trim();
    if (!title) {
      toast("Title required");
      return;
    }
    const data = {
      category: f.category,
      severity: f.severity,
      title,
      detail: f.detail.trim(),
      recommendation: f.recommendation.trim(),
    };
    mutate((d) => {
      const cur = procList(d).find((x) => x.id === pid);
      if (!cur) return;
      cur.findings = cur.findings || [];
      if (fid) {
        const y = cur.findings.find((z) => z.id === fid);
        if (y) Object.assign(y, data);
      } else {
        cur.findings.push({ id: uid(), ...data });
      }
    });
    modal.close();
  }

  return (
    <ModalFrame
      title={fid ? "Edit finding" : "Add finding"}
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
      <div className="f2">
        <div>
          <label>Category</label>
          <select
            value={f.category}
            onChange={(e) => setF((c) => ({ ...c, category: e.target.value }))}
          >
            {PROC_CATS.map(([c]) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Severity</label>
          <select
            value={f.severity}
            onChange={(e) => setF((c) => ({ ...c, severity: e.target.value }))}
          >
            {PROC_SEV.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <label>Title *</label>
      <input value={f.title} onChange={(e) => setF((c) => ({ ...c, title: e.target.value }))} />
      <label>Detail</label>
      <textarea value={f.detail} onChange={(e) => setF((c) => ({ ...c, detail: e.target.value }))} />
      <label>Recommendation</label>
      <textarea
        value={f.recommendation}
        onChange={(e) => setF((c) => ({ ...c, recommendation: e.target.value }))}
      />
    </ModalFrame>
  );
}

/* ---------------- raise a finding into a report as an observation ---------------- */

export function RaiseProcFindingDialog({ pid, fid }: { pid: string; fid: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const router = useRouter();
  const p = procList(db).find((x) => x.id === pid);
  const x = (p?.findings || []).find((y) => y.id === fid);
  const reports: { auditId: string; auditName: string; reportId: string; title: string }[] = [];
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) =>
      reports.push({ auditId: a.id, auditName: a.name, reportId: r.id, title: r.title }),
    ),
  );
  const [rid, setRid] = useState(reports[0]?.reportId || "");
  if (!p || !x) return null;

  if (!reports.length) {
    return (
      <ModalFrame
        title="No report available"
        footer={
          <button className="btn sec" type="button" onClick={modal.close}>
            Close
          </button>
        }
      >
        <p>
          Create an audit and report first (Audits &amp; Reports), then raise this finding into it.
        </p>
      </ModalFrame>
    );
  }

  // Legacy doRaiseProcFinding — pushes an observation with the exact legacy field set, tags the
  // report kind, then navigates to the (legacy-shell) report view.
  function doRaise() {
    let auditId = "";
    let reportId = "";
    mutate((d) => {
      const cur = procList(d).find((r) => r.id === pid);
      const cf = (cur?.findings || []).find((y) => y.id === fid);
      if (!cf) return;
      for (const a of d.audits || [])
        for (const r of a.reports || []) {
          if (r.id !== rid) continue;
          if (!r.kind) r.kind = "Process review report";
          const crit =
            ({ High: "High", Medium: "Moderate", Low: "Low" } as Record<string, string>)[
              cf.severity || ""
            ] || "Moderate";
          r.observations.push({
            id: uid(),
            ref: "",
            title: cf.title,
            category: cf.category,
            description: cf.detail,
            criteria: "",
            risk: "",
            rootCause: "",
            recommendation: cf.recommendation,
            sopUpdate: "",
            criticality: crit as "High" | "Moderate" | "Low",
            managementResponse: "",
            owner: "",
            timeline: "",
            dueDate: "",
            isRepeat: false,
            repeatOf: "",
            status: "Open",
            createdAt: new Date().toISOString(),
          });
          auditId = a.id;
          reportId = r.id;
        }
    });
    if (!reportId) return;
    modal.close();
    const href = urlForView("report", { audit: auditId, report: reportId });
    if (isLegacyPath(href)) window.location.assign(href);
    else router.push(href);
  }

  return (
    <ModalFrame
      title="Raise finding as observation"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn dark" type="button" onClick={doRaise}>
            Add to report
          </button>
        </>
      }
    >
      <div className="note">
        <b>{x.title}</b> · {x.category}
        {x.severity ? " · " + x.severity : ""}
      </div>
      <label>Target report</label>
      <select value={rid} onChange={(e) => setRid(e.target.value)}>
        {reports.map((r) => (
          <option key={r.reportId} value={r.reportId}>
            {r.auditName} → {r.title}
          </option>
        ))}
      </select>
    </ModalFrame>
  );
}

/* ---------------- AI: propose the updated process ---------------- */

type RawProposed = {
  proposedSummary?: string;
  summary?: string;
  steps?: { actor?: string; action?: string; type?: string; note?: string }[];
};

export function ProposeProcessDialog({ pid }: { pid: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const p = procList(db).find((x) => x.id === pid);
  const [err, setErr] = useState("");
  if (!p) return null;

  // Legacy generateProcessProposal note: the stored SOP PDF (sopPdfBase64) grounds the redesign.
  const sopNote = p.sopFileName ? (
    <div className="note" style={{ marginBottom: 8 }}>
      {p.sopPdfBase64 ? (
        <>
          Original SOP PDF on file: <b>{p.sopFileName}</b> — Gemini will use it for context.
        </>
      ) : (
        <>
          Original SOP: <b>{p.sopFileName}</b> (PDF not stored — redesign uses findings only).
        </>
      )}
    </div>
  ) : (
    <div className="hint" style={{ marginBottom: 8 }}>
      No uploaded SOP on file — the redesign will use findings only.
    </div>
  );

  // Legacy generateProposedProcess + doImportProposed.
  async function generate() {
    if (!p) return;
    setErr("");
    const findingsList =
      (p.findings || [])
        .map((x) => `- [${x.category}] ${x.title}: ${x.recommendation || x.detail}`)
        .join("\n") || "(no findings captured)";
    const fd = new FormData();
    fd.append("unit", p.unit || "");
    fd.append("sopTitle", p.sopTitle || "");
    fd.append("findings", findingsList);
    if (p.sopPdfBase64) fd.append("pdfBase64", p.sopPdfBase64);
    try {
      const parsed = await withAiBusy(async () => {
        const res = await fetch("/api/process/propose", { method: "POST", body: fd });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          analysis?: unknown;
        };
        if (!res.ok) throw new Error(data.error || "Could not generate process.");
        const raw = data.analysis;
        if (raw == null) throw new Error("Nothing to import.");
        return typeof raw === "string" ? parseAiJson<RawProposed>(raw) : (raw as RawProposed);
      });
      mutate((d) => {
        const cur = procList(d).find((x) => x.id === pid);
        if (!cur) return;
        cur.proposedSummary = parsed.proposedSummary || parsed.summary || "";
        cur.proposedSteps = (Array.isArray(parsed.steps) ? parsed.steps : []).map((s) => ({
          id: uid(),
          actor: s.actor || "",
          action: s.action || "",
          type: PROC_STEP_TYPES.includes(String(s.type || "").toLowerCase())
            ? String(s.type).toLowerCase()
            : "step",
          note: s.note || "",
        }));
      });
      modal.close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate process.");
    }
  }

  return (
    <ModalFrame
      title="Generate proposed updated process"
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn dark ai-generate-btn" busyLabel="Generating…" onClick={generate}>
            Generate process
          </BusyButton>
        </>
      }
    >
      {sopNote}
      <div style={{ marginTop: 10 }}>{err ? <div className="ai-err">{err}</div> : null}</div>
    </ModalFrame>
  );
}

/* ---------------- add / edit / reorder a proposed step ---------------- */

export function ProcStepDialog({ pid, sid }: { pid: string; sid?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const p = procList(db).find((x) => x.id === pid);
  const existing = sid ? (p?.proposedSteps || []).find((y) => y.id === sid) : undefined;
  const [f, setF] = useState(() => ({
    actor: existing?.actor || "",
    type: existing?.type || "step",
    action: existing?.action || "",
    note: existing?.note || "",
  }));
  if (!p) return null;

  function save() {
    const action = f.action.trim();
    if (!action) {
      toast("Action required");
      return;
    }
    const data = { actor: f.actor.trim(), type: f.type, action, note: f.note.trim() };
    mutate((d) => {
      const cur = procList(d).find((x) => x.id === pid);
      if (!cur) return;
      cur.proposedSteps = cur.proposedSteps || [];
      if (sid) {
        const y = cur.proposedSteps.find((z) => z.id === sid);
        if (y) Object.assign(y, data);
      } else {
        cur.proposedSteps.push({ id: uid(), ...data });
      }
    });
    modal.close();
  }

  // Legacy moveProcStep — swap with the neighbour; the dialog stays open (legacy reopened it).
  function move(dir: number) {
    mutate((d) => {
      const cur = procList(d).find((x) => x.id === pid);
      if (!cur) return;
      const a = cur.proposedSteps || [];
      const i = a.findIndex((y) => y.id === sid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return;
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    });
  }

  return (
    <ModalFrame
      title={sid ? "Edit step" : "Add step"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          {sid ? (
            <>
              <button className="btn sec" type="button" onClick={() => move(-1)}>
                ↑
              </button>
              <button className="btn sec" type="button" onClick={() => move(1)}>
                ↓
              </button>
            </>
          ) : null}
          <button className="btn" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Actor / role</label>
          <input value={f.actor} onChange={(e) => setF((c) => ({ ...c, actor: e.target.value }))} />
        </div>
        <div>
          <label>Type</label>
          <select value={f.type} onChange={(e) => setF((c) => ({ ...c, type: e.target.value }))}>
            {PROC_STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label>Action *</label>
      <textarea
        value={f.action}
        onChange={(e) => setF((c) => ({ ...c, action: e.target.value }))}
      />
      <label>
        Note <span className="hint">(decision branch / control purpose)</span>
      </label>
      <input value={f.note} onChange={(e) => setF((c) => ({ ...c, note: e.target.value }))} />
    </ModalFrame>
  );
}
