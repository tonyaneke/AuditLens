"use client";

// Fire-and-forget client audit-trail entry (port of legacy logAudit).
export function logAudit(
  action: string,
  summary: string,
  metadata?: Record<string, unknown>,
): void {
  if (!summary) return;
  fetch("/api/audit-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, summary, metadata: metadata || undefined }),
  }).catch(() => {});
}
