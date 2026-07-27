"use client";

// Port of engStatusSummary(): "⏳ Pending approval" while a completion approval is open,
// otherwise the done/total quarter count.

import {
  engIsComplete,
  pendingCompletion,
  unitOccDone,
  unitOccTotal,
} from "@/lib/workspace/ra";
import type { AuditUniverseUnit } from "@/lib/workspace/types";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";

export default function EngagementStatusPill({ unit }: { unit: AuditUniverseUnit }) {
  const { db } = useWorkspace();
  if (pendingCompletion(db, unit.id)) {
    return <span className="pill ra-pending-pill">⏳ Pending approval</span>;
  }
  const total = unitOccTotal(unit);
  const done = unitOccDone(unit);
  return (
    <span className={`pill ra-quarter-pill${engIsComplete(unit) ? " done" : ""}`}>
      {done}/{total} quarter{total !== 1 ? "s" : ""}
    </span>
  );
}
