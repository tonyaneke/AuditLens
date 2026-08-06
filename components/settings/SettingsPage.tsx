"use client";

// Settings & user access (head-only) — React port of viewSettings/departmentsTableHTML/
// usersTableHTML/excoRecipientsTableHTML plus setUserActive/delDepartment/delExcoRecipient
// from public/audit-bot.js. Workspace data (departments, EXCO recipients) goes through
// useWorkspace().mutate(); user management talks to /api/users like legacy refreshUsersTable.

import { useCallback, useEffect, useState } from "react";
import { usePageChrome } from "@/components/chrome/PageChrome";
import { useUser } from "@/components/chrome/UserContext";
import { toast } from "@/components/feedback/ToastHost";
import { useModal } from "@/components/modals/ModalProvider";
import { Avatar, Empty, RowOpen } from "@/components/ui";
import { logAudit } from "@/lib/client/audit-log";
import { loadDirectory, type DirectoryUser } from "@/lib/client/directory";
import { MANUALS } from "@/lib/manuals";
import { effectiveRole } from "@/lib/permissions";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  DeleteUserDialog,
  DepartmentDialog,
  ExcoRecipientDialog,
  UserDialog,
} from "./lazy";
import { fetchUsers, roleLabel, type ManagedUser } from "./staff";

