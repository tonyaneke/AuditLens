// Go-live backlog load — clears the UAT database and rebuilds it from "AuditLens Migration
// Data.xlsx" (the Head of Audit's working register).
//
//   npx tsx scripts/migrate-backlog.mts            → DRY RUN. Full report, writes nothing.
//   npx tsx scripts/migrate-backlog.mts --apply    → wipes and loads.
//
// This is NOT one of the QA remediation migrations. Those adjust fields in place and are
// idempotent by construction; this one is a destructive reload. Two properties make it safe to
// run more than once:
//
//   1. Before any write, --apply snapshots EVERYTHING it is about to destroy — the whole
//      workspace document, every user row, and every audit-log row — to scripts/.snapshots/.
//      That file is a complete restore point; nothing here is recoverable any other way.
//   2. Record ids are derived from natural keys (audit name, finding S/n) rather than generated,
//      so two runs produce byte-identical output. Re-running replaces the load with itself
//      instead of duplicating it.
//
// What it does, in order:
//   · Users     — deletes every account except the Head of Audit, then creates the nine action
//                 owners named in the workbook as INACTIVE. No welcome email is sent: the Head
//                 activating each account is what releases it (PATCH /api/users/:id).
//   · Audit log — cleared. Every existing row describes UAT activity on records being deleted.
//   · Workspace — audits and reports from AUDIT PLAN, observations from INTERNAL AUDIT FINDINGS
//                 filed under the report for their audit, findings from EXTERNAL AUDIT FINDINGS,
//                 departments derived from the owners. The audit universe is carried over
//                 (re-linked to the new audits); everything else is reset.
//
// Anything the workbook does not say, this script does not invent. Every such gap is listed
// under "Gaps the workbook does not fill" at the end of the report.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  getPrisma,
  heading,
  parseArgs,
  readWorkspace,
  section,
  table,
  WORKSPACE_ID,
  type Workspace,
} from "./_migration.mjs";
import { addDaysIso, excelSerialToIso, readWorkbook, type Sheet } from "./_xlsx.mjs";

const NAME = "migrate-backlog";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKBOOK = path.join(ROOT, "AuditLens Migration Data.xlsx");
const SNAPSHOT_DIR = path.join(ROOT, "scripts", ".snapshots");

/** The one account that survives the user wipe. */
const HEAD_EMAIL = (process.env.HEAD_AUDIT_EMAIL || "amichael@credicorp.ng").toLowerCase();

/* ============================================================================ owner directory

   The workbook's Owner column holds role labels ("CHIEF FINANCIAL OFFICER"), not people. These
   are the people behind them, per DEPARTMENTS.md; emails follow the staffEmail() rule
   (first initial + surname @credicorp.ng) and were checked against that file one by one.

   Corporate Communications is deliberately its own department rather than being folded into
   Strategy. The workbook holds it accountable separately from "HEAD STRATEGY & INNOVATION" —
   six observations sit with one and seventeen with the other — and the workspace department is
   what an observation is filed against, so collapsing them would misattribute six findings. */
type Owner = {
  /** Label as it appears in the workbook (normalised form). */
  label: string;
  aliases?: string[];
  name: string;
  email: string;
  /** Workspace department this person heads. */
  department: string;
  title: string;
};

const OWNERS: Owner[] = [
  { label: "CHIEF FINANCIAL OFFICER", aliases: ["CFO"], name: "Jonathan Aderibigbe", email: "jaderibigbe@credicorp.ng", department: "Finance Department", title: "Chief Financial Officer" },
  { label: "HEAD STRATEGY & INNOVATION", name: "Alexander Ehanire", email: "aehanire@credicorp.ng", department: "Strategy Department", title: "Head, Strategy & Innovation" },
  { label: "HEAD CREDIT OPERATIONS", aliases: ["HEAD OF CREDIT"], name: "Sadiq Mohammed", email: "smohammed@credicorp.ng", department: "Credit Operations", title: "Head, Credit Operations" },
  { label: "HEAD RISK MANAGEMENT", name: "Asari Etuk", email: "aetuk@credicorp.ng", department: "Risk Management", title: "Head, Risk and Compliance" },
  { label: "HEAD ADMIN, PEOPLE & CULTURE", aliases: ["HAPC"], name: "Wuraola Odubiyi", email: "wodubiyi@credicorp.ng", department: "People & Culture Department", title: "Head, Admin, People & Culture" },
  { label: "CORPORATE COMMUNICATIONS", name: "Michael Ojo", email: "mojo@credicorp.ng", department: "Corporate Communications", title: "Professional - Strategic Communications" },
  { label: "HEAD PROCUREMENT", name: "Imoh Usoro", email: "iusoro@credicorp.ng", department: "Procurement Department", title: "Head, Procurement" },
  { label: "COMPANY SEC./LEGAL", name: "Obiageli Ohakim", email: "oohakim@credicorp.ng", department: "Legal Department", title: "Head, Legal & Company Secretary" },
  { label: "CHIEF OF STAFF", name: "Ladi Amusu", email: "lamusu@credicorp.ng", department: "Office of the Managing Director", title: "Chief of Staff" },
];

/* ============================================================ MD & EXCO brief recipients

   Who the Executive Assurance Brief goes to. These are the Managing Director and the Executive
   Directors — the only three people in STAFF_DIRECTORY whose job title carries either rank.

   Recipients are NOT users and get no account: the brief is emailed as a tokenised public link,
   so being on this list confers no access to AuditLens itself. */
