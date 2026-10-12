"use client";

import { awaitingLabel, requestAwaiting } from "@/lib/workspace/audit-comms";
import type { AuditRequest } from "@/lib/workspace/types";

/** Whose move it is: the department's (red, like an open item), Internal Audit's (amber), or closed. */
export function AwaitingPill({ r }: { r: AuditRequest }) {
  const w = requestAwaiting(r);
  const cls = w === "closed" ? "closed" : w === "dept" ? "open" : "progress";
  return <span className={`status-pill ${cls}`}>{awaitingLabel(r)}</span>;
}

export function KindTag({ r }: { r: AuditRequest }) {
  // A department's thread is stored as kind "clarification" and shown as what it is to them: a comment.
  return <span className="tag">{r.kind === "information" ? "Information request" : "Comment"}</span>;
}
