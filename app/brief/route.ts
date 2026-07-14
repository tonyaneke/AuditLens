import { NextResponse } from "next/server";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKSPACE_ID = "default";

function esc(v: unknown) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  keyIssues?: Array<{ criticality: string; title: string; area: string; owner: string; targetClose: string; status: string; overdue: boolean; repeat: boolean }>;
  themes?: Array<[string, number]>;
  fraud?: Array<{ res: string; scheme: string; category: string; owner: string; status: string }>;
  ext?: Array<{ source: string; title: string; owner: string; target: string; status: string; overdue: boolean }>;
};

function nl2br(s: string) {
  return esc(s).replace(/\n/g, "<br>");
}

function notFoundPage(message: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Executive Assurance Brief</title>
  <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f2f7f5;color:#19302a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
  .box{background:#fff;border:1px solid #e1eae7;border-radius:14px;padding:32px 36px;max-width:460px;text-align:center;box-shadow:0 12px 32px rgba(15,40,34,.1)}
  .t{font-weight:800;color:#0d5a47;font-size:18px;margin-bottom:8px}</style></head>
  <body><div class="box"><div class="t">Executive Assurance Brief</div><p>${esc(message)}</p></div></body></html>`;
}

function renderBrief(s: Snapshot) {
  const k = s.kpis || { keyOpen: 0, keyOverdue: 0, overdue: 0, unmit: 0, extOpen: 0, extOverdueN: 0 };
  const kpi = (label: string, num: string | number, sub: string) =>
    `<div class="kpi"><div class="kpi-num">${esc(num)}</div><div class="kpi-lab">${esc(label)}</div><div class="kpi-sub">${esc(sub)}</div></div>`;
  const maxT = Math.max(1, ...(s.themes || []).map((t) => t[1]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Executive Assurance Brief — ${esc(s.org)}</title>
  <style>
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
  .spacer{flex:1}
  .card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(15,40,34,.04)}
  .seclabel{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--teal);margin-bottom:12px}
  .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .kpi-num{font-size:26px;font-weight:800;color:var(--teal)}
  .kpi-lab{font-size:12px;font-weight:700;margin-top:2px}
  .kpi-sub{font-size:11.5px;color:var(--muted);margin-top:2px}
  ol.matters{margin:0;padding-left:22px}
  ol.matters li{margin:8px 0;font-size:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:2px solid var(--line);padding:8px 10px}
  td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700}
  .sub{font-size:12px;color:var(--muted)}
  .theme{display:flex;align-items:center;gap:12px;margin:7px 0}
  .theme .nm{width:210px;font-size:13px}
  .theme .track{flex:1;height:9px;background:#eef2f7;border-radius:6px;overflow:hidden}
  .theme .fill{height:100%;background:var(--teal)}
  .theme .vv{width:28px;text-align:right;font-weight:700}
  .foot{text-align:center;color:var(--muted);font-size:12px;margin:22px 0 8px}
  .over{color:#b00020;font-weight:700}
  @media(max-width:720px){.kpis{grid-template-columns:1fr 1fr}}
  </style></head>
  <body><div class="wrap">
    <div class="hero">
      <div class="row">
        <div style="flex:1">
          <div class="lbl">Internal Audit · Executive Assurance Brief</div>
          <h1>${esc(s.org)}</h1>
          <div class="postu">As at ${esc(s.period)}</div>
        </div>
        <div style="text-align:right"><div class="rate">${esc(s.remRate)}%</div><div style="font-size:12px;color:#cfe7de">issues remediated</div></div>
      </div>
      ${s.headline ? `<div class="msg">${nl2br(s.headline)}</div>` : ""}
    </div>

    ${s.commentary ? `<div class="card"><div class="seclabel">Chief Audit Executive's commentary</div><div style="font-size:13.5px">${nl2br(s.commentary)}</div></div>` : ""}

    <div class="kpis">
      ${kpi("Critical & High open", k.keyOpen, `${k.keyOverdue} overdue`)}
      ${kpi("Remediation rate", `${s.remRate}%`, `${s.closed} of ${s.total} closed`)}
      ${kpi("Overdue actions", k.overdue, "past target date")}
      ${kpi("Unmitigated fraud", k.unmit, "High/Extreme residual")}
      ${kpi("Regulatory findings", k.extOpen, `${k.extOverdueN} overdue`)}
    </div>

    <div class="card"><div class="seclabel">Matters requiring EXCO attention</div>
      <ol class="matters">${(s.matters || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
    </div>

    <div class="card"><div class="seclabel">Critical &amp; high-risk issues requiring executive attention</div>
      ${(s.keyIssues || []).length
        ? `<table><thead><tr><th>Criticality</th><th>Issue</th><th>Owner</th><th>Target close</th><th>Status</th></tr></thead><tbody>${(s.keyIssues || [])
            .map(
              (o) => `<tr>
        <td><span class="pill" style="background:${critColor(o.criticality)}1a;color:${critColor(o.criticality)}">${esc(o.criticality)}</span>${o.repeat ? ` <span class="pill" style="background:#efe3f7;color:#6b3fa0">repeat</span>` : ""}</td>
        <td><b>${esc(o.title)}</b><div class="sub">${esc(o.area)}</div></td>
        <td>${esc(o.owner)}</td>
        <td>${esc(o.targetClose)}${o.overdue ? ` <span class="over">overdue</span>` : ""}</td>
        <td>${esc(o.status)}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : `<div class="sub">No open Critical or High-risk issues.</div>`}
    </div>

    <div class="card"><div class="seclabel">Emerging &amp; recurring risk themes</div>
      ${(s.themes || []).length
        ? (s.themes || [])
            .map(([t, n]) => `<div class="theme"><div class="nm">${esc(t)}</div><div class="track"><div class="fill" style="width:${(n / maxT) * 100}%"></div></div><div class="vv">${n}</div></div>`)
            .join("")
        : `<div class="sub">No open issues to theme yet.</div>`}
    </div>

    <div class="card"><div class="seclabel">Unmitigated fraud risks — High / Extreme residual</div>
      ${(s.fraud || []).length
        ? `<table><thead><tr><th>Residual</th><th>Scheme</th><th>Category</th><th>Owner</th><th>Status</th></tr></thead><tbody>${(s.fraud || [])
            .map((f) => `<tr><td><span class="pill" style="background:${bandColor(f.res)}1a;color:${bandColor(f.res)}">${esc(f.res)}</span></td><td><b>${esc(f.scheme)}</b></td><td>${esc(f.category)}</td><td>${esc(f.owner)}</td><td>${esc(f.status)}</td></tr>`)
            .join("")}</tbody></table>`
        : `<div class="sub">No fraud risks at High/Extreme residual outstanding.</div>`}
    </div>

    <div class="card"><div class="seclabel">Regulatory &amp; external audit exposure</div>
      ${(s.ext || []).length
        ? `<table><thead><tr><th>Source</th><th>Finding</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>${(s.ext || [])
            .map((f) => `<tr><td>${esc(f.source)}</td><td><b>${esc(f.title)}</b></td><td>${esc(f.owner)}</td><td>${esc(f.target)}${f.overdue ? ` <span class="over">overdue</span>` : ""}</td><td>${esc(f.status)}</td></tr>`)
            .join("")}</tbody></table>`
        : `<div class="sub">No open external/regulatory findings.</div>`}
    </div>

    <div class="foot">Prepared by Internal Audit, ${esc(s.org)}${s.generatedAt ? ` · Generated ${esc(new Date(s.generatedAt).toLocaleString())}` : ""} · Strictly confidential — for the Managing Director &amp; Executive Committee.</div>
  </div></body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";

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

  const exco = (data as { exco?: { token?: string; snapshot?: Snapshot } }).exco;
  if (!exco || !exco.token || !exco.snapshot) {
    return new NextResponse(notFoundPage("No executive brief has been published yet."), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!id || id !== exco.token) {
    return new NextResponse(notFoundPage("This link is invalid or has expired."), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new NextResponse(renderBrief(exco.snapshot), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
