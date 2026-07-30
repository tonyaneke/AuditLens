// QA defect #2 — corrupted characters stored at rest in audit records.
//
// The damage is U+FFFD (the Unicode REPLACEMENT CHARACTER), not classic double-encoded
// mojibake. That distinction matters: with mojibake the original bytes survive and can be
// decoded back exactly. With U+FFFD they do not — the decoder discarded them. Nothing can
// recover the original character with certainty, so this migration does not pretend to.
//
// What it does instead:
//   * Repairs the one unambiguous case — U+FFFD sitting between two letters, which in this
//     corpus is always a right single quotation mark (U+2019): "Corporation<FFFD>s website".
//   * Reports every other occurrence with surrounding context, for a human to correct. These
//     are mostly dashes between words, where the original could have been an em dash, an en
//     dash or a hyphen, and management responses are contractual text — a plausible guess is
//     not good enough.
//
// The re-infection vector is fixed separately in lib/client/csv-encoding.ts: both CSV importers
// read files as UTF-8, so any Excel-authored (CP-1252) file re-introduces this on every import.
//
//   npx tsx scripts/fix-mojibake.mts            (dry run)
//   npx tsx scripts/fix-mojibake.mts --apply

import {
  heading,
  outcome,
  parseArgs,
  readWorkspace,
  section,
  table,
  writeWorkspace,
  type Workspace,
} from "./_migration.mjs";

const NAME = "fix-mojibake";
const BAD = "�";

/* The two rules that are safe to apply without a human.
 *
 * APOSTROPHE — letters on both sides. In this corpus always a possessive or contraction
 *   ("Corporation<FFFD>s website"). No other punctuation appears between two letters.
 * EMDASH — whitespace on both sides. A quotation mark or apostrophe is never surrounded by
 *   spaces, so a space-flanked character can only have been a dash. */
const APOSTROPHE = /(\p{L})�(\p{L})/gu;
const EMDASH = /(\s)�(\s)/gu;

/** Everything else is classified but NOT rewritten — the suggestion is for the reviewer. */
function classify(s: string, idx: number): { kind: string; suggest: string } {
  const prev = idx > 0 ? s[idx - 1] : "";
  const next = idx + 1 < s.length ? s[idx + 1] : "";
  const openish = (!prev || /[\s([]/.test(prev)) && /[\p{L}\p{N}]/u.test(next);
  const closeish = /[\p{L}\p{N}.,;:!?]/u.test(prev) && (!next || /[\s)\].,;:!?]/.test(next));
  if (openish) return { kind: "opening quote", suggest: "“" };
  if (closeish) return { kind: "closing quote / apostrophe", suggest: "” or ’" };
  if (/[\p{N}]/u.test(prev) && /[\p{L}]/u.test(next)) return { kind: "dash", suggest: "—" };
  return { kind: "unclear", suggest: "?" };
}

type Hit = {
  path: string;
  field: string;
  context: string;
  kind: string;
  suggest: string;
  where: string;
};

/** Every string field in the document, with a readable path. Walks arrays and objects alike so
 * no field is missed — the corruption is known to reach exco brief snapshots, not just
 * observations. */
function walkStrings(
  node: unknown,
  path: string,
  visit: (path: string, value: string, set: (next: string) => void) => void,
  setSelf?: (next: string) => void,
): void {
  if (typeof node === "string") {
    if (setSelf) visit(path, node, setSelf);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) =>
      walkStrings(v, `${path}[${i}]`, visit, (next) => {
        node[i] = next;
      }),
    );
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      walkStrings(obj[key], path ? `${path}.${key}` : key, visit, (next) => {
        obj[key] = next;
      });
    }
  }
}

function context(s: string, idx: number): string {
  const from = Math.max(0, idx - 32);
  const to = Math.min(s.length, idx + 33);
  return (from ? "…" : "") + s.slice(from, to).replace(/\s+/g, " ") + (to < s.length ? "…" : "");
}

