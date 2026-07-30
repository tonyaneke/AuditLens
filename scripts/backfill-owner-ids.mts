// QA defect #3 — "Remind owners" cannot reach the majority of open action owners.
//
// Root cause: observations carry TWO owner fields. `ownerUserId` is the foreign key to
// prisma.User and is what every notification path routes on; `owner` is a free-text display
// string. In the legacy data `owner` holds JOB TITLES ("CHIEF FINANCIAL OFFICER"), not people,
// and `ownerUserId` is absent — so the reminder dialog has nothing to send to.
//
// This migration resolves those job titles to real AuditLens user accounts and writes the
// foreign key, via:
//     observation.owner  →  STAFF_DIRECTORY job title  →  person  →  staffEmail()  →  User row
//
// It is deliberately conservative. Only unambiguous matches are applied; anything doubtful is
// printed for a human to decide, because assigning an audit action to the wrong person is worse
// than leaving it unassigned.
//
//   npx tsx scripts/backfill-owner-ids.mts            (dry run)
//   npx tsx scripts/backfill-owner-ids.mts --apply

import { STAFF_DIRECTORY, staffEmail } from "../components/settings/staff";
import {
  eachObservation,
  getPrisma,
  heading,
  outcome,
  parseArgs,
  readWorkspace,
  section,
  table,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "backfill-owner-ids";

// Only structural filler is dropped. Words that carry meaning — CHIEF, HEAD, OFFICER — are
// kept, because dropping them collapses "Chief Financial Officer" onto any finance role.
const STOPWORDS = new Set(["OF", "THE", "AND", "TO", "FOR", "DEPT", "DEPARTMENT", "UNIT"]);

function tokens(raw: string): Set<string> {
  return new Set(
    String(raw || "")
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** ≥ this is treated as the same role and applied automatically. */
const AUTO = 0.85;
/** Between REVIEW and AUTO the match is printed as a suggestion but never applied. */
const REVIEW = 0.4;

type DirUser = { id: string; name: string; email: string; department: string; active: boolean };

type Match = {
  user: DirUser | null;
  score: number;
  via: string;
  /** Set when the job title resolved to a person who has no AuditLens account. */
  missingAccount?: string;
};

function resolve(ownerText: string, users: DirUser[]): Match {
  const want = tokens(ownerText);
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  // 1. The owner text is already a person's name.
  for (const u of users) {
    if (jaccard(want, tokens(u.name)) === 1) {
      return { user: u, score: 1, via: "exact name match" };
    }
  }

  // 2. The owner text is a job title in the staff directory.
  let best: { entry: (typeof STAFF_DIRECTORY)[number]; score: number } | null = null;
  for (const entry of STAFF_DIRECTORY) {
    const score = jaccard(want, tokens(entry[1]));
    if (!best || score > best.score) best = { entry, score };
  }
  if (best && best.score >= REVIEW) {
    const [personName, jobTitle] = best.entry;
    const email = staffEmail(personName);
    const user = byEmail.get(email.toLowerCase()) || null;
    if (user) {
      return { user, score: best.score, via: `job title "${jobTitle}" → ${personName}` };
    }
    return {
      user: null,
      score: best.score,
      via: `job title "${jobTitle}" → ${personName}`,
      missingAccount: `${personName} <${email}>`,
    };
  }

  return { user: null, score: best?.score ?? 0, via: "no candidate" };
}

async function main() {
  const ctx = parseArgs();
  heading(`QA-3 — backfill observation.ownerUserId${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const prisma = await getPrisma();
  const users: DirUser[] = (
    await prisma.user.findMany({
      select: { id: true, name: true, email: true, department: true, active: true },
      orderBy: { name: "asc" },
    })
  ).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    department: u.department,
    active: u.active,
  }));
  const active = users.filter((u) => u.active);
  console.log(`\n  Directory: ${users.length} user(s), ${active.length} active.`);

  const db: Workspace = await readWorkspace();
  // Kept for the pre-migration snapshot: `db` is mutated in place below.
  const before: Workspace = JSON.parse(JSON.stringify(db));
  const all = eachObservation(db);
  const missing = all.filter((r) => !r.obs.ownerUserId);
  const open = missing.filter((r) => String(r.obs.status || "Open") !== "Closed");

  console.log(
    `  Observations: ${all.length} total, ${missing.length} with no ownerUserId ` +
      `(${open.length} of them still open — these are the ones reminders cannot reach).`,
  );

  if (!missing.length) {
    outcome(ctx, 0, NAME);
    return;
  }

  // Resolve once per distinct owner string rather than per observation.
  const distinct = new Map<string, { count: number; openCount: number }>();
  for (const r of missing) {
    const key = String(r.obs.owner || "").trim();
    const cur = distinct.get(key) || { count: 0, openCount: 0 };
    cur.count++;
    if (String(r.obs.status || "Open") !== "Closed") cur.openCount++;
    distinct.set(key, cur);
  }

  const applied: Record<string, string>[] = [];
  const review: Record<string, string>[] = [];
  const noAccount: Record<string, string>[] = [];
  const unmatched: Record<string, string>[] = [];
  const decision = new Map<string, DirUser>();

  for (const [ownerText, stats] of [...distinct.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const row = {
      owner: ownerText || "(blank)",
      obs: String(stats.count),
      open: String(stats.openCount),
    };
    if (!ownerText) {
      unmatched.push({ ...row, reason: "no owner text to match on" });
      continue;
    }
    const m = resolve(ownerText, active);
    if (m.user && m.score >= AUTO) {
      decision.set(ownerText, m.user);
      applied.push({ ...row, "→ user": `${m.user.name} <${m.user.email}>`, via: m.via });
    } else if (m.missingAccount) {
      noAccount.push({
        ...row,
        "would map to": m.missingAccount,
        confidence: m.score >= AUTO ? "high" : "CONFIRM",
        score: m.score.toFixed(2),
      });
    } else if (m.user) {
      review.push({
        ...row,
        "best guess": `${m.user.name} <${m.user.email}>`,
        score: m.score.toFixed(2),
        via: m.via,
      });
    } else {
      unmatched.push({ ...row, reason: m.via });
    }
  }

  if (applied.length) {
    section("Confident matches — will be applied", applied.length);
    table(applied, { via: 44 });
  }
  if (review.length) {
    section("Ambiguous — NOT applied, confirm by hand", review.length);
    table(review, { via: 44 });
    console.log(
      "\n  These scored below the auto-apply threshold. Assign them in the app, or add the\n" +
        "  exact job title to STAFF_DIRECTORY in components/settings/staff.ts and re-run.",
    );
  }
  if (noAccount.length) {
    section("Resolved to a person with no AuditLens account", noAccount.length);
    table(noAccount);
    console.log("\n  Create these users under Settings → User access, then re-run.");
  }
  if (unmatched.length) {
    section("No candidate found", unmatched.length);
    table(unmatched, { reason: 40 });
  }

  let changed = 0;
  for (const r of missing) {
    const user = decision.get(String(r.obs.owner || "").trim());
    if (!user) continue;
    r.obs.ownerUserId = user.id;
    // Keep the display string in step with the person it now points at; the job title is
    // preserved on the record so the original assignment is still auditable.
    r.obs.ownerJobTitle = r.obs.owner;
    r.obs.owner = user.name;
    changed++;
  }

  const stillOpen = open.filter((r) => !r.obs.ownerUserId).length;
  console.log(
    `\n  After this migration: ${stillOpen} open observation(s) would still have no owner ` +
      `and remain unreachable by reminders.`,
  );

  if (ctx.apply && changed) await writeWorkspace(before, db, NAME);
  outcome(ctx, changed, NAME);
}

main()
  .catch((e) => {
    console.error("\nMigration failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = await getPrisma().catch(() => null);
    await prisma?.$disconnect();
  });
