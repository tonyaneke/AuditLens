// QA defects #10 and #22 — report only, by design.
//
// Both describe records that are wrong in a way a script must not silently correct:
//
//   #10  Observations with a target date on or before their creation date. They were created
//        already overdue, which distorts the overdue KPI and the ageing profile reported to the
//        Audit Committee. The correct new target date is a decision between the audit team and
//        the action owner — not something to invent.
//   #22  Findings flagged as a repeat with no prior reference. Clearing the flag would be the
//        easy fix and the wrong one: the finding really is a repeat, and repeat rate is an Audit
//        Committee metric. What is missing is the link to the original.
//
// New records of both kinds are now rejected at the point of entry by validateObservation() in
// lib/workspace/obs-validation.ts. This script lists what is already stored so it can be worked.
//
//   npx tsx scripts/report-data-quality.mts

import {
  eachObservation,
  heading,
  parseArgs,
  readWorkspace,
  section,
  table,
  type Workspace,
} from "./_migration.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}/;

function dayOf(v: unknown): string {
  const s = String(v ?? "").trim();
  return ISO.test(s) ? s.slice(0, 10) : "";
}

async function main() {
  parseArgs();
  heading("QA-10 / QA-22 — data quality report (read only)");

  const db: Workspace = await readWorkspace();
  const all = eachObservation(db);

  /* ---- QA-10: created already overdue ---- */
  const bornOverdue = all
    .map((r) => {
      const due = dayOf(r.obs.dueDate);
      const created = dayOf(r.obs.createdAt);
      return { r, due, created };
    })
    .filter((x) => x.due && x.created && x.due <= x.created);

  // Free-text dates cannot be compared safely, so they are excluded from the check rather than
  // parsed with new Date(). That means this count UNDERSTATES the problem until QA-8 has run.
  const nonIsoDue = all.filter((r) => {
    const raw = String(r.obs.dueDate ?? "").trim();
    return raw && !ISO.test(raw);
  }).length;

  section("QA-10 — target date on or before the creation date", bornOverdue.length);
  if (nonIsoDue) {
    console.log(
      `  NOTE: ${nonIsoDue} observation(s) still hold a free-text target date and are excluded\n` +
        "  from this check — the count below is therefore a floor, not the total. Run\n" +
        "  scripts/normalise-duedates.mts --apply first, then re-run this report.\n",
    );
  }
  if (bornOverdue.length) {
    table(
      bornOverdue.map(({ r, due, created }) => ({
        ref: String(r.obs.ref || "?"),
        title: String(r.obs.title || "").slice(0, 42),
        created,
        due,
        status: String(r.obs.status || "Open"),
      })),
      { title: 44 },
    );
    console.log(
      "\n  Each of these was created already past its target date. Agree a realistic target with\n" +
        "  the action owner and set it from the date picker; the dialog now rejects a target that\n" +
        "  is not after the report date.",
    );
  } else {
    console.log("  None. ✓");
  }

  /* ---- QA-22: repeat with no prior reference ---- */
  const repeats = all.filter((r) => r.obs.isRepeat);
  const unlinked = repeats.filter((r) => !String(r.obs.repeatOf || "").trim());

  section("QA-22 — repeat findings with no prior reference", unlinked.length);
  console.log(`  ${repeats.length} finding(s) are flagged as repeats.`);
  if (unlinked.length) {
    table(
      unlinked.map((r) => ({
        ref: String(r.obs.ref || "?"),
        title: String(r.obs.title || "").slice(0, 46),
        audit: r.auditName.slice(0, 28),
        status: String(r.obs.status || "Open"),
      })),
      { title: 48, audit: 30 },
    );
    console.log(
      "\n  Open each one and set the prior reference it recurs from. Do not clear the repeat flag\n" +
        "  to make the warning go away — repeat rate is reported to the Audit Committee.",
    );
  } else {
    console.log("  None. ✓");
  }

  /* ---- Supporting counts, so the report stands alone as evidence ---- */
  const withDue = all.filter((r) => dayOf(r.obs.dueDate)).length;
  const noDue = all.length - withDue;
  console.log(
    `\n  Population: ${all.length} observation(s) · ${withDue} with a target date · ${noDue} without.`,
  );
  console.log("\nRead-only — this script never writes.");
}

main()
  .catch((e) => {
    console.error("\nReport failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { getPrisma } = await import("./_migration.mjs");
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
