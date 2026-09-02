import { NextResponse } from "next/server";
import type {
  BriefExtDetail,
  BriefFraudDetail,
  BriefIssueDetail,
  BriefThreadEntry,
} from "@/lib/brief-detail-map";
import { hydrateBriefDetailItem } from "@/lib/brief-hydrate";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_ID = "default";

type BriefView = "issue" | "repeat" | "fraud" | "external" | "theme";

type Snapshot = {
  org?: string;
  period?: string;
  generatedAt?: string;
  headline?: string;
  commentary?: string;
  remRate?: number;
  closed?: number;
  total?: number;
  kpis?: { keyOpen: number; keyOverdue: number; overdue: number; unmit: number; extOpen: number; extOverdueN: number; watch?: number };
  matters?: string[];
  keyIssues?: BriefIssueDetail[];
  themes?: Array<[string, number]>;
  fraud?: BriefFraudDetail[];
  ext?: BriefExtDetail[];
  repeats?: BriefIssueDetail[];
};

function esc(v: unknown) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br>");
}

function critColor(c: string) {
  const map: Record<string, string> = {
    Critical: "#7a0012",
    High: "#b00020",
    Moderate: "#e8590c",
    Low: "#2e7d32",
    "Process Improvement": "#2c5f8a",
  };
  return map[c] || "#64748b";
}

function bandColor(b: string) {
  const map: Record<string, string> = { Low: "#2e7d32", Medium: "#c9a300", High: "#e8590c", Extreme: "#b00020" };
  return map[b] || "#64748b";
}

function statusPill(s: string) {
  const k = s || "Open";
  const fg = k === "Closed" ? "#2e7d32" : k === "In Progress" ? "#a67c00" : "#3a5a52";
  const bg = k === "Closed" ? "#e8f3ea" : k === "In Progress" ? "#fbf3dd" : "#eef2f4";
  return `<span class="pill" style="background:${bg};color:${fg}">${esc(k)}</span>`;
}

function toneColors(tone: string): [string, string] {
  const map: Record<string, [string, string]> = {
    good: ["#2e7d32", "#f3faf4"],
    warn: ["#a67c00", "#fdfaf0"],
    bad: ["#b00020", "#fdf4f5"],
    neutral: ["#0d5a47", "#f2f7f5"],
  };
  return map[tone] || map.neutral;
}

