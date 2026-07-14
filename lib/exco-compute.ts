/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side replica of the client's Executive Assurance Brief snapshot computation.
// Kept in sync with buildExcoSnapshot / excoData / excoMatters in public/audit-bot.js
// so the cron can generate a fresh brief without a logged-in user.

const CRITS = ["Critical", "High", "Moderate", "Low", "Process Improvement"];
const CLOSE_DAYS: Record<string, number> = { Immediate: 30, "Short-term": 60, "Long-term": 120 };
const BANDS = ["Low", "Medium", "High", "Extreme"];
const RC_THEMES: [string, RegExp][] = [
  ["Policy / procedure gaps", /(policy|policies|procedure|sop\b|standard operating|guideline|framework|methodology|risk appetite|not (defined|formalis|formaliz)|undefined|absence of (a |an )?(formal )?(policy|procedure|framework))/i],
  ["Process design / controls", /(process|workflow|reconcil|validation|review control|checklist|no (formal )?(procedure|process|control)|control (gap|weakness|design)|preventive control|detective control)/i],
  ["Segregation of duties", /(segregation|sod\b|conflict of|separation of duties|duties (are|not))/i],
  ["People / capacity / training", /(staff|capacity|resourc|training|skill|awareness|competen|headcount|personnel|key.?person|manpower)/i],
  ["Governance / oversight", /(governance|oversight|monitor|escalation|accountab|responsib|tone at the top|approval authority|delegation|board|committee)/i],
  ["System / automation", /(system|automat|manual|spreadsheet|excel|technology|application|integration|legacy|it general)/i],
  ["Documentation / records", /(document|record|evidence|audit trail|filing|retention|register)/i],
  ["Third-party / vendor", /(vendor|third.?party|outsourc|provider|pfi\b|counterpart|custodian|bureau)/i],
];
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(d: Date | null) {
  return d ? `${d.getDate()} ${MONTHS3[d.getMonth()]} ${d.getFullYear()}` : "—";
}
function isoToDate(s?: string) { if (!s) return null; const d = new Date(String(s).length <= 10 ? s + "T00:00:00" : s); return isNaN(d.getTime()) ? null : d; }
function looseDate(s?: string) { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
function today0() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000); }

type Obs = { criticality?: string; status?: string; isRepeat?: boolean; rootCause?: string; timeline?: string; dueDate?: string; owner?: string; title?: string; closedDateISO?: string };
type Report = { reportDateISO?: string; reportDate?: string; observations?: Obs[]; title?: string };
type Audit = { name?: string; area?: string; reports?: Report[] };
type OItem = { o: Obs; a: Audit; r: Report };

function reportDateOf(r?: Report) { return r ? isoToDate(r.reportDateISO) || looseDate(r.reportDate) : null; }
function expectedClose(o: Obs, r?: Report) { const base = reportDateOf(r); const w = CLOSE_DAYS[o.timeline || ""]; return base && w ? addDays(base, w) : null; }
function effectiveClose(o: Obs, r?: Report) { return looseDate(o.dueDate) || expectedClose(o, r); }
function isOverdueObs(o: Obs, r?: Report) { if (o.status === "Closed") return false; const c = effectiveClose(o, r); return !!(c && today0() > c); }
function daysToClose(o: Obs, r?: Report) { const c = effectiveClose(o, r); return c ? daysBetween(today0(), c) : null; }
function extOverdue(f: { status?: string; targetDate?: string }) { if (f.status === "Closed") return false; const d = looseDate(f.targetDate); return !!(d && d < today0()); }
function rcThemes(text?: string) { const out: string[] = []; const t = text || ""; RC_THEMES.forEach(([n, re]) => { if (re.test(t)) out.push(n); }); return out.length ? out : ["Other / unclassified"]; }
function fraudBand(score: number) { return score <= 4 ? "Low" : score <= 9 ? "Medium" : score <= 14 ? "High" : "Extreme"; }
function residualBand(inh: string, strength?: string) { const r = ({ Strong: 2, Moderate: 1, Weak: 0, None: 0 } as Record<string, number>)[strength || ""] || 0; return BANDS[Math.max(0, BANDS.indexOf(inh) - r)]; }
function worstKey(counts: Record<string, number>) { return CRITS.find((k) => counts[k] > 0) || CRITS[CRITS.length - 1]; }
function zc() { const o: Record<string, number> = {}; CRITS.forEach((c) => (o[c] = 0)); return o; }