/** Turn "audits[3].reports[0].observations[7].title" into something a reviewer can search for
 * in the app. A raw JSON path is useless to the person who has to make the correction. */
function locate(db: Workspace, path: string): string {
  const m = path.match(/^audits\[(\d+)\]\.reports\[(\d+)\]\.observations\[(\d+)\]/);
  if (!m) return path.replace(/\[\d+\]/g, "");
  const audits = (db.audits || []) as Record<string, unknown>[];
  const a = audits[Number(m[1])];
  const reports = ((a?.reports || []) as Record<string, unknown>[]) || [];
  const r = reports[Number(m[2])];
  const obs = ((r?.observations || []) as Record<string, unknown>[]) || [];
  const o = obs[Number(m[3])];
  if (!o) return path;
  const ref = String(o.ref || "").trim();
  return `${ref ? `${ref} · ` : ""}${String(o.title || "(untitled)").slice(0, 40)}`;
}

async function main() {
  const ctx = parseArgs();
  heading(`QA-2 — repair corrupted characters${ctx.apply ? " (APPLY)" : " (dry run)"}`);

  const db: Workspace = await readWorkspace();
  const before: Workspace = JSON.parse(JSON.stringify(db));

  let totalBad = 0;
  let repaired = 0;
  const byField = new Map<string, number>();
  const remaining: Hit[] = [];

  walkStrings(db, "", (path, value, set) => {
    if (!value.includes(BAD)) return;

    const occurrences = (value.match(/�/g) || []).length;
    totalBad += occurrences;
    // Field name = last path segment, with array indices dropped, so counts aggregate.
    const field = path.replace(/\[\d+\]/g, "").split(".").pop() || path;
    byField.set(field, (byField.get(field) || 0) + occurrences);

    const fixed = value.replace(APOSTROPHE, "$1’$2").replace(EMDASH, "$1—$2");
    const fixedCount = occurrences - (fixed.match(/�/g) || []).length;
    repaired += fixedCount;
    if (fixed !== value) set(fixed);

    // Anything the two safe rules did not resolve needs a human.
    let idx = fixed.indexOf(BAD);
    while (idx !== -1) {
      const c = classify(fixed, idx);
      remaining.push({
        path,
        field,
        context: context(fixed, idx),
        kind: c.kind,
        suggest: c.suggest,
        where: locate(db, path),
      });
      idx = fixed.indexOf(BAD, idx + 1);
    }
  });

  if (!totalBad) {
    console.log("\n  No U+FFFD replacement characters found.");
    outcome(ctx, 0, NAME);
    return;
  }

  console.log(`\n  Found ${totalBad} corrupted character(s) across ${byField.size} field name(s).`);

  section("By field", byField.size);
  table(
    [...byField.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([field, count]) => ({ field, occurrences: String(count) })),
  );

  section("Repaired automatically", repaired);
  console.log(
    "  letter‹FFFD›letter → ’   (possessives and contractions)\n" +
      "  space‹FFFD›space  → —   (a quote mark is never flanked by spaces)",
  );

  if (remaining.length) {
    section("NOT repaired — needs a human decision", remaining.length);
    table(
      remaining.map((h) => ({
        where: h.where,
        field: h.field,
        likely: h.kind,
        use: h.suggest,
        context: h.context,
      })),
      { context: 62, where: 34, field: 18, likely: 24 },
    );
    console.log(
      "\n  These are mostly paired quotation marks around a quoted term, e.g. classified as\n" +
        "  ‹FFFD›Public‹FFFD› document. The opening and closing forms differ (“ vs ”), and this is\n" +
        "  contractual management-response text, so they are left for a reviewer rather than\n" +
        "  guessed at. Correct them in the app using the location and context above.",
    );
  }

  if (ctx.apply && repaired) await writeWorkspace(before, db, NAME);
  outcome(ctx, repaired, NAME);
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
