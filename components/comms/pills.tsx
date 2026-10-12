"use client";

import type { AuditRequest } from "@/lib/workspace/types";

export function KindTag({ r }: { r: AuditRequest }) {
  // A department's thread is stored as kind "clarification" and shown as what it is to them: a comment.
  return <span className="tag">{r.kind === "information" ? "Information request" : "Comment"}</span>;
}