const EXCO_RECIPIENTS: { name: string; role: string; email: string }[] = [
  { name: "Uzoma Nwagba", role: "Managing Director", email: "unwagba@credicorp.ng" },
  { name: "Aisha Abdullahi", role: "Executive Director – Credit & Portfolio Management", email: "aabdullahi@credicorp.ng" },
  { name: "Olanike Kolawole", role: "Executive Director – Operations", email: "okolawole@credicorp.ng" },
];

const ownerByLabel = new Map<string, Owner>();
for (const o of OWNERS) {
  ownerByLabel.set(o.label, o);
  for (const a of o.aliases || []) ownerByLabel.set(a, o);
}

function normLabel(raw: string): string {
  return String(raw || "").toUpperCase().replace(/\s+/g, " ").trim();
}

/* ==================================================================== field value translation */

/** Workbook rating → the app's criticality scale (CRITS in lib/workspace/selectors.ts).
 *  "Medium" is the workbook's word for what the app calls "Moderate"; nothing else differs. */
const CRITICALITY: Record<string, string> = {
  High: "High",
  Medium: "Moderate",
  Low: "Low",
};

/** Workbook timeline → the app's Timeline union. The exact strings matter: CLOSE_DAYS is keyed
 *  on them, and a value outside the map silently disables the expected-close calculation. */
const TIMELINE: Record<string, string> = {
  Immediate: "Immediate",
  "Short - Mid": "Short-term",
  Long: "Long-term",
};

/** Mirrors CLOSE_DAYS in lib/workspace/selectors.ts — restated so this script has no React
 *  dependency. Used to derive each report's date from the target dates of its findings. */
const CLOSE_DAYS: Record<string, number> = {
  Immediate: 30,
  "Short-term": 60,
  "Long-term": 120,
};

const AUDIT_STATUS: Record<string, string> = {
  COMPLETED: "Completed",
  PENDING: "Planned",
};

/** External audit name → the app's EXT_SOURCES value, and the theme where the name states it.
 *  A data-protection audit's theme is not a guess; for the statutory letters it would be, so
 *  they are left blank (the register renders a blank theme as "Other"). */
function extSourceFor(auditName: string): { source: string; theme: string; year: string } {
  const year = /\b(20\d{2})\b/.exec(auditName)?.[1] || "";
  if (/data protection/i.test(auditName)) {
    return { source: "NDPC Data Protection", theme: "Data protection", year };
  }
  return { source: "Statutory / External Audit", theme: "", year };
}

/** Deterministic id from a natural key, so re-running produces the same document.
 *  Prefixed per entity type purely so ids are readable in the stored JSON. */
function stableId(kind: string, key: string): string {
  return kind + crypto.createHash("sha1").update(`${kind}:${key}`).digest("hex").slice(0, 10);
}

/** The rating is already carried by the criticality field; a trailing "RATING: HIGH" line in
 *  the risk narrative is workbook bookkeeping, not part of the risk. */
function stripTrailingRating(text: string): string {
  return text.replace(/\n*\s*RATING:\s*[A-Za-z ]+\s*$/i, "").trim();
}

/* ================================================================================== reporting */

const warnings: { area: string; detail: string }[] = [];
function warn(area: string, detail: string) {
  warnings.push({ area, detail });
}

const gaps: string[] = [];

/* ======================================================================================= main */

type PlanRow = { quarter: string; year: string; name: string; type: string; status: string };

type BuiltObs = Record<string, unknown>;

