// QA defect #9 — observation reference numbers are not unique.
//
// References are how findings are cited in Board papers and tracked across periods, so a
// duplicate makes a citation ambiguous and breaks repeat-finding linkage. Nothing generated
// them and nothing checked them: the Ref field was free text whose placeholder was literally
// "e.g. 1.1", so that example became the reference for many observations.
//
// Going forward this is prevented in lib/workspace/obs-validation.ts (nextObsRef seeds the
// field, validateObservation rejects a collision). This migration cleans up what is already
// stored.
//
// Which duplicate keeps the reference matters: the OLDEST observation keeps it, because it is
// the one already cited in issued reports and Board papers. Later duplicates are reassigned.
//
//   npx tsx scripts/dedupe-obs-refs.mts            (dry run)
//   npx tsx scripts/dedupe-obs-refs.mts --apply

import {
  eachObservation,
  heading,
  outcome,
  parseArgs,
  readWorkspace,
  section,
  table,
  writeWorkspace,
  type ObsRef,
  type Workspace,
} from "./_migration.mjs";

const NAME = "dedupe-obs-refs";

/** Next free reference following the existing `N.1` counter. Mirrors nextObsRef() in
 * lib/workspace/obs-validation.ts — restated here so the migration has no React dependency. */
function nextRef(used: Set<string>): string {
  let max = 0;
  for (const ref of used) {
    const m = ref.match(/^(\d{1,5})\.\d+$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max;
  let ref = "";
  do {
    n++;
    ref = `${n}.1`;
  } while (used.has(ref.toLowerCase()) && n < 99999);
  return ref;
}

function sortKey(r: ObsRef): string {
  // Oldest first. Records with no createdAt sort last so a dated original always wins.
  return String(r.obs.createdAt || "9999");
}

async function main() {
  const ctx = parseArgs();
  heading(`QA-9 — enforce unique observation references${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const db: Workspace = await readWorkspace();
  const before: Workspace = JSON.parse(JSON.stringify(db));
  const all = eachObservation(db);

  const byRef = new Map<string, ObsRef[]>();
  const blank: ObsRef[] = [];
  for (const r of all) {
    const ref = String(r.obs.ref || "").trim();
    if (!ref) {
      blank.push(r);
      continue;
    }
    const key = ref.toLowerCase();
    const list = byRef.get(key) || [];
    list.push(r);
    byRef.set(key, list);
  }

  const dupes = [...byRef.entries()].filter(([, list]) => list.length > 1);
  console.log(
    `\n  ${all.length} observation(s): ${byRef.size} distinct reference(s), ` +
      `${dupes.length} reference(s) used more than once, ${blank.length} with no reference.`,
  );

  // Scheme survey — the register noted several coexisting schemes in one report.
  const schemes = new Map<string, number>();
  for (const key of byRef.keys()) {
    const shape = /^\d+\.\d+$/.test(key)
      ? "N.N (counter)"
      : /^[a-z]+-\d+$/.test(key)
        ? "PREFIX-NNN"
        : /^[a-z]+-\d{4}-\d+$/.test(key)
          ? "PREFIX-YYYY-NNN"
          : /^\d+$/.test(key)
            ? "bare integer"
            : "other";
    schemes.set(shape, (schemes.get(shape) || 0) + 1);
  }
  if (schemes.size > 1) {
    section("Reference schemes in use", schemes.size);
    table(
      [...schemes.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([scheme, count]) => ({ scheme, references: String(count) })),
    );
    console.log("\n  Mixed schemes are not corrected here — that is an editorial decision.");
  }

  const used = new Set(byRef.keys());
  const changes: Record<string, string>[] = [];

  for (const [, list] of dupes) {
    const ordered = [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    // ordered[0] keeps the reference — it is the one already cited externally.
    for (const r of ordered.slice(1)) {
      const old = String(r.obs.ref || "").trim();
      const replacement = nextRef(used);
      used.add(replacement.toLowerCase());
      changes.push({
        from: old,
        to: replacement,
        title: String(r.obs.title || "").slice(0, 40),
        report: r.reportTitle.slice(0, 30),
        created: String(r.obs.createdAt || "—").slice(0, 10),
      });
      r.obs.ref = replacement;
    }
  }

  for (const r of blank) {
    const replacement = nextRef(used);
    used.add(replacement.toLowerCase());
    changes.push({
      from: "(blank)",
      to: replacement,
      title: String(r.obs.title || "").slice(0, 40),
      report: r.reportTitle.slice(0, 30),
      created: String(r.obs.createdAt || "—").slice(0, 10),
    });
    r.obs.ref = replacement;
  }

  if (changes.length) {
    section("References to reassign", changes.length);
    table(changes, { title: 42, report: 32 });
    console.log(
      "\n  The earliest observation keeps the original reference, since it is the one already\n" +
        "  cited in issued reports. Anything reassigned here needs the citation updated in any\n" +
        "  Board paper that already quotes it.",
    );
  }

  if (ctx.apply && changes.length) await writeWorkspace(before, db, NAME);
  outcome(ctx, changes.length, NAME);
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { getPrisma } = await import("./_migration.mjs");
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
