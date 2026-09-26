"use client";

// Audit log (head-only) — who did what, and how they were signed in when they did it.
// Server-paginated via GET /api/audit-log. Almost every entry is written by the server: sign-ins
// and user management by their routes, and every change to a record by the workspace save itself
// (lib/workspace-changes.ts), which records only what actually persisted. The few entries a
// browser reports (exports, e-mails, AI use) are marked as such.

import { Fragment, useCallback, useEffect, useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { Empty, RowOpen } from "@/components/ui";
import { ACTION_GROUPS, authMethodLabel } from "@/lib/audit-actions";
import { logAudit } from "@/lib/client/audit-log";
import { esc, excelDoc, stamp } from "@/lib/client/exports";
import { roleLabel } from "@/lib/permissions";

type FieldChange = { field: string; label: string; from: string; to: string };

type LogRow = {
  id: string;
  createdAt: string;
  userId?: string | null;
  userName: string;
  userEmail: string;
  action: string;
  actionLabel?: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
  userRole?: string | null;
  authMethod?: string | null;
  actorName?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type Filters = { q: string; action: string; method: string; category: string; session: string };
const NO_FILTERS: Filters = { q: "", action: "", method: "", category: "", session: "" };

const METHOD_OPTIONS: [string, string][] = [
  ["", "Any sign-in"],
  ["sso", "Microsoft sign-in"],
  ["dev", "Developer sign-in"],
  ["system", "Scheduled job"],
  ["script", "Maintenance script"],
  ["none", "Not recorded (older entries)"],
];

const CATEGORY_OPTIONS: [string, string][] = [
  ["", "All entries"],
  ["workspace", "Changes to records"],
  ["auth", "Sign-ins"],
  ["user", "User accounts"],
  ["data", "Exports"],
  ["security", "Security"],
];

// Free text an entry may carry about what was said, beyond the field changes.
const NOTE_KEYS: [string, string][] = [
  ["comment", "Comment"],
  ["response", "Owner's response"],
  ["closureNote", "Closure note"],
  ["update", "Update"],
];

function fmtAuditWhen(iso: string, seconds = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
  });
}

/** "Admin, viewing as Action Owner" for an admin; the plain role label for everyone else. */
function roleText(userRole?: string | null): string {
  if (!userRole) return "";
  if (userRole.startsWith("admin:")) return `Admin, viewing as ${roleLabel(userRole.slice(6))}`;
  return roleLabel(userRole);
}

/** "Chrome on Windows" — enough to tell two people's devices apart without reading a UA string. */
function browserOf(ua?: string | null): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return browser && os ? `${browser} on ${os}` : browser || os || ua.slice(0, 60);
}

/** Text for display. Metadata is JSON of whatever shape was stored — older entries, and whatever a
 *  browser once reported — and React cannot render an object, so anything else reads as blank. */
function txt(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
}

function changesOf(row: LogRow): FieldChange[] {
  const c = row.metadata?.changes;
  if (!Array.isArray(c)) return [];
  return c
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ field: txt(x.field), label: txt(x.label) || txt(x.field), from: txt(x.from), to: txt(x.to) }))
    .filter((x) => x.label);
}

const PROVENANCE_KEYS = ["userRole", "authMethod", "actorName", "sessionId", "ip", "userAgent"] as const;

/** Entries written before the provenance columns existed in the database keep it in their
 *  metadata instead (lib/audit-log.ts) — read it from there, so they show like any other. */
function withProvenance(row: LogRow): LogRow {
  const p = row.metadata?.provenance;
  if (row.authMethod || !p || typeof p !== "object") return row;
  const out: LogRow = { ...row };
  for (const k of PROVENANCE_KEYS) out[k] = txt((p as Record<string, unknown>)[k]) || null;
  return out;
}

function queryFor(f: Filters, page: number, limit: number): URLSearchParams {
  const p = new URLSearchParams({ page: String(Math.max(1, page)), limit: String(limit) });
  if (f.action) p.set("action", f.action);
  if (f.method) p.set("method", f.method);
  if (f.category) p.set("category", f.category);
  if (f.session) p.set("session", f.session);
  if (f.q) p.set("q", f.q);
  return p;
}