const KPI_ICONS: Record<string, string> = {
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>`,
};

function matterSection(text: string): string {
  if (/fraud/i.test(text)) return "fraud";
  if (/regulatory|external/i.test(text)) return "external";
  if (/repeat finding/i.test(text)) return "repeats";
  if (/concentrating|theme|systemic/i.test(text)) return "themes";
  if (/critical|high-risk|overdue|remediation has slipped/i.test(text)) return "key-issues";
  return "matters";
}

function briefLink(token: string, view?: BriefView, index?: number) {
  const base = `/brief?id=${encodeURIComponent(token)}`;
  if (view != null && index != null) return `${base}&view=${view}&i=${index}`;
  return base;
}

function briefStyles() {
  return `
  :root{--teal:#0d5a47;--ink:#19302a;--muted:#64807a;--line:#e1eae7}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f2f7f5;color:var(--ink);margin:0;padding:24px 16px;line-height:1.55}
  .wrap{max-width:1000px;margin:0 auto}
  .hero{background:linear-gradient(135deg,#0d5a47,#12795f);color:#fff;border-radius:16px;padding:26px 30px;margin-bottom:18px}
  .hero .lbl{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#8fd3c4;font-weight:700}
  .hero h1{margin:6px 0 4px;font-size:24px;font-weight:800}
  .hero .postu{font-size:13px;color:#cfe7de}
  .hero .rate{font-size:44px;font-weight:800;line-height:1}
  .hero .msg{margin-top:16px;font-size:14.5px;line-height:1.6;background:#ffffff1a;border-radius:10px;padding:12px 14px}
  .row{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(15,40,34,.04)}
  .seclabel{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--teal);margin-bottom:12px}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;opacity:0;animation:kpiInLeft .6s cubic-bezier(.34,1.56,.64,1) both;height:100%}
  .kpi-jump{display:block;text-decoration:none;color:inherit;border-radius:12px;outline:none}
  .kpi-jump:hover .kpi,.kpi-jump:focus-visible .kpi{box-shadow:0 0 0 2px var(--teal);transform:translateY(-1px)}
  .brief-hint{font-size:12.5px;color:var(--muted);margin:0 0 14px}
  .matter-jump{color:inherit;text-decoration:none}
  .matter-jump:hover,.matter-jump:focus-visible{color:var(--teal)}
  .brief-row td{padding:0;border-bottom:1px solid var(--line)}
  .row-link{display:grid;grid-template-columns:minmax(90px,.9fr) minmax(180px,2.2fr) minmax(100px,1fr) minmax(90px,.9fr) minmax(80px,.8fr);gap:10px;align-items:start;text-decoration:none;color:inherit;padding:9px 10px;transition:background .12s}
  .brief-row:hover .row-link,.brief-row:focus-within .row-link{background:#f8fbfa}
  .row-link.cols-3{grid-template-columns:minmax(180px,2.5fr) minmax(120px,1.2fr) minmax(80px,.8fr)}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700}
  .sub{font-size:12px;color:var(--muted)}
  .theme-link{display:flex;align-items:center;gap:12px;margin:7px 0;text-decoration:none;color:inherit;padding:8px 10px;border-radius:8px;transition:background .12s}
  .theme-link:hover,.theme-link:focus-visible{background:#f8fbfa}
  .theme-link .nm{width:210px;font-size:13px}
  .theme-link .track{flex:1;height:9px;background:#eef2f7;border-radius:6px;overflow:hidden}
  .theme-link .fill{height:100%;background:var(--teal)}
  .theme-link .vv{width:28px;text-align:right;font-weight:700}
  .back{display:inline-flex;align-items:center;gap:6px;color:var(--teal);font-weight:700;font-size:13px;text-decoration:none;margin-bottom:16px}
  .back:hover,.back:focus-visible{text-decoration:underline}
  .detail-title{font-size:22px;font-weight:800;margin:0 0 14px;line-height:1.3}
  .meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px 18px;margin-bottom:18px}
  .meta-l{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:2px}
  .meta-v{font-size:13px;font-weight:600;color:var(--ink)}
  .prose{margin:0 0 14px}
  .prose-l{font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--teal);margin-bottom:6px}
  .prose-b{font-size:14px;line-height:1.65;color:var(--ink);white-space:pre-wrap}
  .sec-anchor{scroll-margin-top:20px}
  .kpi-head{display:flex;align-items:center;gap:7px;margin-bottom:9px}
  .kpi-ic{width:18px;height:18px;flex:none;display:inline-flex}
  .kpi-ic svg{width:18px;height:18px}
  @keyframes kpiInLeft{0%{opacity:0;transform:translateX(-90px) scale(.9)}60%{opacity:1}100%{opacity:1;transform:translateX(0) scale(1)}}
  .kpi:nth-child(1){animation-delay:.06s}
  .kpi:nth-child(2){animation-delay:.19s}
  .kpi:nth-child(3){animation-delay:.32s}
  .kpi:nth-child(4){animation-delay:.45s}
  .kpi:nth-child(5){animation-delay:.58s}
  @media(prefers-reduced-motion:reduce){.kpi{animation:none;opacity:1}}
  .kpi-num{font-size:26px;font-weight:800;line-height:1;color:var(--teal)}
  .kpi-lab{font-size:11.5px;font-weight:700;color:var(--ink)}
  .kpi-sub{font-size:11px;color:var(--muted);margin-top:4px}
  ol.matters{margin:0;padding-left:22px}
  ol.matters li{margin:8px 0;font-size:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:2px solid var(--line);padding:8px 10px}
  .foot{text-align:center;color:var(--muted);font-size:12px;margin:22px 0 8px}
  .over{color:#b00020;font-weight:700}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
  .tag{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#eef2f4;color:#3a5a52}
  .detail-meta{display:flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:18px;background:#fff}
  .detail-meta-item{flex:1;min-width:150px;padding:11px 14px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
  .thread-panel{margin-top:28px;padding-top:22px;border-top:2px solid var(--line)}
  .thread{margin-top:18px}
  .thread-panel .thread-label{font-size:13px;letter-spacing:.08em;margin-bottom:14px;padding-bottom:2px}
  .thread-label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--teal);margin-bottom:10px}
  .thread-entry{padding:12px 0;border-bottom:1px solid var(--line)}
  .thread-entry:last-child{border-bottom:none}
  .thread-meta{font-size:12px;color:var(--muted);margin-bottom:6px}
  .thread-text{font-size:14px;line-height:1.6;white-space:pre-wrap}
  .attach-list{margin:0;padding-left:18px;font-size:13px}
  .fraud-action{padding:12px 0;border-bottom:1px solid var(--line)}
  .fraud-action:last-child{border-bottom:none}
  .note-banner{font-size:13px;background:#fdfaf0;border-left:3px solid #a67c00;padding:10px 12px;border-radius:0 8px 8px 0;margin:0 0 14px}
  .closure-foot{font-size:12.5px;color:var(--muted);margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}
  @media(max-width:720px){
    .kpis{grid-template-columns:1fr 1fr}
    .row-link,.row-link.cols-3{grid-template-columns:1fr;gap:4px}
    .theme-link .nm{width:auto;flex:1}
  }`;
}

function proseBlock(label: string, value?: string) {
  const text = (value || "").trim();
  if (!text) return "";
  return `<div class="prose"><div class="prose-l">${esc(label)}</div><div class="prose-b">${nl2br(text)}</div></div>`;
}

function metaItem(label: string, value: string) {
  return `<div><div class="meta-l">${esc(label)}</div><div class="meta-v">${esc(value || "—")}</div></div>`;
}

function metaStrip(items: [string, string][]) {
  const cells = items
    .filter(([, v]) => (v || "").trim())
    .map(([label, value]) => `<div class="detail-meta-item"><div class="meta-l">${esc(label)}</div><div class="meta-v">${esc(value)}</div></div>`)
    .join("");
  return cells ? `<div class="detail-meta">${cells}</div>` : "";
}

function renderAttachments(files?: Array<{ name: string }>) {
  if (!files?.length) return "";
  return `<div class="prose"><div class="prose-l">Supporting documents</div><ul class="attach-list">${files.map((f) => `<li>${esc(f.name)}</li>`).join("")}</ul><div class="sub">Sign in to AuditLens to open attached files.</div></div>`;
}

function renderThread(thread?: BriefThreadEntry[]) {
  if (!thread?.length) return "";
  return `<div class="thread thread-panel"><div class="thread-label">Conversation &amp; evidence</div>${thread
    .map((e) => {
      const tag = e.tag === "closure" ? " · Closure response" : e.tag === "closure_update" ? " · Closure update" : e.kind === "progress" ? " · Progress" : "";
      return `<div class="thread-entry"><div class="thread-meta">${esc(e.byName)} · ${esc(e.role)}${tag}${e.at ? " · " + esc(e.at) : ""}</div><div class="thread-text">${nl2br(e.text)}</div>${
        e.evidence?.length ? `<ul class="attach-list">${e.evidence.map((f) => `<li>${esc(f.name)}</li>`).join("")}</ul>` : ""
      }</div>`;
    })
    .join("")}</div>`;
}

function renderIssueDetail(item: BriefIssueDetail) {
  const attachments = item.attachments || [];
  const thread = item.thread || [];
  const badges = [
    `<span class="pill" style="background:${critColor(item.criticality)}1a;color:${critColor(item.criticality)}">${esc(item.criticality)}</span>`,
    statusPill(item.status),
    item.repeat ? `<span class="pill" style="background:#efe3f7;color:#6b3fa0">↻ REPEAT</span>` : "",
    item.department ? `<span class="tag">${esc(item.department)}</span>` : "",
    item.category ? `<span class="tag">${esc(item.category)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `
    <div class="badges">${badges}</div>
    <h2 class="detail-title">${item.ref ? esc(item.ref) + " — " : ""}${esc(item.title)}</h2>
    ${metaStrip([
      ["Owner", item.owner],
      ["Co-owner", item.secondaryOwner],
      ["Timeline", item.timeline],
      ["Expected close", item.targetClose + (item.overdue ? " (OVERDUE)" : "")],
      ["Age", item.age],
      ["Created", item.createdAt],
      ["Audit", item.audit || item.area],
    ])}
    ${item.progressReport ? `<div class="note-banner">${esc(item.progressReport)}</div>` : ""}
    ${proseBlock("Detailed description", item.description)}
    ${proseBlock("Criteria / expectation", item.criteria)}
    ${proseBlock("Impact / risk", item.risk)}
    ${proseBlock("Possible root cause", item.rootCause)}
    ${proseBlock("Recommendation", item.recommendation)}
    ${proseBlock("Proposed SOP update", item.sopUpdate)}
    ${proseBlock("Management response", item.managementResponse)}
    ${item.repeat && item.repeatOf ? proseBlock("Repeat of", item.repeatOf) : ""}
    ${renderAttachments(attachments)}
    ${renderThread(thread)}
    ${item.closedFooter ? `<div class="closure-foot">✓ ${esc(item.closedFooter)}</div>` : ""}`;
}

function renderExtDetail(item: BriefExtDetail) {
  const thread = item.thread || [];
  const badges = [
    `<span class="pill" style="background:${critColor(item.severity)}1a;color:${critColor(item.severity)}">${esc(item.severity)} Severity</span>`,
    statusPill(item.status),
    `<span class="tag">External</span>`,
    item.department ? `<span class="tag">${esc(item.department)}</span>` : "",
    item.theme ? `<span class="tag">Theme: ${esc(item.theme)}</span>` : "",
    item.source ? `<span class="tag">${esc(item.source)}</span>` : "",
    item.sourceRef ? `<span class="tag">Ref: ${esc(item.sourceRef)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `
    <div class="badges">${badges}</div>
    <h2 class="detail-title">${item.ref ? esc(item.ref) + " — " : ""}${esc(item.title)}</h2>
    ${metaStrip([
      ["Action owner", item.owner],
      ["Co-owner", item.secondaryOwner],
      ["Year", item.year],
      ["Target date", item.target + (item.overdue ? " (OVERDUE)" : "")],
      ["Closed date", item.closedDate],
      ["Verified by", item.verifiedBy],
    ])}
    ${proseBlock("Detailed description", item.detail)}
    ${proseBlock("Impact / risk", item.risk)}
    ${proseBlock("Recommendation", item.recommendation)}
    ${proseBlock("Management response", item.managementResponse)}
    ${proseBlock("Closure evidence / notes", item.closureEvidence)}
    ${item.repeat && item.repeatOf ? proseBlock("Repeat of", item.repeatOf) : ""}
    ${renderThread(thread)}
    ${item.closedFooter ? `<div class="closure-foot">✓ ${esc(item.closedFooter)}</div>` : ""}`;
}

function renderFraudDetail(item: BriefFraudDetail) {
  const implN = item.actions.filter((a) => a.status === "Implemented").length;
  return `
    <div class="badges">
      <span class="pill" style="background:${bandColor(item.res)}1a;color:${bandColor(item.res)}">Residual ${esc(item.res)}</span>
      ${item.category ? `<span class="tag">${esc(item.category)}</span>` : ""}
      <span class="tag">${esc(item.status)}</span>
    </div>
    <h2 class="detail-title">${esc(item.scheme)}</h2>
    ${item.process ? `<p class="sub">${esc(item.process)}</p>` : ""}
    ${metaStrip([
      ["Category", item.category],
      ["Process / area", item.process],
      ["Year", item.year],
      ["Likelihood × Impact", `${item.likelihood} × ${item.impact} = ${item.score}`],
      ["Inherent risk", item.inh],
      ["Control strength", item.controlStrength],
      ["Residual risk", item.res],
      ["Owner", item.owner],
    ])}
    ${proseBlock("Description", item.description)}
    ${proseBlock("Existing controls", item.existingControls)}
    ${proseBlock("Prevention / response action", item.preventionAction)}
    <div class="thread"><div class="thread-label">Prevention actions${item.actions.length ? ` — ${implN}/${item.actions.length} implemented` : ""}</div>${
      item.actions.length
        ? item.actions
            .map(
              (a) =>
                `<div class="fraud-action"><div class="thread-text"><b>${esc(a.text)}</b></div><div class="thread-meta">${esc([a.type, a.status, a.owner, a.targetDate ? "target " + a.targetDate : ""].filter(Boolean).join(" · "))}</div>${a.update ? `<div class="thread-text">${nl2br(a.update)}</div>` : ""}</div>`,
            )
            .join("")
        : `<div class="sub">No prevention actions captured yet.</div>`
    }</div>`;
}

function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title><style>${briefStyles()}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function notFoundPage(message: string) {
  return pageShell(
    "Executive Assurance Brief",
    `<div class="card" style="max-width:460px;margin:40px auto;text-align:center"><div class="seclabel">Executive Assurance Brief</div><p>${esc(message)}</p></div>`,
  );
}

function briefHeader(s: Snapshot) {
  return `<div class="hero">
    <div class="row">
      <div style="flex:1">
        <div class="lbl">Internal Audit · Executive Assurance Brief</div>
        <h1>${esc(s.org)}</h1>
        <div class="postu">As at ${esc(String(s.period || "").replace(/^as at\s+/i, ""))}</div>
      </div>
      <div style="text-align:right"><a class="kpi-jump hero-rate" href="#summary" style="color:#fff;text-decoration:none"><div class="rate">${esc(s.remRate)}%</div><div style="font-size:12px;color:#cfe7de">issues remediated</div></a></div>
    </div>
    ${s.headline ? `<div class="msg">${nl2br(s.headline)}</div>` : ""}
  </div>`;
}

function renderBriefMain(s: Snapshot, token: string) {
  const k = s.kpis || { keyOpen: 0, keyOverdue: 0, overdue: 0, unmit: 0, extOpen: 0, extOverdueN: 0 };
  const kpi = (label: string, num: string | number, sub: string, tone: string, icon: string, hash: string) => {
    const [fg, bg] = toneColors(tone);
    return `<a class="kpi-jump" href="#${hash}" aria-label="View ${esc(label)}"><div class="kpi" style="background:${bg}"><div class="kpi-head"><span class="kpi-ic" style="color:${fg}">${KPI_ICONS[icon] || ""}</span><div class="kpi-lab">${esc(label)}</div></div><div class="kpi-num" style="color:${fg}">${esc(num)}</div><div class="kpi-sub">${esc(sub)}</div></div></a>`;
  };
  const maxT = Math.max(1, ...(s.themes || []).map((t) => t[1]));

  const body = `
    <p class="brief-hint">Click a table row to open its full detail page.</p>
    ${briefHeader(s)}
    ${s.commentary ? `<div class="card"><div class="seclabel">Chief Audit Executive's commentary</div><div style="font-size:13.5px">${nl2br(s.commentary)}</div></div>` : ""}
    <div class="kpis" id="summary">
      ${kpi("High Open", k.keyOpen, `${k.keyOverdue} overdue`, k.keyOpen ? "warn" : "good", "alert", "key-issues")}
      ${kpi("Remediation rate", `${s.remRate}%`, `${s.closed} of ${s.total} closed`, (s.remRate || 0) >= 70 ? "good" : (s.remRate || 0) >= 40 ? "warn" : "bad", "check", "matters")}
      ${kpi("Overdue actions", k.overdue, "past target date", k.overdue ? "bad" : "good", "clock", "key-issues")}
      ${kpi("Unmitigated fraud", k.unmit, "High/Extreme residual", k.unmit ? "bad" : "good", "shield", "fraud")}
      ${kpi("External findings", k.extOpen, `${k.extOverdueN} overdue`, k.extOpen ? "warn" : "good", "doc", "external")}
    </div>
    <div class="card sec-anchor" id="matters"><div class="seclabel">Matters requiring EXCO attention</div>
      <ol class="matters">${(s.matters || []).map((t) => `<li><a class="matter-jump" href="#${matterSection(t)}">${esc(t)}</a></li>`).join("")}</ol>
    </div>
    <div class="card sec-anchor" id="key-issues"><div class="seclabel">Critical &amp; high-risk issues requiring executive attention</div>
      ${(s.keyIssues || []).length
        ? `<table><thead><tr><th>Criticality</th><th>Issue</th><th>Owner</th><th>Target close</th><th>Status</th></tr></thead><tbody>${(s.keyIssues || [])
            .map((o, i) => {
              const href = briefLink(token, "issue", i);
              return `<tr class="brief-row"><td colspan="5"><a class="row-link" href="${href}">
        <span><span class="pill" style="background:${critColor(o.criticality)}1a;color:${critColor(o.criticality)}">${esc(o.criticality)}</span>${o.repeat ? ` <span class="pill" style="background:#efe3f7;color:#6b3fa0">repeat</span>` : ""}</span>
        <span><b>${esc(o.title)}</b><div class="sub">${esc(o.area)}</div></span>
        <span>${esc(o.owner)}</span>
        <span>${esc(o.targetClose)}${o.overdue ? ` <span class="over">overdue</span>` : ""}</span>
        <span>${statusPill(o.status)}</span>
      </a></td></tr>`;
            })
            .join("")}</tbody></table>`
        : `<div class="sub">No open Critical or High-risk issues.</div>`}
    </div>
    <div class="card sec-anchor" id="themes"><div class="seclabel">Recurring Risk Themes</div>
      ${(s.themes || []).length
        ? (s.themes || [])
            .map(
              ([t, n], i) =>
                `<a class="theme-link" href="${briefLink(token, "theme", i)}"><div class="nm">${esc(t)}</div><div class="track"><div class="fill" style="width:${(n / maxT) * 100}%"></div></div><div class="vv">${n}</div></a>`,
            )
            .join("")
        : `<div class="sub">No open issues to theme yet.</div>`}
    </div>
    <div class="card sec-anchor" id="repeats"><div class="seclabel">Repeat findings — recurring from prior audits</div>
      ${(s.repeats || []).length
        ? `<table><thead><tr><th>Observation</th><th>Audit</th><th>Status</th></tr></thead><tbody>${(s.repeats || [])
            .map((rp, i) => {
              const href = briefLink(token, "repeat", i);
              return `<tr class="brief-row"><td colspan="3"><a class="row-link cols-3" href="${href}">
        <span><b>${esc(rp.title)}</b></span><span>${esc(rp.audit)}</span><span>${statusPill(rp.status)}</span>
      </a></td></tr>`;
            })
            .join("")}</tbody></table>`
        : `<div class="sub">No repeat findings flagged.</div>`}
    </div>
    <div class="card sec-anchor" id="fraud"><div class="seclabel">Unmitigated fraud risks — High / Extreme residual</div>
      ${(s.fraud || []).length
        ? `<table><thead><tr><th>Residual</th><th>Scheme</th><th>Category</th><th>Owner</th><th>Status</th></tr></thead><tbody>${(s.fraud || [])
            .map((f, i) => {
              const href = briefLink(token, "fraud", i);
              return `<tr class="brief-row"><td colspan="5"><a class="row-link" href="${href}">
        <span><span class="pill" style="background:${bandColor(f.res)}1a;color:${bandColor(f.res)}">${esc(f.res)}</span></span>
        <span><b>${esc(f.scheme)}</b></span><span>${esc(f.category)}</span><span>${esc(f.owner)}</span><span>${statusPill(f.status)}</span>
      </a></td></tr>`;
            })
            .join("")}</tbody></table>`
        : `<div class="sub">No fraud risks at High/Extreme residual outstanding.</div>`}
    </div>
    <div class="card sec-anchor" id="external"><div class="seclabel">Regulatory &amp; external audit exposure</div>
      ${(s.ext || []).length
        ? `<table><thead><tr><th>Source</th><th>Finding</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>${(s.ext || [])
            .map((f, i) => {
              const href = briefLink(token, "external", i);
              return `<tr class="brief-row"><td colspan="5"><a class="row-link" href="${href}">
        <span>${esc(f.source)}</span><span><b>${esc(f.title)}</b></span><span>${esc(f.owner)}</span>
        <span>${esc(f.target)}${f.overdue ? ` <span class="over">overdue</span>` : ""}</span><span>${statusPill(f.status)}</span>
      </a></td></tr>`;
            })
            .join("")}</tbody></table>`
        : `<div class="sub">No open external/regulatory findings.</div>`}
    </div>
    <div class="foot">Prepared by Internal Audit, ${esc(s.org)}${s.generatedAt ? ` · Generated ${esc(new Date(s.generatedAt).toLocaleString())}` : ""} · Strictly confidential — for the Managing Director &amp; Executive Committee.</div>`;

  return pageShell(`Executive Assurance Brief — ${s.org || ""}`, body);
}

function renderBriefDetail(s: Snapshot, token: string, view: BriefView, index: number, data: WorkspaceDb) {
  const back = `<a class="back" href="${briefLink(token)}">← Back to Executive Assurance Brief</a>`;
  let section = "";
  let title = "";
  let content = "";

  const hydrated = hydrateBriefDetailItem(view, index, s, data);

  if (view === "issue") {
    const item = hydrated as BriefIssueDetail | null;
    if (!item) return null;
    section = "Critical & high-risk issue";
    title = item.title;
    content = renderIssueDetail(item);
  } else if (view === "repeat") {
    const item = hydrated as BriefIssueDetail | null;
    if (!item) return null;
    section = "Repeat finding";
    title = item.title;
    content = renderIssueDetail(item);
  } else if (view === "fraud") {
    const item = hydrated as BriefFraudDetail | null;
    if (!item) return null;
    section = "Unmitigated fraud risk";
    title = item.scheme;
    content = renderFraudDetail({ ...item, actions: item.actions || [] });
  } else if (view === "external") {
    const item = hydrated as BriefExtDetail | null;
    if (!item) return null;
    section = "Regulatory & external finding";
    title = item.title;
    content = renderExtDetail({ ...item, thread: item.thread || [] });
  } else if (view === "theme") {
    const item = hydrated as [string, number] | null;
    if (!item) return null;
    section = "Recurring risk theme";
    title = item[0];
    content = `
      ${metaStrip([["Open issues in this theme", String(item[1])]])}
      <div class="prose"><div class="prose-b">This theme groups open audit observations sharing a common root-cause pattern. Use the main brief to review the individual issues driving this concentration.</div></div>`;
  } else {
    return null;
  }

  const body = `
    ${back}
    ${briefHeader(s)}
    <div class="card">
      <div class="seclabel">${esc(section)}</div>
      ${content}
    </div>
    <div class="foot">Prepared by Internal Audit, ${esc(s.org)} · Strictly confidential — for the Managing Director &amp; Executive Committee.</div>`;

  return pageShell(`${title} — Executive Assurance Brief`, body);
}

function parseView(raw: string | null): BriefView | null {
  if (raw === "issue" || raw === "repeat" || raw === "fraud" || raw === "external" || raw === "theme") return raw;
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  const view = parseView(url.searchParams.get("view"));
  const indexRaw = url.searchParams.get("i");
  const index = indexRaw != null && indexRaw !== "" ? Number(indexRaw) : NaN;

  let data: WorkspaceDb;
  try {
    const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
    data = (row?.data as WorkspaceDb) || defaultWorkspaceData();
  } catch {
    return new NextResponse(notFoundPage("This brief is temporarily unavailable."), {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const exco = (data as { exco?: { briefs?: Array<{ token?: string; snapshot?: Snapshot }> } }).exco;
  const briefs = exco && Array.isArray(exco.briefs) ? exco.briefs : [];
  if (!id) {
    return new NextResponse(notFoundPage("No brief specified."), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const brief = briefs.find((b) => b && b.token === id);
  if (!brief || !brief.snapshot) {
    return new NextResponse(notFoundPage("This link is invalid or the brief is no longer available."), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (view != null) {
    if (!Number.isInteger(index) || index < 0) {
      return new NextResponse(notFoundPage("This detail link is invalid."), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    const detail = renderBriefDetail(brief.snapshot, id, view, index, data);
    if (!detail) {
      return new NextResponse(notFoundPage("This detail link is invalid or no longer available."), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new NextResponse(detail, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new NextResponse(renderBriefMain(brief.snapshot, id), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