async function main() {
  const ctx = parseArgs();
  heading(`Go-live backlog load${ctx.apply ? " (APPLY — DESTRUCTIVE)" : " (dry run)"}`);

  if (!fs.existsSync(WORKBOOK)) {
    throw new Error(`Workbook not found: ${path.relative(ROOT, WORKBOOK)}`);
  }

  const sheets = readWorkbook(WORKBOOK);
  const plan = sheetNamed(sheets, "AUDIT PLAN");
  const internal = sheetNamed(sheets, "INTERNAL AUDIT FINDINGS");
  const external = sheetNamed(sheets, "EXTERNAL AUDIT FINDINGS");

  console.log(
    `\n  Workbook: ${path.basename(WORKBOOK)}\n` +
      `  Sheets:   ${sheets.map((s) => `${s.name} (${s.rows.length - 1} rows)`).join(", ")}`,
  );

  /* ------------------------------------------------------------------ 1. read the audit plan */

  const planRows: PlanRow[] = [];
  for (let i = 1; i < plan.rows.length; i++) {
    const [quarter, year, name, type, status] = plan.rows[i];
    if (!name.trim()) continue; // trailing blank rows
    planRows.push({ quarter, year, name: name.trim(), type, status: status.toUpperCase() });
  }

  // The "- Q1" in an audit name is its quarter, not its year, so the 2027 plan repeats six of
  // the 2026 names verbatim. Name alone therefore cannot identify an engagement: the plan is
  // keyed by name + year, and a finding is matched using the year in its Period column.
  const planByName = new Map<string, PlanRow[]>();
  for (const r of planRows) {
    const key = r.name.toLowerCase();
    const list = planByName.get(key) || [];
    if (list.some((x) => x.year === r.year)) {
      throw new Error(
        `AUDIT PLAN lists "${r.name}" twice in ${r.year}. Name + year is what links the plan to ` +
          `the findings sheets, so that pair must be unique. Fix the workbook and re-run.`,
      );
    }
    list.push(r);
    planByName.set(key, list);
  }

  /** The plan row a finding belongs to. Ambiguity is resolved by the finding's Period year and
   *  never guessed — an unresolvable one is reported and stops the run. */
  function planFor(auditName: string, period: string): PlanRow | undefined {
    const list = planByName.get(auditName.toLowerCase());
    if (!list || !list.length) return undefined;
    if (list.length === 1) return list[0];
    const year = /\b(20\d{2})\b/.exec(period)?.[1];
    return year ? list.find((p) => p.year === year) : undefined;
  }

  /* --------------------------------------------- 2. read the findings and resolve their audit */

  type FindingRow = {
    sn: string;
    period: string;
    auditName: string;
    title: string;
    description: string;
    risk: string;
    rootCause: string;
    recommendation: string;
    managementResponse: string;
    rating: string;
    ownerLabel: string;
    status: string;
    closureAction: string;
    dueSerial: string;
    timeline: string;
    repeat: string;
  };

  const findings: FindingRow[] = [];
  for (let i = 1; i < internal.rows.length; i++) {
    const r = internal.rows[i];
    if (!r[3].trim()) continue;
    findings.push({
      sn: r[0], period: r[1], auditName: r[2].trim(), title: r[3], description: r[4],
      risk: r[5], rootCause: r[6], recommendation: r[7], managementResponse: r[8],
      rating: r[9], ownerLabel: r[10], status: r[11], closureAction: r[12],
      dueSerial: r[13], timeline: r[14], repeat: r[15],
    });
  }

  // Every finding must land under a planned audit — an observation with no audit has nowhere to
  // live in the data model, and quietly creating an audit for it would hide a workbook error.
  const unmatched = findings.filter((f) => !planFor(f.auditName, f.period));
  if (unmatched.length) {
    section("Findings that cannot be matched to an AUDIT PLAN row", unmatched.length);
    table(
      unmatched.map((f) => ({
        "s/n": f.sn,
        period: f.period,
        "audit name": f.auditName,
        why: planByName.has(f.auditName.toLowerCase()) ? "name used in several years; Period does not say which" : "no such audit in the plan",
      })),
      { "audit name": 50, why: 50 },
    );
    throw new Error(
      `${unmatched.length} finding(s) cannot be tied to a planned audit. Correct the Audit Name ` +
        `or the Period in the workbook and re-run.`,
    );
  }

  /** Uniquely identifies an engagement across years. */
  const planKey = (p: PlanRow) => `${p.name}|${p.quarter} ${p.year}`;
  const planOf = new Map<FindingRow, PlanRow>(findings.map((f) => [f, planFor(f.auditName, f.period)!]));

  // Owner labels must all resolve to a person. An unassigned observation never reaches anyone's
  // portal, which is the whole point of the load.
  const badOwners = new Set<string>();
  for (const f of findings) if (!ownerByLabel.has(normLabel(f.ownerLabel))) badOwners.add(f.ownerLabel);
  for (let i = 1; i < external.rows.length; i++) {
    const label = external.rows[i][9];
    if (label && !ownerByLabel.has(normLabel(label))) badOwners.add(label);
  }
  if (badOwners.size) {
    throw new Error(
      `Owner label(s) with no person behind them: ${[...badOwners].map((x) => `"${x}"`).join(", ")}. ` +
        `Add them to the OWNERS table at the top of this script and re-run.`,
    );
  }

  // Period column vs audit name: the audit name is authoritative (it is the actual link), but a
  // disagreement is worth surfacing — it usually means an engagement reported a quarter late.
  const periodMismatch = new Map<string, { auditPeriod: string; findingPeriods: Set<string>; n: number }>();
  for (const f of findings) {
    const p = planOf.get(f)!;
    const auditPeriod = `${p.quarter} ${p.year}`;
    if (f.period.trim() && f.period.trim() !== auditPeriod) {
      const e = periodMismatch.get(f.auditName) || { auditPeriod, findingPeriods: new Set<string>(), n: 0 };
      e.findingPeriods.add(f.period.trim());
      e.n++;
      periodMismatch.set(f.auditName, e);
    }
  }

  /* ------------------------------------- 3. derive each report's date from its target dates */

  // The workbook records a target date per finding but no report date, and the app measures
  // ageing and expected close from the report date. The two are related by the timeline band
  // (Immediate = report + 30 days, and so on), so every finding implies a report date. Within an
  // audit they agree, which is what makes this a derivation rather than a guess — a disagreement
  // is reported and the most common value wins.
  const reportDateByAudit = new Map<string, string>();
  const dateSpread: Record<string, string>[] = [];

  for (const [key, group] of groupBy(findings, (f) => planKey(planOf.get(f)!))) {
    const votes = new Map<string, number>();
    for (const f of group) {
      const iso = excelSerialToIso(f.dueSerial);
      const days = CLOSE_DAYS[TIMELINE[f.timeline.trim()] || ""];
      if (!iso || days == null) continue;
      const base = addDaysIso(iso, -days);
      votes.set(base, (votes.get(base) || 0) + 1);
    }
    if (!votes.size) {
      warn("report date", `"${key}" — no finding carries a usable target date; report date left blank.`);
      continue;
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    reportDateByAudit.set(key, ranked[0][0]);
    if (ranked.length > 1) {
      dateSpread.push({
        audit: key,
        chosen: `${ranked[0][0]} (${ranked[0][1]} of ${group.length})`,
        others: ranked.slice(1).map(([d, n]) => `${d}×${n}`).join(", "),
      });
    }
  }

  /* ------------------------------------------------------------------ 4. build the workspace */

  const current: Workspace = await readWorkspace();
  const prisma = await getPrisma();
  const existingUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  const logCount = await prisma.auditLog.count();

  // Every observation here was raised by Internal Audit off the back of this register, so the
  // Head of Audit is its author. Her account is the one the wipe preserves, so the id is stable.
  const headUser = existingUsers.find((u) => u.email.toLowerCase() === HEAD_EMAIL);

  // Resolved lazily: in a dry run there are no user ids yet, so the report shows the email.
  let userIdByEmail = new Map<string, string>();
  const ownerUserId = (o: Owner) => userIdByEmail.get(o.email) || `(new: ${o.email})`;

  const departments = OWNERS.map((o) => ({
    id: stableId("dept", o.department),
    name: o.department,
    headName: o.name,
    headEmail: o.email,
    headUserId: "",
    createdAt: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  }));
  const deptIdFor = (o: Owner) => stableId("dept", o.department);

  const build = () => {
    /* --- audits & reports ------------------------------------------------------------- */
    const audits: Record<string, unknown>[] = [];
    const refCounter = new Map<string, number>(); // report references run per year

    for (const p of planRows) {
      const key = planKey(p);
      const group = findings.filter((f) => planOf.get(f) === p);
      const auditId = stableId("aud", key);
      const reportDate = reportDateByAudit.get(key) || "";
      const audit: Record<string, unknown> = {
        id: auditId,
        name: p.name,
        // Every plan row is typed "Process"; the app's own value for that is "process".
        type: /^dep/i.test(p.type) ? "department" : "process",
        area: "",
        period: `${p.quarter} ${p.year}`.trim(),
        leadAuditor: "",
        leadAuditorId: "",
        status: AUDIT_STATUS[p.status] || "Planned",
        createdAt: (reportDate || `${p.year}-01-01`) + "T00:00:00.000Z",
        reports: [] as Record<string, unknown>[],
      };

      // Only an audit that produced findings gets a report — there is no report content in the
      // workbook for the rest, and an empty report would read as an issued clean opinion.
      if (group.length) {
        const seq = (refCounter.get(p.year) || 0) + 1;
        refCounter.set(p.year, seq);
        const observations: BuiltObs[] = group.map((f) => buildObservation(f, reportDate));
        (audit.reports as Record<string, unknown>[]).push({
          id: stableId("rep", key),
          title: p.name,
          refNo: `IA/${p.year}/${String(seq).padStart(3, "0")}`,
          period: `${p.quarter} ${p.year}`.trim(),
          status: "Final",
          kind: "Audit report",
          scope: "",
          reportDateISO: reportDate,
          createdAt: (reportDate || `${p.year}-01-01`) + "T00:00:00.000Z",
          execSummaryNarrative: "",
          observations,
        });
      }
      audits.push(audit);
    }

    /* --- external findings ------------------------------------------------------------- */
    const extFindings: Record<string, unknown>[] = [];
    for (let i = 1; i < external.rows.length; i++) {
      const r = external.rows[i];
      if (!r[2].trim()) continue;
      const [sn, auditName, title, description, rating, risk, recommendation, mgmt, comment, ownerLabel, status, closureAction] = r;
      const owner = ownerByLabel.get(normLabel(ownerLabel))!;
      const { source, theme, year } = extSourceFor(auditName);

      // The follow-up "Comment" column has no field of its own. Appending it to the management
      // response under a label keeps it visible and attributed rather than dropping it.
      const response = [mgmt.trim(), comment.trim() ? `Follow-up: ${comment.trim()}` : ""]
        .filter(Boolean)
        .join("\n\n");

      extFindings.push({
        id: stableId("ext", `${auditName}|${sn}`),
        ref: `EF-${String(sn).padStart(3, "0")}`,
        source,
        sourceRef: auditName.trim(),
        year,
        theme,
        // The workbook grades findings "Deficiency"/"Observation", which is a different axis from
        // the register's High/Medium/Low severity. Mapped to the app's own default rather than
        // inflated to High, and the workbook's word is kept verbatim in `rating`.
        severity: /observation/i.test(rating) ? "Low" : "Medium",
        rating: rating.trim(),
        title: title.trim(),
        detail: description.trim(),
        risk: risk.trim(),
        recommendation: recommendation.trim(),
        managementResponse: response,
        owner: ownerLabel.trim(),
        ownerUserId: ownerUserId(owner),
        secondaryOwner: "",
        secondaryOwnerUserId: "",
        departmentId: deptIdFor(owner),
        targetDate: "",
        dueDate: "",
        status: status.trim() === "Closed" ? "Closed" : "Open",
        isRepeat: false,
        repeatOf: "",
        isExternal: true,
        raisedBy: headUser?.id || "",
        raisedByName: headUser?.name || String(current.signOffName || "Awa Michael"),
        verifiedBy: "",
        closureEvidence: "",
        closedDateISO: "",
        ownerResponse: closureAction.trim(),
        ownerRectifiedByName: closureAction.trim() ? owner.name : "",
        updates: [],
        createdAt: (year ? `${year}-12-31` : "2026-01-01") + "T00:00:00.000Z",
      });
    }

    /* --- audit universe: carried over, re-linked to the new audits --------------------- */
    const universe = (current.auditUniverse as Record<string, unknown>[]) || [];
    const relinked: Record<string, string>[] = [];
    const normName = (s: string) =>
      String(s).toLowerCase().replace(/&/g, "and").replace(/\s*-\s*q[1-4]\s*$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
    const auditsByNorm = new Map<string, string[]>();
    for (const a of audits) {
      const k = normName(String(a.name));
      auditsByNorm.set(k, [...(auditsByNorm.get(k) || []), String(a.id)]);
    }
    const carriedUniverse = universe.map((u) => {
      const matches = auditsByNorm.get(normName(String(u.name || ""))) || [];
      const before = (u.linkedAuditIds as string[] | undefined)?.length || (u.linkedAuditId ? 1 : 0);
      relinked.push({
        unit: String(u.name || "").slice(0, 48),
        "was linked": String(before),
        "now linked": String(matches.length),
        to: matches.length ? "the new quarterly engagements" : "— no engagement of that name",
      });
      const next = { ...u, linkedAuditIds: matches };
      delete (next as Record<string, unknown>).linkedAuditId; // pre-multi-link shape
      return next;
    });

    /* --- the document ------------------------------------------------------------------ */
    const exco = (current.exco as Record<string, unknown>) || {};
    const db: Workspace = {
      org: current.org || "Nigerian Consumer Credit Corporation (CREDICORP)",
      signOffName: current.signOffName || "Awa Michael",
      signOffTitle: current.signOffTitle || "Head, Internal Audit",
      planYear: "2026",
      planYears: [...new Set(planRows.map((p) => p.year))].sort(),
      audits,
      auditUniverse: carriedUniverse,
      fraudRisks: [],
      fraudPlanNarrative: "",
      fraudUpdate: { period: "", commentary: "" },
      processReviews: [],
      extFindings,
      extCommentary: "",
      iaSAList: [],
      iaSACurrentId: "",
      departments,
      notifications: [],
      approvals: [],
      // Brief history is data and goes. The recipient list is a setting: any addresses the Head
      // has already configured are kept, and the MD/EDs are merged in by email so re-running
      // cannot duplicate someone who is already on the list.
      exco: {
        recipientList: mergeRecipients(
          (exco.recipientList as Record<string, unknown>[]) || [],
          EXCO_RECIPIENTS,
        ),
        recipients: exco.recipients || [],
        cc: exco.cc || "",
        subject: exco.subject || "",
        period: "",
        headline: "",
        commentary: "",
        briefs: [],
        sends: [],
      },
      caeReport: { period: "", commentary: "" },
    };
    return { db, relinked };
  };

  function buildObservation(f: FindingRow, reportDate: string): BuiltObs {
    const owner = ownerByLabel.get(normLabel(f.ownerLabel))!;
    const timeline = TIMELINE[f.timeline.trim()] || "";
    if (!timeline) warn("timeline", `s/n ${f.sn} — unrecognised timeline "${f.timeline}"; left blank.`);

    let dueDate = excelSerialToIso(f.dueSerial);
    if (!dueDate) {
      // One row records "30" — a number of days, not a date. Rebuilding it from the report date
      // and the timeline band reproduces exactly what every other row in that audit says.
      const days = CLOSE_DAYS[timeline];
      if (reportDate && days != null) {
        dueDate = addDaysIso(reportDate, days);
        warn(
          "target date",
          `s/n ${f.sn} — target date recorded as "${f.dueSerial}", which is a day count, not a date. ` +
            `Rebuilt as ${dueDate} from the report date + the ${timeline} band.`,
        );
      } else {
        warn("target date", `s/n ${f.sn} — target date "${f.dueSerial}" unreadable and not derivable; left blank.`);
      }
    }

    const isRepeat = /^yes/i.test(f.repeat.trim());
    if (isRepeat) {
      warn(
        "repeat finding",
        `s/n ${f.sn} ("${f.title.slice(0, 44)}") is flagged as a repeat but the workbook does not say ` +
          `which prior finding it recurs from. Loaded as a repeat with no link — set it on the observation.`,
      );
    }

    const status = f.status.trim() === "Closed" ? "Closed" : "Open";
    const closed = status === "Closed";

    /* Closure trail. Confirmed by the Head of Audit: a closed finding was closed ON its Expected
       Closure Date — that column is the closure date, not merely a target — and every closure in
       this register was signed off by her. So a closed observation gets the same stamps the
       in-app Head sign-off writes (HeadCloseDialog), dated to the closure date.

       The owner's "Ready for closure" step is stamped only where the workbook actually records a
       Closure Action, and only on closed rows. Two OPEN rows also carry a closure action; leaving
       their stamp blank keeps them out of the "Ready for closure" queue, which is a state their
       owner has not reached in the app and would otherwise have to be undone by hand. */
    const closureDate = closed ? dueDate : "";
    const closureAt = closureDate ? `${closureDate}T00:00:00.000Z` : "";
    const headName = headUser?.name || String(current.signOffName || "Awa Michael");
    const ownerActed = closed && !!f.closureAction.trim() && !!closureAt;
    if (closed && !closureDate) {
      warn("closure date", `s/n ${f.sn} — closed, but has no usable Expected Closure Date; closure left undated.`);
    }

    return {
      id: stableId("obs", `${planKey(planOf.get(f)!)}|${f.sn}`),
      // The workbook's S/n IS the reference scheme already in use (1.1 … 86.1) — see the note in
      // lib/workspace/obs-validation.ts. Keeping it means Board papers citing these still resolve.
      ref: `${f.sn}.1`,
      title: f.title.trim(),
      category: "",
      description: f.description.trim(),
      criteria: "",
      risk: stripTrailingRating(f.risk),
      rootCause: f.rootCause.trim(),
      recommendation: f.recommendation.trim(),
      sopUpdate: "",
      criticality: CRITICALITY[f.rating.trim()] || "Moderate",
      managementResponse: f.managementResponse.trim(),
      owner: f.ownerLabel.trim(),
      ownerUserId: ownerUserId(owner),
      secondaryOwnerUserId: "",
      departmentId: deptIdFor(owner),
      timeline,
      dueDate,
      status,
      closedDateISO: closureDate,
      isRepeat,
      repeatOf: "",
      // No obsApproval key: its absence is what marks an observation approved (obsIsApproved),
      // which is what puts it in the owner's portal.
      raisedBy: headUser?.id || "",
      raisedByName: headUser?.name || String(current.signOffName || "Awa Michael"),
      raisedAt: (reportDate || "2026-01-01") + "T00:00:00.000Z",
      createdAt: (reportDate || "2026-01-01") + "T00:00:00.000Z",
      ownerResponse: f.closureAction.trim(),
      ownerRectifiedBy: ownerActed ? ownerUserId(owner) : "",
      ownerRectifiedByName: f.closureAction.trim() ? owner.name : "",
      ownerRectifiedAt: ownerActed ? closureAt : "",
      ownerResponseEvidence: [],
      // Internal Audit is the Head; she is both the verifying auditor and the sign-off, so both
      // steps carry her name. `verifiedBy` is the display field the closure package reads.
      reportVerifiedBy: closed ? headUser?.id || "" : "",
      reportVerifiedByName: closed ? headName : "",
      reportVerifiedAt: closed ? closureAt : "",
      headVerifiedBy: closed ? headUser?.id || "" : "",
      headVerifiedByName: closed ? headName : "",
      headVerifiedAt: closed ? closureAt : "",
      verifiedBy: closed ? headName : "",
      closureRejection: null,
      notes: [],
      updates: [],
    };
  }

  /* ---------------------------------------------------------------------- 5. dry-run report */

  const preview = build();
  const built = preview.db;
  const builtAudits = built.audits as Record<string, unknown>[];
  const obsCount = builtAudits.reduce(
    (n, a) => n + ((a.reports as Record<string, unknown>[]) || []).reduce((m, r) => m + ((r.observations as unknown[]) || []).length, 0),
    0,
  );

  section("Users", existingUsers.length + OWNERS.length);
  table([
    ...existingUsers.map((u) => ({
      action: u.email.toLowerCase() === HEAD_EMAIL ? "KEEP" : "DELETE",
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active ? "yes" : "no",
    })),
    ...OWNERS.map((o) => ({ action: "CREATE", name: o.name, email: o.email, role: "action_owner", active: "no — inactive" })),
  ], { name: 26, email: 30 });
  console.log(
    "\n  New accounts are created INACTIVE and are not emailed. The Head of Audit making an\n" +
      "  account active is what sends its welcome email (once) — PATCH /api/users/:id.",
  );

  section("Audits loaded from AUDIT PLAN", builtAudits.length);
  table(
    builtAudits.map((a) => {
      const reports = (a.reports as Record<string, unknown>[]) || [];
      const n = reports.reduce((m, r) => m + ((r.observations as unknown[]) || []).length, 0);
      return {
        period: String(a.period),
        audit: String(a.name),
        status: String(a.status),
        "report date": String(reports[0]?.reportDateISO || "—"),
        ref: String(reports[0]?.refNo || "—"),
        obs: String(n),
      };
    }),
    { audit: 58 },
  );

  section("Observations by action owner", obsCount);
  table(
    OWNERS.map((o) => {
      const mine = findings.filter((f) => ownerByLabel.get(normLabel(f.ownerLabel)) === o);
      return {
        owner: o.name,
        "workbook label": o.label,
        department: o.department,
        internal: String(mine.length),
        open: String(mine.filter((f) => f.status.trim() !== "Closed").length),
      };
    }).filter((r) => r.internal !== "0"),
    { "workbook label": 30, department: 32 },
  );

  // The closure trail is the part a reader is most likely to challenge, so show it explicitly
  // rather than leaving it implied by a count.
  const allBuiltObs = builtAudits.flatMap((a) =>
    ((a.reports as Record<string, unknown>[]) || []).flatMap((r) => (r.observations as BuiltObs[]) || []),
  );
  const closedObs = allBuiltObs.filter((o) => o.status === "Closed");
  const closureDates = closedObs.map((o) => String(o.closedDateISO)).filter(Boolean).sort();
  section("Closure trail on closed observations", closedObs.length);
  table([
    { fact: "Closure date", value: "the workbook's Expected Closure Date", count: `${closureDates.length} of ${closedObs.length} dated` },
    { fact: "Date range", value: `${closureDates[0] || "—"} → ${closureDates[closureDates.length - 1] || "—"}`, count: `${new Set(closureDates).size} distinct dates` },
    { fact: "Auditor verified / signed off by", value: String(closedObs[0]?.headVerifiedByName || "—"), count: `${closedObs.filter((o) => o.headVerifiedAt).length} stamped` },
    { fact: "Owner action on record", value: "from the Closure Action column", count: `${closedObs.filter((o) => o.ownerRectifiedAt).length} stamped` },
  ], { fact: 34, value: 40 });
  console.log(
    "\n  Open observations get none of these stamps, including the two that carry a Closure\n" +
      "  Action — stamping those would put them in the Ready-for-closure queue.",
  );

  // Using the target date as the closure date has one consequence worth stating plainly: a
  // target that has not yet arrived becomes a closure recorded in the future. Nothing in the app
  // breaks — overdue skips closed items and ageing floors at zero — but a Board pack showing an
  // observation closed next month is the kind of thing a reader stops on.
  const todayIso = new Date().toISOString().slice(0, 10);
  const futureClosed = closedObs.filter((o) => String(o.closedDateISO) > todayIso);
  if (futureClosed.length) {
    section(`Closed observations dated AFTER today (${todayIso})`, futureClosed.length);
    table(
      futureClosed.map((o) => ({
        ref: String(o.ref),
        "closure date": String(o.closedDateISO),
        timeline: String(o.timeline),
        owner: String(o.owner),
        title: String(o.title).slice(0, 44),
      })),
      { title: 46, owner: 28 },
    );
    console.log(
      "\n  These are the long-timeline findings: the workbook marks them Closed while their\n" +
        "  Expected Closure Date is still ahead. Loaded exactly as the workbook states them —\n" +
        "  say the word and I will cap them at the date the register was handed over instead.",
    );
  }

  const ext = built.extFindings as Record<string, unknown>[];
  section("External findings", ext.length);
  table(
    [...groupBy(ext, (f) => `${String(f.sourceRef)}`)].map(([k, list]) => ({
      "external audit": k,
      source: String(list[0].source),
      findings: String(list.length),
      open: String(list.filter((f) => f.status !== "Closed").length),
    })),
    { "external audit": 34 },
  );

  const recips = (built.exco as Record<string, unknown>).recipientList as Record<string, unknown>[];
  section("MD & EXCO brief recipients", recips.length);
  table(
    recips.map((r) => ({
      name: String(r.name || ""),
      role: String(r.role || ""),
      email: String(r.email || ""),
      "app account": "none — the brief is a tokenised link",
    })),
    { role: 44, "app account": 36 },
  );

  section("Audit universe (carried over, re-linked)", preview.relinked.length);
  table(preview.relinked, { unit: 50, to: 34 });

  if (dateSpread.length) {
    section("Audits whose findings imply more than one report date", dateSpread.length);
    table(dateSpread, { audit: 50, others: 34 });
  }

  if (periodMismatch.size) {
    section("Period column disagrees with the audit's plan quarter", periodMismatch.size);
    table(
      [...periodMismatch].map(([audit, e]) => ({
        audit,
        "plan says": e.auditPeriod,
        "findings say": [...e.findingPeriods].join(", "),
        rows: String(e.n),
      })),
      { audit: 50 },
    );
    console.log(
      "\n  The audit NAME decides where a finding is filed — it is the only real link between the\n" +
        "  sheets. A late-reported engagement is the usual explanation; no data is changed.",
    );
  }

  const completedNoReport = builtAudits.filter(
    (a) => a.status === "Completed" && !((a.reports as unknown[]) || []).length,
  );
  if (completedNoReport.length) {
    section("Completed audits with no findings in the workbook", completedNoReport.length);
    table(completedNoReport.map((a) => ({ period: String(a.period), audit: String(a.name) })), { audit: 58 });
    console.log(
      "\n  Loaded as completed engagements with no report attached. A report is not invented for\n" +
        "  them — an empty one would read as an issued clean opinion.",
    );
  }

  /* --- what the workbook cannot tell us --- */
  const closedExt = ext.filter((f) => f.status === "Closed").length;
  gaps.push(
    `The ${closedExt} closed external findings have no closure date and no sign-off. The external ` +
      `sheet has no date column at all, so unlike the internal register there is nothing to date ` +
      `them from — these need a date and a verifier set by hand.`,
    `The ${ext.filter((f) => f.status !== "Closed").length} open external findings have no target date — ` +
      `the external sheet has no such column — so none of them can register as overdue until one is set.`,
    `External findings are graded "Deficiency"/"Observation", not High/Medium/Low. Loaded as Medium ` +
      `(Low for "Observation"), with the workbook's own word kept on each record.`,
    `Audit-plan engagements carry no lead auditor and no scope; both are blank on all ${builtAudits.length}.`,
  );
  section("Gaps the workbook does not fill", gaps.length);
  for (const g of gaps) console.log(`  · ${g}`);

  if (warnings.length) {
    section("Warnings", warnings.length);
    for (const w of warnings) console.log(`  [${w.area}] ${w.detail}`);
  }

  section("Workspace reset", 1);
  const kept = ["audits (rebuilt)", "extFindings (rebuilt)", "departments (rebuilt)", "auditUniverse (carried over)", "org / sign-off", "ExCo recipient list"];
  const cleared = ["notifications", "approvals", "fraudRisks", "fraudPlanNarrative", "processReviews", "iaSAList", "iaSA", "ExCo briefs & send history", "caeReport", "lastBackup"];
  console.log(`  Kept:    ${kept.join(", ")}`);
  console.log(`  Cleared: ${cleared.join(", ")}`);
  console.log(`  Audit log: ${logCount} row(s) deleted.`);

  console.log(
    `\n  RESULT: ${builtAudits.length} audits · ${builtAudits.reduce((n, a) => n + ((a.reports as unknown[]) || []).length, 0)} reports · ` +
      `${obsCount} observations · ${ext.length} external findings · ${departments.length} departments · ${OWNERS.length} owner accounts.`,
  );

  if (obsCount !== findings.length) {
    throw new Error(`Built ${obsCount} observations from ${findings.length} workbook rows — refusing to write.`);
  }

  /* ------------------------------------------------------------------------ 6. apply */

  if (!ctx.apply) {
    console.log(
      `\nDRY RUN — nothing written.\n` +
        `Review the report above, then re-run with:  npx tsx scripts/${NAME}.mts --apply\n` +
        `--apply DELETES the existing workspace, ${existingUsers.length - 1} user account(s) and ${logCount} audit-log\n` +
        `row(s). A full snapshot is written to scripts/.snapshots/ first.`,
    );
    return;
  }

  // Snapshot everything that is about to be destroyed — this file is the only way back.
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotFile = path.join(SNAPSHOT_DIR, `${NAME}-${stamp}.json`);
  fs.writeFileSync(
    snapshotFile,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        note: "Pre-go-live state. workspace = WorkspaceData.data, users = full User rows, auditLog = full AuditLog rows.",
        workspace: current,
        users: await prisma.user.findMany(),
        auditLog: await prisma.auditLog.findMany(),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`\n  Snapshot written: ${path.relative(ROOT, snapshotFile)} (${(fs.statSync(snapshotFile).size / 1024 / 1024).toFixed(1)} MB)`);

  // Users. The Head of Audit's own row is left completely untouched.
  const head = existingUsers.find((u) => u.email.toLowerCase() === HEAD_EMAIL);
  if (!head) {
    throw new Error(
      `No account for ${HEAD_EMAIL} — that is the one row this migration preserves, and without ` +
        `it nobody could sign in afterwards. Nothing has been changed.`,
    );
  }
  const deleted = await prisma.user.deleteMany({ where: { email: { not: head.email } } });
  console.log(`  Deleted ${deleted.count} user account(s); kept ${head.name} <${head.email}>.`);

  userIdByEmail = new Map();
  for (const o of OWNERS) {
    const u = await prisma.user.create({
      data: {
        name: o.name,
        email: o.email,
        department: o.department,
        role: "action_owner",
        sidebarAccess: [],
        active: false, // no welcome email — the Head's activation sends it
      },
    });
    userIdByEmail.set(o.email, u.id);
  }
  console.log(`  Created ${OWNERS.length} action-owner account(s), all inactive and un-emailed.`);

  const clearedLogs = await prisma.auditLog.deleteMany({});
  console.log(`  Cleared ${clearedLogs.count} audit-log row(s).`);

  // Rebuild with the real user ids now in hand, then write.
  const final = build();
  for (const d of final.db.departments as Record<string, unknown>[]) {
    d.headUserId = userIdByEmail.get(String(d.headEmail)) || "";
  }

  const stillPlaceholder = JSON.stringify(final.db).includes("(new: ");
  if (stillPlaceholder) throw new Error("Internal error: unresolved owner id placeholder — not written.");

  await prisma.workspaceData.upsert({
    where: { id: WORKSPACE_ID },
    update: { data: final.db as never },
    create: { id: WORKSPACE_ID, data: final.db as never },
  });
  console.log(`  Workspace document written (${(JSON.stringify(final.db).length / 1024).toFixed(0)} KB).`);

  console.log(
    `\nDone. Next steps:\n` +
      `  1. Settings → User access management: make each action owner active. That is what sends\n` +
      `     their welcome email — one per person, only on the first activation.\n` +
      `  2. Set target dates on the open external findings (the workbook has none).\n` +
      `  3. Link the one repeat finding to the prior observation it recurs from.\n` +
      `  4. Restart any running instance — the app caches nothing, but a stale Prisma client will\n` +
      `     not know about the welcomeEmailSentAt column.`,
  );
}

/* ---------------------------------------------------------------------------------- helpers */

function sheetNamed(sheets: Sheet[], name: string): Sheet {
  const s = sheets.find((x) => x.name.toUpperCase() === name.toUpperCase());
  if (!s) {
    throw new Error(`The workbook has no "${name}" sheet. Found: ${sheets.map((x) => x.name).join(", ")}.`);
  }
  return s;
}

/** Existing recipients first, then any MD/ED not already present. Matched on email, since that
 *  is the address the brief is actually sent to and the only field that must be unique. */
function mergeRecipients(
  existing: Record<string, unknown>[],
  add: { name: string; role: string; email: string }[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = existing.map((r) => ({ ...r }));
  const seen = new Set(out.map((r) => String(r.email || "").toLowerCase()));
  for (const r of add) {
    if (seen.has(r.email.toLowerCase())) continue;
    out.push({ id: stableId("exco", r.email), name: r.name, role: r.role, email: r.email });
    seen.add(r.email.toLowerCase());
  }
  return out as Record<string, unknown>[];
}

function groupBy<T>(items: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    out.set(k, [...(out.get(k) || []), item]);
  }
  return out;
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { getPrisma: gp } = await import("./_migration.mjs");
    const prisma = await gp().catch(() => null);
    await prisma?.$disconnect();
  });
