"use client";

// Audit log (head-only) — React port of viewAuditLog/auditLogTableHTML/refreshAuditLog/
// exportAuditLog. Server-paginated via GET /api/audit-log.

import { useCallback, useEffect, useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { logAudit } from "@/lib/client/audit-log";
import { esc, excelDoc, stamp } from "@/lib/client/exports";
import { Empty } from "@/components/ui";

const AUDIT_LOG_ACTIONS: [string, string][] = [
  ["", "All actions"],
  ["auth.login", "Sign in"],
  ["auth.logout", "Sign out"],
  ["auth.password_changed", "Password changed"],
  ["user.created", "User created"],
  ["user.updated", "User updated"],
  ["user.deactivated", "User made inactive"],
  ["user.reactivated", "User made active"],
  ["user.deleted", "User deleted"],
  ["data.backup_export", "Backup exported"],
  ["data.backup_import", "Backup imported"],
  ["data.reset_all", "All data reset"],
  ["workspace.audit_created", "Audit created"],
  ["workspace.audit_updated", "Audit updated"],
  ["workspace.report_created", "Report created"],
  ["workspace.observation_created", "Observation created"],
  ["workspace.department_removed", "Action owner removed"],
  ["obs.deleted", "Observation deleted"],
  ["obs.delete_requested", "Observation deletion requested"],
  ["obs.delete_approved", "Observation deletion approved"],
  ["obs.delete_rejected", "Observation deletion rejected"],
  ["obs.status_changed", "Observation status changed"],
  ["obs.closed", "Observation closed"],
  ["obs.withdrawn", "Observation withdrawn"],
  ["plan.unit_deleted", "Auditable unit deleted"],
  ["fraud.risk_deleted", "Fraud risk deleted"],
  ["process.review_deleted", "Process review deleted"],
  ["iasa.deleted", "Self-assessment deleted"],
  ["exco.brief_deleted", "EXCO brief deleted"],
];

type LogRow = {
  id: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  action: string;
  actionLabel?: string;
  summary: string;
};

function fmtAuditWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (p: number, actionF: string, qF: string) => {
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams({ page: String(Math.max(1, p)), limit: String(limit) });
      if (actionF) params.set("action", actionF);
      if (qF) params.set("q", qF);
      try {
        const res = await fetch("/api/audit-log?" + params.toString());
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const json = await res.json();
        setLogs(json.logs || []);
        setTotal(json.total || 0);
        setPage(json.page || p);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [limit],
  );

  useEffect(() => {
    // Deferred so the state updates inside load() never run synchronously within the effect.
    const t = setTimeout(() => void load(1, "", ""), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function exportExcel() {
    let p = 1;
    let all: LogRow[] = [];
    let tot = Infinity;
    while (all.length < tot && p <= 100) {
      const params = new URLSearchParams({ page: String(p), limit: "100" });
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      const res = await fetch("/api/audit-log?" + params.toString());
      if (!res.ok) break;
      const json = await res.json();
      tot = json.total || 0;
      const rows: LogRow[] = json.logs || [];
      if (!rows.length) break;
      all = all.concat(rows);
      p++;
    }
    if (!all.length) {
      toast("Nothing to export.", "info");
      return;
    }
    const table = `<table><tr><th>When</th><th>User</th><th>Email</th><th>Action</th><th>Summary</th></tr>
      ${all
        .map(
          (r) =>
            `<tr><td>${esc(fmtAuditWhen(r.createdAt))}</td><td>${esc(r.userName || "")}</td><td>${esc(r.userEmail || "")}</td><td>${esc(r.actionLabel || r.action || "")}</td><td>${esc(r.summary || "")}</td></tr>`,
        )
        .join("")}</table>`;
    excelDoc("audit-log-" + stamp(), table);
    logAudit("data.audit_log_export", `Exported the audit log (${all.length} entries)`);
    toast(`Audit log exported to Excel (${all.length} entries).`, "success");
  }

  usePageChrome(
    {
      title: "Audit log",
      actions: (
        <>
          <BusyButton className="btn sec sm" busyLabel="Exporting…" onClick={exportExcel}>
            ⤓ Export (Excel)
          </BusyButton>
          <button className="btn sec sm" type="button" onClick={() => void load(1, action, q)}>
            Refresh
          </button>
        </>
      ),
    },
    [action, q],
  );

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="card audit-log-card">
      <div className="audit-log-toolbar">
        <input
          className="topbar-search audit-log-search"
          placeholder="Search user or summary…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(1, action, q);
          }}
        />
        <select
          className="field-select audit-log-filter"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            void load(1, e.target.value, q);
          }}
        >
          {AUDIT_LOG_ACTIONS.map(([v, l]) => (
            <option key={v || "all"} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn sm sec" type="button" onClick={() => void load(1, action, q)}>
          Search
        </button>
      </div>
      <div className="audit-log-wrap">
        {loading ? (
          <Empty>Loading audit log…</Empty>
        ) : failed ? (
          <Empty>Could not load audit log.</Empty>
        ) : !logs.length ? (
          <Empty>No audit log entries yet.</Empty>
        ) : (
          <>
            <div className="audit-log-table-wrap">
              <table className="audit-log-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td className="audit-log-when">{fmtAuditWhen(row.createdAt)}</td>
                      <td>
                        <div className="audit-log-user">
                          <b>{row.userName || "System"}</b>
                          {row.userEmail ? <div className="hint">{row.userEmail}</div> : null}
                        </div>
                      </td>
                      <td>
                        <span className="tag audit-log-tag">{row.actionLabel || row.action}</span>
                      </td>
                      <td>{row.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="audit-log-pager">
              <span className="hint">
                {total} entr{total === 1 ? "y" : "ies"}
              </span>
              <div className="spacer" />
              {pages > 1 ? (
                <>
                  <button
                    className="btn sm sec"
                    type="button"
                    disabled={page <= 1}
                    onClick={() => void load(page - 1, action, q)}
                  >
                    Previous
                  </button>
                  <span className="hint">
                    Page {page} of {pages}
                  </span>
                  <button
                    className="btn sm sec"
                    type="button"
                    disabled={page >= pages}
                    onClick={() => void load(page + 1, action, q)}
                  >
                    Next
                  </button>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