const TRASH = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export default function SettingsPage() {
  const me = useUser();
  const modal = useModal();
  const { db, mutate } = useWorkspace();

  // Legacy _usersCache / _directoryCache — fetched, not workspace data. null = still loading.
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);

  const reload = useCallback(async () => {
    // Refreshing the shared directory cache keeps assignment selects elsewhere current too
    // (legacy always paired refreshUsersTable() with loadDirectory()).
    const [u, d] = await Promise.all([fetchUsers(), loadDirectory()]);
    if (u) setUsers(u);
    else setUsers((cur) => cur || []);
    setDirectory(d);
  }, []);

  useEffect(() => {
    // Deferred so the state updates inside reload() never run synchronously within the effect.
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  usePageChrome({ title: "Settings" });

  if (effectiveRole(me) !== "head_of_audit") return null; // legacy viewSettings renders nothing for non-heads

  const departments = db.departments || [];
  const recipients = db.exco?.recipientList || [];

  /* ---- setUserActive: inactive (block sign-in, keep history) / active again ---- */
  function setUserActive(u: ManagedUser, active: boolean) {
    // Someone who has never been welcomed is being released to the system for the first time —
    // say so, because activating them is what sends the "your account is ready" email.
    const firstTime = active && u.welcomeEmailSentAt == null;
    const msg = active
      ? `Make ${u.name} active${firstTime ? "" : " again"}? They will be able to sign in with their Microsoft account.` +
        (firstTime ? ` A welcome email will be sent to ${u.email} letting them know their account is ready.` : "")
      : `Make ${u.name} inactive? They can no longer sign in (any open session ends immediately), but the account, their observations and full history are kept. You can make them active again at any time.`;
    void modal.confirm({
      title: active ? "Make user active" : "Make user inactive",
      message: msg,
      danger: !active,
      confirmLabel: active ? "Make active" : "Make inactive",
      onConfirm: async () => {
        let res: Response;
        let data: Record<string, unknown>;
        try {
          res = await fetch(`/api/users/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active }),
          });
          data = await res.json().catch(() => ({}) as Record<string, unknown>);
        } catch {
          toast("Network error — could not update the account.", "error");
          return;
        }
        if (!res.ok) {
          toast(String(data.error || "Could not update the account."), "error");
          return;
        }
        // The server writes the user.deactivated / user.reactivated audit-trail entry.
        await reload();
        const base = `${u.name} is now ${active ? "active" : "inactive"} — recorded in the audit trail.`;
        if (data.welcomeEmailSent === true) {
          toast(`${base} Welcome email sent to ${u.email}.`, "success");
        } else if (data.welcomeEmailSent === false) {
          // The account is active regardless; only the notification failed.
          toast(`${base} The welcome email could not be sent — ${String(data.welcomeEmailError || "unknown error")}`, "error");
        } else {
          toast(base, "success");
        }
      },
    });
  }

  /* ---- delDepartment: remove + (maybe) make the head's login inactive ---- */
  function delDepartment(id: string) {
    const d = departments.find((x) => x.id === id);
    if (!d) return;
    // Only deactivate the head's login if no OTHER department still points at the same user.
    const linked =
      !!d.headUserId && !departments.some((x) => x.id !== id && x.headUserId === d.headUserId);
    const msg = linked
      ? `Remove ${d.name}? ${d.headName || "The head"}'s Action Owner login will be made inactive (sign-in blocked, history kept). You can make it active again or permanently delete it from User access management.`
      : "Remove this department?";
    void modal.confirm({
      message: msg,
      danger: true,
      confirmLabel: "Remove",
      onConfirm: async () => {
        mutate((w) => {
          w.departments = (w.departments || []).filter((x) => x.id !== id);
        });
        logAudit(
          "workspace.department_removed",
          "Removed department " + d.name + (d.headName ? " (action owner: " + d.headName + ")" : ""),
          { departmentId: id, headUserId: d.headUserId || "" },
        );
        if (linked) {
          try {
            const res = await fetch(`/api/users/${d.headUserId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ active: false }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}) as Record<string, unknown>);
              toast(String(data.error || "Department removed, but the login could not be made inactive."), "error");
            } else {
              toast(
                `Department removed. ${d.headName || "The head"}'s login is now inactive — both recorded in the audit trail.`,
                "success",
              );
            }
          } catch {
            toast("Department removed, but the login could not be made inactive (network error).", "error");
          }
          await reload();
        } else {
          toast("Department removed — recorded in the audit trail.", "success");
        }
      },
    });
  }

  /* ---- delExcoRecipient ---- */
  function delExcoRecipient(id: string) {
    void modal.confirm({
      message: "Remove this recipient?",
      danger: true,
      confirmLabel: "Remove",
      onConfirm: () => {
        mutate((w) => {
          w.exco = w.exco || {};
          w.exco.recipientList = (w.exco.recipientList || []).filter((x) => x.id !== id);
        });
      },
    });
  }

  /* ---- Settings → closure response check (db.strictClosureCheck) ----
     The AI check on an owner's closure response is advisory by default: it gives the feedback and
     a fill-in template once per submission round, and the next Submit goes through whatever the
     owner does with it. That deliberately can't wedge an owner out of the workflow, but it also
     means a thin response reaches the auditor. Turning this on removes the waiver — the check runs
     on every attempt and refuses anything it judges vague. Head-only, and enforced against
     db.strictClosureCheck in ReadyForClosureDialog. */
  const strictClosure = !!db.strictClosureCheck;
  function setStrictClosure(on: boolean) {
    mutate((w) => {
      w.strictClosureCheck = on;
    });
    logAudit(
      "settings.closure_check",
      on
        ? "Closure response check set to strict — vague responses cannot be submitted"
        : "Closure response check set to advisory — owners may submit after one warning",
    );
    toast(on ? "Closure responses must now pass the check." : "Owners may submit after one warning.", "success");
  }

  return (
    <>
      {/* ---- Departments & action owners ---- */}
      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Departments &amp; action owners</h3>
          <div className="spacer" />
          <button
            className="btn sm"
            type="button"
            onClick={() => modal.open(<DepartmentDialog onProvisioned={reload} />)}
          >
            + Add Action Owner
          </button>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          Each department&rsquo;s head becomes an <b>Action Owner</b> login (welcome email with a
          temporary password) and can be assigned remediation actions.
        </div>
        <div style={{ marginTop: 12 }}>
          {!departments.length ? (
            <Empty big="🏢">
              No departments yet.
              <br />
              Add a department to create its head as an action owner who can respond to and close
              observations.
            </Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Login</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <b>{d.name}</b>
                    </td>
                    <td>{d.headName || "—"}</td>
                    <td>{d.headEmail || "—"}</td>
                    <td>
                      {d.headUserId ? (
                        <span className="pill c-Low">Active</span>
                      ) : (
                        <span className="pill sop-pending-pill">Not linked</span>
                      )}
                    </td>
                    <td className="ra-actions-cell">
                      <button
                        className="btn-icon-action"
                        type="button"
                        title="Edit"
                        onClick={() =>
                          modal.open(<DepartmentDialog departmentId={d.id} onProvisioned={reload} />)
                        }
                      >
                        ✎
                      </button>
                      <button
                        className="btn-icon-action danger"
                        type="button"
                        title="Delete"
                        onClick={() => delDepartment(d.id)}
                      >
                        {TRASH}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---- Remediation closure rules ---- */}
      <div className="card">
        <h3 style={{ margin: 0 }}>Remediation closure rules</h3>
        <div className="hint" style={{ marginTop: 4 }}>
          How strictly AuditLens checks an action owner&rsquo;s closure response before it reaches
          the auditor who raised the observation.
        </div>
        <div style={{ marginTop: 12 }}>
          <label className="filter-check" style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <input
              type="checkbox"
              style={{ width: "auto", marginTop: 3 }}
              checked={strictClosure}
              onChange={(e) => setStrictClosure(e.target.checked)}
            />
            <span>
              <b>Require the closure response check to pass</b>
              <div className="hint" style={{ marginTop: 2 }}>
                When ticked, a response the check judges vague cannot be submitted at all — the
                owner must revise it, even after the check has supplied ready-to-send wording. When
                unticked (the default), the check gives its feedback and template once per round and
                the next Submit goes through as written; the auditor can still send it back.
              </div>
            </span>
          </label>
          <div className="hint" style={{ marginTop: 10 }}>
            Currently:{" "}
            {strictClosure ? (
              <b>Strict — a vague response is refused.</b>
            ) : (
              <b>Advisory — the owner may submit after one warning.</b>
            )}{" "}
            Unfilled <b>[bracketed gaps]</b> in a template are always refused, under either setting.
          </div>
        </div>
      </div>

      {/* ---- User manuals ----
           Both are built from AuditLens-User-Manual.html by scripts/build-docs.mts and served
           from public/docs. They sit behind the session cookie like every other non-public path
           (proxy.ts), so these links only work for someone already signed in — which is exactly
           who they are for. Ordinary <a> rather than next/link: they are documents, not routes. */}
      <div className="card">
        <h3 style={{ margin: 0 }}>User manuals</h3>
        <div className="hint" style={{ marginTop: 4 }}>
          Both open in a new tab and print to PDF with <b>Ctrl</b>+<b>P</b>. Anyone signed in to
          AuditLens can open these links, so they can be shared by email or pinned in Teams.
        </div>
        <div className="manual-links">
          {MANUALS.map((m) => (
            <a key={m.href} className="manual-link" href={m.href} target="_blank" rel="noopener noreferrer">
              <span className="manual-link-ico" aria-hidden="true">{m.ico}</span>
              <span className="manual-link-body">
                <b>{m.title}</b>
                <span className="hint">{m.blurb}</span>
                <code className="manual-link-url">{m.href}</code>
              </span>
              <span className="manual-link-go" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </div>

      {/* ---- User access management ---- */}
      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>User access management</h3>
          <div className="spacer" />
          <button
            className="btn sm"
            type="button"
            onClick={() =>
              modal.open(<UserDialog users={users || []} directory={directory} onSaved={reload} />)
            }
          >
            + Add user
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {users === null ? (
            <Empty>Loading users…</Empty>
          ) : !users.length ? (
            <Empty big="👥">
              No users yet.
              <br />
              Use <b>Add user</b> to invite audit staff — they sign in with their Microsoft
              account.
            </Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Department</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const inactive = u.active === false;
                  const notSelf = me.id !== u.id;
                  const openEdit = () =>
                    modal.open(
                      <UserDialog userId={u.id} users={users} directory={directory} onSaved={reload} />,
                    );
                  return (
                    <tr
                      key={u.id}
                      className="tracker-row"
                      style={inactive ? { opacity: 0.55 } : undefined}
                      onClick={openEdit}
                      title="View details & sidebar access"
                    >
                      <td>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <Avatar user={u} size={28} />
                          <RowOpen onOpen={openEdit} label={`View details & sidebar access for ${u.name}`}>
                            <b>{u.name}</b>
                          </RowOpen>
                        </div>
                      </td>
                      {/* Both departments, because both grant access — showing only the home one
                          would understate what an action owner can see. */}
                      <td>
                        {u.department || "—"}
                        {u.extraDepartments?.length ? (
                          <div className="hint">+ {u.extraDepartments.join(" · ")}</div>
                        ) : null}
                      </td>
                      <td>{u.email}</td>
                      <td>{roleLabel(u.role)}</td>
                      <td>
                        {inactive ? (
                          <span className="pill sop-pending-pill">Inactive</span>
                        ) : (
                          <span className="pill c-Low">Active</span>
                        )}
                      </td>
                      <td className="ra-actions-cell" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-icon-action" type="button" title="Edit" onClick={openEdit}>
                          ✎
                        </button>
                        {notSelf ? (
                          inactive ? (
                            <button
                              className="btn-icon-action"
                              type="button"
                              title="Make active — allow sign-in again"
                              onClick={() => setUserActive(u, true)}
                            >
                              ⟳
                            </button>
                          ) : (
                            <button
                              className="btn-icon-action"
                              type="button"
                              title="Make inactive — block sign-in, keep history"
                              onClick={() => setUserActive(u, false)}
                            >
                              ⏻
                            </button>
                          )
                        ) : null}
                        {notSelf ? (
                          <button
                            className="btn-icon-action danger"
                            type="button"
                            title="Permanently delete"
                            onClick={() =>
                              modal.open(
                                <DeleteUserDialog
                                  user={u}
                                  onDeleted={reload}
                                  onMakeInactive={() => setUserActive(u, false)}
                                />,
                              )
                            }
                          >
                            {TRASH}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---- MD & EXCO brief recipients ---- */}
      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>MD &amp; EXCO brief recipients</h3>
          <div className="spacer" />
          <button className="btn sm" type="button" onClick={() => modal.open(<ExcoRecipientDialog />)}>
            + Add recipient
          </button>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          These people receive the <b>Executive Assurance Brief</b> — automatically on the 1st and
          3rd week of each month from August 2026, and manually anytime from the Executive
          Assurance Brief page.
        </div>
        <div style={{ marginTop: 12 }}>
          {!recipients.length ? (
            <Empty>No recipients yet. Add the MD and EXCO members who should receive the brief.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Email</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name || "—"}</b>
                    </td>
                    <td>{r.role || "—"}</td>
                    <td>{r.email || "—"}</td>
                    <td className="ra-actions-cell">
                      <button
                        className="btn-icon-action"
                        type="button"
                        title="Edit"
                        onClick={() => modal.open(<ExcoRecipientDialog recipientId={r.id} />)}
                      >
                        ✎
                      </button>
                      <button
                        className="btn-icon-action danger"
                        type="button"
                        title="Delete"
                        onClick={() => delExcoRecipient(r.id)}
                      >
                        {TRASH}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