function WhoCell({ row }: { row: LogRow }) {
  const role = roleText(row.userRole);
  return (
    <div className="audit-log-user">
      <b>{row.userName || "System"}</b>
      {row.userEmail || role ? <div className="hint">{[row.userEmail, role].filter(Boolean).join(" · ")}</div> : null}
      {row.authMethod === "dev" ? (
        <div className="audit-who-flag is-dev">
          Developer sign-in — done by <b>{row.actorName || "an unidentified developer"}</b>, not {row.userName}
        </div>
      ) : row.authMethod === "script" && row.actorName ? (
        <div className="audit-who-flag">Run by {row.actorName}</div>
      ) : null}
    </div>
  );
}

function Details({ row, onSession }: { row: LogRow; onSession: (sid: string) => void }) {
  const meta = row.metadata || {};
  const changes = changesOf(row);
  const notes = NOTE_KEYS.filter(([k]) => txt(meta[k])).map(([k, l]) => [l, txt(meta[k])] as const);
  const items = (Array.isArray(meta.items) ? meta.items : [])
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => txt(it.title) || txt(it.id))
    .filter(Boolean);
  const recorded = !!(row.authMethod || row.sessionId);
  return (
    <div className="audit-detail">
      {changes.length ? (
        <table className="audit-changes">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={i}>
                <td>{c.label}</td>
                <td>{c.from || "—"}</td>
                <td>{c.to || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {notes.map(([l, t]) => (
        <p key={l} className="audit-detail-note">
          <b>{l}:</b> {t}
        </p>
      ))}
      {items.length ? (
        <div className="audit-detail-note">
          <b>{items.length} records</b>
          <ul>
            {items.slice(0, 50).map((title, i) => (
              <li key={i}>{title}</li>
            ))}
          </ul>
          {items.length > 50 ? <span className="hint">…and {items.length - 50} more</span> : null}
        </div>
      ) : null}
      <dl className="audit-provenance">
        <dt>Recorded</dt>
        <dd>{fmtAuditWhen(row.createdAt, true)}</dd>
        <dt>Signed in with</dt>
        <dd>{authMethodLabel(row.authMethod) || "Not recorded"}</dd>
        {row.actorName ? (
          <>
            <dt>{row.authMethod === "script" ? "Run by" : "Operated by"}</dt>
            <dd>{row.actorName}</dd>
          </>
        ) : null}
        {row.userRole ? (
          <>
            <dt>Acting as</dt>
            <dd>{roleText(row.userRole)}</dd>
          </>
        ) : null}
        {row.ip ? (
          <>
            <dt>IP address</dt>
            <dd>{row.ip}</dd>
          </>
        ) : null}
        {row.userAgent ? (
          <>
            <dt>Browser</dt>
            <dd title={row.userAgent}>{browserOf(row.userAgent)}</dd>
          </>
        ) : null}
        {row.sessionId ? (
          <>
            <dt>Session</dt>
            <dd>
              <code>{row.sessionId}</code>{" "}
              <button className="btn sm sec" type="button" onClick={() => onSession(row.sessionId!)}>
                Everything from this sign-in
              </button>
            </dd>
          </>
        ) : null}
      </dl>
      {meta.source === "browser" ? (
        <p className="hint">
          Reported by the person&apos;s browser rather than recorded by the server — the server cannot observe
          exports, e-mails the browser sends or AI assistance for itself.
        </p>
      ) : null}
      {!recorded ? (
        <p className="hint">
          How this person was signed in was not recorded. Entries — and sign-ins — from before sign-in tracking
          was introduced do not carry it.
        </p>
      ) : null}
    </div>
  );
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [qInput, setQInput] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (p: number, f: Filters) => {
      setLoading(true);
      setFailed(false);
      setExpanded(null);
      try {
        const res = await fetch("/api/audit-log?" + queryFor(f, p, limit).toString());
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const json = await res.json();
        setLogs(((json.logs || []) as LogRow[]).map(withProvenance));
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
    const t = setTimeout(() => void load(1, NO_FILTERS), 0);
    return () => clearTimeout(t);
  }, [load]);

  function apply(next: Partial<Filters>) {
    const f = { ...filters, q: qInput.trim(), ...next };
    setFilters(f);
    void load(1, f);
  }

  /** Everything one sign-in did — on its own, not narrowed by whatever filters were already set. */
  function showSession(sessionId: string) {
    const f = { ...NO_FILTERS, session: sessionId };
    setQInput("");
    setFilters(f);
    void load(1, f);
  }

  async function exportExcel() {
    let p = 1;
    let all: LogRow[] = [];
    let tot = Infinity;
    while (all.length < tot && p <= 100) {
      const res = await fetch("/api/audit-log?" + queryFor(filters, p, 100).toString());
      if (!res.ok) break;
      const json = await res.json();
      tot = json.total || 0;
      const rows = ((json.logs || []) as LogRow[]).map(withProvenance);
      if (!rows.length) break;
      all = all.concat(rows);
      p++;
    }
    if (!all.length) {
      toast("Nothing to export.", "info");
      return;
    }
    const cells = (r: LogRow) =>
      [
        fmtAuditWhen(r.createdAt, true),
        r.userName || "",
        r.userEmail || "",
        r.actorName || "",
        authMethodLabel(r.authMethod),
        roleText(r.userRole),
        r.actionLabel || r.action || "",
        r.summary || "",
        changesOf(r)
          .map((c) => `${c.label}: ${c.from || "—"} → ${c.to || "—"}`)
          .join("; "),
        r.sessionId || "",
        r.ip || "",
      ]
        .map((v) => `<td>${esc(v)}</td>`)
        .join("");
    const heads = [
      "When", "Account", "Email", "Actually done by", "Signed in with", "Acting as",
      "Action", "Summary", "Changes", "Session", "IP address",
    ];
    const table = `<table><tr>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr>
      ${all.map((r) => `<tr>${cells(r)}</tr>`).join("")}</table>`;
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
          <button className="btn sec sm" type="button" onClick={() => void load(page, filters)}>
            Refresh
          </button>
        </>
      ),
    },
    [filters, page],
  );

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="card audit-log-card">
      <div className="audit-log-toolbar">
        <input
          className="topbar-search audit-log-search"
          placeholder="Search person, developer or summary…"
          aria-label="Search the audit log"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({});
          }}
        />
        <select
          className="field-select audit-log-filter"
          aria-label="Action"
          value={filters.action}
          onChange={(e) => apply({ action: e.target.value })}
        >
          <option value="">All actions</option>
          {ACTION_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.actions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          className="field-select audit-log-filter"
          aria-label="Type of entry"
          value={filters.category}
          onChange={(e) => apply({ category: e.target.value })}
        >
          {CATEGORY_OPTIONS.map(([v, l]) => (
            <option key={v || "all"} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          className="field-select audit-log-filter"
          aria-label="How they were signed in"
          value={filters.method}
          onChange={(e) => apply({ method: e.target.value })}
        >
          {METHOD_OPTIONS.map(([v, l]) => (
            <option key={v || "any"} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button className="btn sm sec" type="button" onClick={() => apply({})}>
          Search
        </button>
      </div>
      {filters.session ? (
        <div className="audit-log-scope">
          Showing everything from sign-in session <code>{filters.session}</code>
          <button className="btn sm sec" type="button" onClick={() => apply({ session: "" })}>
            Show all sessions
          </button>
        </div>
      ) : null}
      <div className="audit-log-wrap">
        {loading ? (
          <Empty>Loading audit log…</Empty>
        ) : failed ? (
          <Empty>Could not load audit log.</Empty>
        ) : !logs.length ? (
          <Empty>No audit log entries match.</Empty>
        ) : (
          <>
            <div className="audit-log-table-wrap">
              <table className="audit-log-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">Action</th>
                    <th scope="col">What happened</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => {
                    const open = expanded === row.id;
                    const detailId = `audit-detail-${row.id}`;
                    const toggle = () => setExpanded(open ? null : row.id);
                    return (
                      <Fragment key={row.id}>
                        <tr
                          className={
                            "audit-log-row" + (row.authMethod === "dev" ? " is-dev" : "") + (open ? " is-open" : "")
                          }
                          onClick={toggle}
                        >
                          <td className="audit-log-when">{fmtAuditWhen(row.createdAt)}</td>
                          <td>
                            <WhoCell row={row} />
                          </td>
                          <td>
                            <span className="tag audit-log-tag">{row.actionLabel || row.action}</span>
                          </td>
                          <td>
                            <RowOpen
                              onOpen={toggle}
                              label={`${open ? "Hide" : "Show"} details: ${row.summary}`}
                              expanded={open}
                              controls={detailId}
                            >
                              {row.summary}
                            </RowOpen>
                            {row.metadata?.source === "browser" ? (
                              <span className="audit-src">reported by browser</span>
                            ) : null}
                          </td>
                        </tr>
                        {open ? (
                          <tr className="audit-log-detail-row" id={detailId}>
                            <td colSpan={4}>
                              <Details row={row} onSession={showSession} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
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
                    onClick={() => void load(page - 1, filters)}
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
                    onClick={() => void load(page + 1, filters)}
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
