// QA defect #8 — dueDate stored in two incompatible formats.
//
// Some records hold ISO ("2026-07-20", written by the <input type="date"> in the observation
// dialog) and some hold free text ("14 October 2026", from the legacy import). Both happen to
// parse in V8 today, but free-text date parsing is explicitly implementation-defined in ECMA-262
// — a different engine or locale can read them differently, and every overdue calculation,
// ageing bucket and watchlist in the app depends on this one field.
//
// Parsing here is deliberately EXPLICIT: patterns are matched and the ISO string is assembled
// from the captured parts. No `new Date(freeText)` anywhere, so the migration cannot inherit the
// ambiguity it is trying to remove. Anything that does not match a known unambiguous pattern is
// reported, not guessed — in particular numeric forms like 03/04/2026, where 3 April and 4 March
// are both defensible readings.
//
//   npx tsx scripts/normalise-duedates.mts            (dry run)
//   npx tsx scripts/normalise-duedates.mts --apply

import {
  eachObservation,
  heading,
  outcome,
  parseArgs,
  readWorkspace,
  section,
  table,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "normalise-duedates";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2200) return false;
  const days = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this one
  return d <= days;
}

type Parsed = { iso: string } | { error: string };

function parseDate(raw: string): Parsed {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return { error: "empty" };
  if (ISO.test(s)) return { iso: s };

  // ISO datetime — keep the date part only.
  const dt = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (dt) return { iso: dt[1] };

  // "14 October 2026", "14 Oct 2026", "14th October 2026"
  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+),? (\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    const d = Number(m[1]);
    const y = Number(m[3]);
    if (mon && valid(y, mon, d)) return { iso: `${y}-${pad(mon)}-${pad(d)}` };
    return { error: `unrecognised month or impossible date: "${s}"` };
  }

  // "October 14, 2026", "Oct 14 2026"
  m = s.match(/^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (mon && valid(y, mon, d)) return { iso: `${y}-${pad(mon)}-${pad(d)}` };
    return { error: `unrecognised month or impossible date: "${s}"` };
  }

  // Numeric forms are genuinely ambiguous — 03/04/2026 is 3 April or 4 March depending on who
  // typed it. Refuse rather than pick one and silently move an audit deadline.
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) {
    return { error: `ambiguous day/month order: "${s}" — set this one by hand` };
  }

  return { error: `unrecognised date format: "${s}"` };
}

async function main() {
  const ctx = parseArgs();
  heading(`QA-8 — normalise dueDate to ISO 8601${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const db: Workspace = await readWorkspace();
  const before: Workspace = JSON.parse(JSON.stringify(db));
  const all = eachObservation(db);

  const converted: Record<string, string>[] = [];
  const failed: Record<string, string>[] = [];
  let alreadyIso = 0;
  let empty = 0;

  for (const r of all) {
    const raw = String(r.obs.dueDate ?? "").trim();
    if (!raw) {
      empty++;
      continue;
    }
    if (ISO.test(raw)) {
      alreadyIso++;
      continue;
    }
    const parsed = parseDate(raw);
    const locator = `${String(r.obs.ref || "?")} · ${String(r.obs.title || "").slice(0, 34)}`;
    if ("iso" in parsed) {
      converted.push({ where: locator, from: raw, to: parsed.iso });
      r.obs.dueDate = parsed.iso;
    } else {
      failed.push({ where: locator, value: raw, problem: parsed.error });
    }
  }

  console.log(
    `\n  ${all.length} observation(s): ${alreadyIso} already ISO, ${empty} with no due date, ` +
      `${converted.length} convertible, ${failed.length} needing a human.`,
  );

  if (converted.length) {
    section("Will be converted", converted.length);
    table(converted, { where: 40 });
  }
  if (failed.length) {
    section("Could NOT be converted safely", failed.length);
    table(failed, { where: 40, problem: 52 });
    console.log("\n  Set these from the date picker in the observation dialog.");
  }

  // closedDateISO is named for its format; check the invariant actually holds.
  const badClosed = all.filter((r) => {
    const v = String(r.obs.closedDateISO ?? "").trim();
    return v && !ISO.test(v) && !/^\d{4}-\d{2}-\d{2}[T ]/.test(v);
  });
  if (badClosed.length) {
    section("closedDateISO values that are not ISO", badClosed.length);
    table(
      badClosed.map((r) => ({
        where: `${String(r.obs.ref || "?")} · ${String(r.obs.title || "").slice(0, 34)}`,
        value: String(r.obs.closedDateISO),
      })),
      { where: 40 },
    );
  } else {
    console.log("\n  closedDateISO: all values are ISO. No action needed.");
  }

  if (ctx.apply && converted.length) await writeWorkspace(before, db, NAME);
  outcome(ctx, converted.length, NAME);
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
