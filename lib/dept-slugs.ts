import { DEPARTMENTS } from "@/components/settings/staff";
import {
  deptScopeFor,
  inDeptScope,
  type DeptSource,
} from "./dept-scope";
import {
  allObs,
  extList,
  extOverdue,
  isOverdueObs,
  obsIsApproved,
  type ObsWithContext,
} from "./workspace/selectors";
import type { ExtFinding, WorkspaceDb } from "./workspace/types";

/** Convert a canonical department name into a clean, URL-safe slug. */
export function departmentToSlug(name: string): string {
  const norm = String(name || "")
    .trim()
    .replace(/\s+department$/i, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return norm || "department";
}

/** Map from known slugs to canonical department names */
const KNOWN_SLUG_MAP: Record<string, string> = {
  administration: "Administration Department",
  "corporate-communications": "Corporate Communications",
  "credit-operations": "Credit Operations",
  credit: "Credit Operations",
  finance: "Finance",
  "impact-sustainability": "Impact & Sustainability",
  "impact-and-sustainability": "Impact & Sustainability",
  operations: "Impact & Sustainability",
  "internal-audit": "Internal Audit",
  audit: "Internal Audit",
  it: "IT",
  legal: "Legal",
  "office-of-the-managing-director": "Office of the Managing Director",
  omd: "Office of the Managing Director",
  "people-culture": "People & Culture Department",
  "people-and-culture": "People & Culture Department",
  procurement: "Procurement",
  "risk-management": "Risk Management",
  risk: "Risk Management",
  strategy: "Strategy",
};

/** Resolve a slug back to its canonical department name. */
export function slugToDepartment(slug: string, db?: DeptSource): string {
  const s = String(slug || "").toLowerCase().trim();
  if (KNOWN_SLUG_MAP[s]) return KNOWN_SLUG_MAP[s];

  // Search canonical list
  for (const dept of DEPARTMENTS) {
    if (departmentToSlug(dept) === s) return dept;
  }

  // Search workspace departments if provided
  const depts = Array.isArray(db?.departments)
    ? (db?.departments as Array<{ name?: string }>)
    : [];
  for (const d of depts) {
    if (d?.name && departmentToSlug(d.name) === s) return d.name;
  }

  // Fallback to title-casing the slug with spaces
  return s
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type DepartmentStats = {
  department: string;
  slug: string;
  internal: {
    all: ObsWithContext[];
    done: ObsWithContext[];
    pending: ObsWithContext[];
    overdue: ObsWithContext[];
  };
  external: {
    all: ExtFinding[];
    done: ExtFinding[];
    pending: ExtFinding[];
    overdue: ExtFinding[];
  };
  totals: {
    total: number;
    done: number;
    pending: number;
    overdue: number;
    rate: number;
  };
  health: "good" | "in_progress" | "attention";
};

/** Compute complete governance statistics for a department's internal and external findings. */
export function getDepartmentStats(
  db: WorkspaceDb,
  departmentName: string,
): DepartmentStats {
  const slug = departmentToSlug(departmentName);
  const scope = deptScopeFor(db, departmentName);

  // Internal observations (approved only)
  const approved = allObs(db).filter(obsIsApproved);
  const internalAll = approved.filter((o) => inDeptScope(o, scope));
  const internalDone = internalAll.filter((o) => o.status === "Closed");
  const internalPending = internalAll.filter((o) => o.status !== "Closed");
  const internalOverdue = internalPending.filter((o) => isOverdueObs(o, o._r));

  // External findings
  const externalList = extList(db);
  const externalAll = externalList.filter((f) => inDeptScope(f, scope));
  const externalDone = externalAll.filter((f) => f.status === "Closed");
  const externalPending = externalAll.filter((f) => f.status !== "Closed");
  const externalOverdue = externalPending.filter(extOverdue);

  const total = internalAll.length + externalAll.length;
  const done = internalDone.length + externalDone.length;
  const pending = internalPending.length + externalPending.length;
  const overdue = internalOverdue.length + externalOverdue.length;
  const rate = total > 0 ? Math.round((done / total) * 100) : 100;

  let health: "good" | "in_progress" | "attention" = "in_progress";
  if (total === 0 || (rate >= 80 && overdue === 0)) {
    health = "good";
  } else if (overdue > 0 || rate < 50) {
    health = "attention";
  }

  return {
    department: departmentName,
    slug,
    internal: {
      all: internalAll,
      done: internalDone,
      pending: internalPending,
      overdue: internalOverdue,
    },
    external: {
      all: externalAll,
      done: externalDone,
      pending: externalPending,
      overdue: externalOverdue,
    },
    totals: {
      total,
      done,
      pending,
      overdue,
      rate,
    },
    health,
  };
}