export function computeExcoSnapshot(data: any, opts: { period?: string; headline?: string; commentary?: string }) {
  const audits: Audit[] = Array.isArray(data.audits) ? data.audits : [];
  const items: OItem[] = [];
  audits.forEach((a) => (a.reports || []).forEach((r) => (r.observations || []).forEach((o) => items.push({ o, a, r }))));
  const total = items.length;
  const openItems = items.filter((x) => x.o.status !== "Closed");
  const closed = total - openItems.length;
  const remRate = total ? Math.round((closed / total) * 100) : 0;
  const keyOpen = openItems.filter((x) => x.o.criticality === "Critical" || x.o.criticality === "High");
  const overdue = openItems.filter((x) => isOverdueObs(x.o, x.r));
  const keyOverdue = keyOpen.filter((x) => isOverdueObs(x.o, x.r));
  const repeats = items.filter((x) => x.o.isRepeat);
  const repeatOpen = repeats.filter((x) => x.o.status !== "Closed");
  const watch = openItems.filter((x) => { const d = daysToClose(x.o, x.r); return d != null && d >= 0 && d <= 14; });
  const themeCount: Record<string, number> = {};
  openItems.forEach((x) => rcThemes(x.o.rootCause).forEach((t) => { if (t === "Other / unclassified") return; themeCount[t] = (themeCount[t] || 0) + 1; }));
  const themes = Object.entries(themeCount).sort((a, b) => b[1] - a[1]) as [string, number][];

  const fraudRisks: any[] = Array.isArray(data.fraudRisks) ? data.fraudRisks : [];
  const fr = fraudRisks.map((f) => { const inh = fraudBand((f.likelihood || 0) * (f.impact || 0)); const res = f.residualOverride || residualBand(inh, f.controlStrength); const acts = f.actions || []; const done = acts.length && acts.every((a: any) => a.status === "Implemented"); return { ...f, res, mitigated: f.status === "Mitigated" || done }; });
  const unmit = fr.filter((f) => (f.res === "High" || f.res === "Extreme") && !f.mitigated).sort((a, b) => BANDS.indexOf(b.res) - BANDS.indexOf(a.res));

  const extFindings: any[] = Array.isArray(data.extFindings) ? data.extFindings : [];
  const extOpen = extFindings.filter((f) => f.status !== "Closed");
  const extOverdueN = extOpen.filter(extOverdue).length;

  const plan = (Array.isArray(data.auditUniverse) ? data.auditUniverse : []).filter((e: any) => e.includeInPlan);
  const doneP = plan.filter((e: any) => e.engStatus === "Completed").length;
  const planPct = plan.length ? Math.round((doneP / plan.length) * 100) : 0;

  const openByC = zc();
  openItems.forEach((x) => { const c = x.o.criticality || ""; if (openByC[c] != null) openByC[c]++; });

  const matters: string[] = [];
  if (keyOverdue.length) matters.push(`${keyOverdue.length} critical/high-risk issue${keyOverdue.length !== 1 ? "s are" : " is"} overdue — management remediation has slipped past the agreed date and needs executive push.`);
  if (unmit.length) matters.push(`${unmit.length} fraud risk${unmit.length !== 1 ? "s remain" : " remains"} at High/Extreme residual without full mitigation — prioritise the control actions with the risk owners.`);
  if (extOverdueN) matters.push(`${extOverdueN} regulatory/external audit finding${extOverdueN !== 1 ? "s are" : " is"} past the remediation deadline — regulatory exposure requiring attention.`);
  if (repeatOpen.length) matters.push(`${repeatOpen.length} repeat finding${repeatOpen.length !== 1 ? "s recur" : " recurs"} from prior audits — issues are not being sustainably fixed at root cause.`);
  if (watch.length) matters.push(`${watch.length} issue${watch.length !== 1 ? "s fall" : " falls"} due within two weeks — owner follow-through needed to avoid new overdues.`);
  if (themes.length && themes[0][1] >= 3) matters.push(`Risk is concentrating in ${themes[0][0]} (${themes[0][1]} open issues) — a systemic theme for management focus.`);
  if (plan.length && planPct < 60) matters.push(`Annual audit plan delivery is at ${planPct}% — monitor to ensure planned assurance coverage is achieved.`);
  if (!matters.length) matters.push(`No matters require escalation this period — remediation is broadly on track, with no High/Extreme fraud or regulatory exposures outstanding.`);

  const keySorted = keyOpen.slice().sort((a, b) => (Number(isOverdueObs(b.o, b.r)) - Number(isOverdueObs(a.o, a.r))) || (CRITS.indexOf(a.o.criticality || "") - CRITS.indexOf(b.o.criticality || "")));
  const extSorted = extOpen.slice().sort((a, b) => Number(extOverdue(b)) - Number(extOverdue(a)));

  return {
    org: data.org || "",
    period: opts.period || fmtDate(today0()),
    generatedAt: new Date().toISOString(),
    headline: opts.headline || "",
    commentary: opts.commentary || "",
    remRate, closed, total,
    kpis: { keyOpen: keyOpen.length, keyOverdue: keyOverdue.length, overdue: overdue.length, unmit: unmit.length, extOpen: extOpen.length, extOverdueN, watch: watch.length },
    matters,
    keyIssues: keySorted.slice(0, 15).map((x) => ({ criticality: x.o.criticality, title: x.o.title, area: (x.a.name || "") + (x.a.area ? " · " + x.a.area : ""), owner: x.o.owner || "—", targetClose: fmtDate(effectiveClose(x.o, x.r)), status: x.o.status || "Open", overdue: isOverdueObs(x.o, x.r), repeat: !!x.o.isRepeat })),
    themes: themes.slice(0, 8),
    fraud: unmit.slice(0, 12).map((f) => ({ res: f.res, scheme: f.scheme, category: f.category || "—", owner: f.owner || "—", status: f.status || "Identified" })),
    ext: extSorted.slice(0, 10).map((f) => ({ source: f.source || "—", title: f.title || f.ref || "—", owner: f.owner || "—", target: f.targetDate || "—", status: f.status || "Open", overdue: extOverdue(f) })),
    repeats: repeats.slice(0, 8).map((x) => ({ title: x.o.title, audit: x.a.name || "", status: x.o.status || "Open" })),
  };
}
