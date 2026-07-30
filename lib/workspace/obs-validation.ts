// Observation reference generation and field validation.
//
// Covers QA defects #9 (references were not unique), #10 (due dates on or before the creation
// date) and #22 (repeat findings with no prior reference). All three had the same shape: the
// field was free-form, nothing generated it and nothing checked it, so bad values entered
// through whichever dialog the user happened to use and were only noticed later by an auditor.
//
// Everything here is pure — no workspace mutation, no React — so the same rules apply to the
// observation dialogs, the raise flow and the CSV import path without being written three times.

import type { Observation, Report, WorkspaceDb } from "./types";

/* ------------------------------------------------------------------------------ references */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every observation reference currently in use, anywhere in the workspace.
 *
 * Deliberately workspace-wide rather than per-report: the existing scheme is a global running
 * counter (1.1, 2.1, … 86.1), references are cited in Board papers without their report, and a
 * duplicate across two reports is exactly as ambiguous as one within a report. */
export function usedObsRefs(db: WorkspaceDb, exceptObsId?: string): Set<string> {
  const used = new Set<string>();
  (db.audits || []).forEach((a) =>
    (a.reports || []).forEach((r) =>
      (r.observations || []).forEach((o) => {
        if (exceptObsId && o.id === exceptObsId) return;
        const ref = String(o.ref || "").trim();
        if (ref) used.add(ref.toLowerCase());
      }),
    ),
  );
  return used;
}

/** Next free observation reference, following the existing `N.1` counter.
 *
 * Modelled on nextReportRef() / extNextRef(), both of which already generate with a collision
 * loop. Observations were the one entity still typed by hand — with `e.g. 1.1` as the
 * placeholder, which is how "1.1" ended up used eleven times. */
export function nextObsRef(db: WorkspaceDb): string {
  const used = usedObsRefs(db);
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

/* ------------------------------------------------------------------------------ validation */

export type ObsDraft = {
  ref?: string;
  dueDate?: string;
  createdAt?: string;
  isRepeat?: boolean;
  repeatOf?: string;
};

export type FieldError = { field: keyof ObsDraft; message: string };

/** The report date an observation is measured from — a target before this is meaningless. */
export function reportBaseDate(r: Report | undefined, createdAt?: string): string {
  const iso = String(r?.reportDateISO || "").trim();
  if (ISO_DATE.test(iso)) return iso;
  const created = String(createdAt || "").trim();
  return created ? created.slice(0, 10) : "";
}

/**
 * Validate the fields the QA register found unguarded. Returns every problem rather than the
 * first, so a dialog can show them all at once instead of making the user resubmit repeatedly.
 *
 * `existingRefs` should come from usedObsRefs(db, currentObsId) — passing the current
 * observation's id keeps an edit that leaves the reference untouched from failing against itself.
 */
export function validateObservation(
  draft: ObsDraft,
  opts: { existingRefs?: Set<string>; baseDate?: string } = {},
): FieldError[] {
  const errors: FieldError[] = [];
  const ref = String(draft.ref || "").trim();

  // QA-9 — references are how findings are cited in Board papers and tracked across periods.
  if (!ref) {
    errors.push({ field: "ref", message: "Reference is required." });
  } else if (opts.existingRefs?.has(ref.toLowerCase())) {
    errors.push({
      field: "ref",
      message: `Reference "${ref}" is already used by another observation. References must be unique.`,
    });
  }

  // QA-10 — an action created already overdue distorts the overdue KPI and the ageing profile
  // reported to the Audit Committee.
  const due = String(draft.dueDate || "").trim();
  const base = String(opts.baseDate || "").trim();
  if (due && base && ISO_DATE.test(due) && ISO_DATE.test(base.slice(0, 10)) && due <= base.slice(0, 10)) {
    errors.push({
      field: "dueDate",
      message: `Target date must be after the report date (${base.slice(0, 10)}). An action cannot be created already overdue.`,
    });
  }

  // QA-22 — repeat findings are an Audit Committee metric; an unlinked repeat cannot be traced.
  if (draft.isRepeat && !String(draft.repeatOf || "").trim()) {
    errors.push({
      field: "repeatOf",
      message: "A repeat finding must reference the prior observation it recurs from.",
    });
  }

  return errors;
}

/** Convenience for dialogs: the first message, or "" when the draft is valid. */
export function firstError(errors: FieldError[]): string {
  return errors.length ? errors[0].message : "";
}

/* -------------------------------------------------------------------------- date normalising */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * QA-8 — coerce a date to ISO 8601, or return "" if it cannot be read unambiguously.
 *
 * Explicit pattern matching, never `new Date(freeText)`: free-text date parsing is
 * implementation-defined in ECMA-262, and this field drives every overdue calculation in the
 * app. Numeric forms (03/04/2026) are rejected rather than guessed — day-first and month-first
 * are both defensible and picking one silently moves an audit deadline.
 */
export function toIsoDate(raw: string | undefined | null): string {
  const s = String(raw || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  if (ISO_DATE.test(s)) return s;

  const dt = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (dt) return dt[1];

  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && y >= 1900 && y <= 2200 && d <= new Date(y, m, 0).getDate();

  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]+),? (\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    const d = Number(m[1]);
    const y = Number(m[3]);
    if (mon && ok(y, mon, d)) return `${y}-${pad(mon)}-${pad(d)}`;
    return "";
  }

  m = s.match(/^([A-Za-z]+) (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (mon && ok(y, mon, d)) return `${y}-${pad(mon)}-${pad(d)}`;
  }

  return "";
}

/** For the CSV import: keep the value if it can be normalised, and report it if it cannot. */
export function normaliseImportedDate(raw: string): { value: string; warning?: string } {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { value: "" };
  const iso = toIsoDate(trimmed);
  if (iso) return { value: iso };
  return {
    value: "",
    warning: `could not read the date "${trimmed}" — left blank, set it from the date picker`,
  };
}

export type { Observation };
