"use client";

// Settings dialogs — ports of modalDepartment/saveDepartment, modalUser/saveUser/
// toggleUserAccessFields, deleteUser/doDeleteUser/delUserStepsHTML, modalCredentials and
// modalExcoRecipient/saveExcoRecipient from public/audit-bot.js. API contracts (POST/PUT
// /api/users, PATCH/DELETE /api/users/:id, GET /api/directory) are unchanged; the server
// writes the user.* audit-trail entries, so nothing is double-logged here.

import { useState, type ReactNode } from "react";
import BusyButton from "@/components/feedback/BusyButton";
import { toast } from "@/components/feedback/ToastHost";
import { ModalFrame, useModal } from "@/components/modals/ModalProvider";
import { loadDirectory, type DirectoryUser } from "@/lib/client/directory";
import { uid } from "@/lib/workspace/selectors";
import { useWorkspace } from "@/lib/workspace/WorkspaceProvider";
import {
  ASSESSMENT_NAV,
  DEPARTMENTS,
  STAFF_DIRECTORY,
  roleLabel,
  staffEmail,
  staffPick,
  type ManagedUser,
} from "./staff";

const STAFF_SORTED = STAFF_DIRECTORY.slice().sort((a, b) => a[0].localeCompare(b[0]));

/* ---------------- shared bits ---------------- */

/** deptOptionsHTML: canonical departments + preserve a non-canonical existing value. */
function DeptOptions({ sel }: { sel: string }) {
  return (
    <>
      <option value="">— select department —</option>
      {DEPARTMENTS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {sel && !DEPARTMENTS.includes(sel) ? <option value={sel}>{sel}</option> : null}
    </>
  );
}

/** staffNamesDatalist: name autocomplete listing job titles. */
function StaffNamesDatalist({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {[...STAFF_SORTED].map(([n, t]) => (
        <option key={n} value={n}>
          {t}
        </option>
      ))}
    </datalist>
  );
}

function ErrHint({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="hint" style={{ color: "var(--crit)", marginTop: 10 }}>
      {children}
    </div>
  );
}

/* ---------------- modalCredentials ---------------- */

// Shown when the welcome email couldn't be delivered — the Head can share sign-in info manually.
export function CredentialsDialog({
  name,
  email,
  emailError,
}: {
  name: string;
  email: string;
  emailError?: string;
}) {
  const modal = useModal();
  return (
    <ModalFrame
      title="User created"
      footer={
        <button className="btn" type="button" onClick={modal.close}>
          Done
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="hint">
          We couldn&rsquo;t send the welcome email{emailError ? ` (${emailError})` : ""}. Let{" "}
          <b>{name}</b> know their AuditLens account is ready.
        </div>
        <div className="note">
          <b>Account email:</b> {email}
          <br />
          They sign in on the login page with <b>Sign in with Microsoft</b> using their work
          account — there is no password to share.
        </div>
      </div>
    </ModalFrame>
  );
}

/* ---------------- modalDepartment / saveDepartment ---------------- */

export function DepartmentDialog({
  departmentId,
  onProvisioned,
}: {
  departmentId?: string;
  /** Refresh the users table + directory after a login was provisioned/linked. */
  onProvisioned: () => Promise<void>;
}) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const existing = departmentId
    ? (db.departments || []).find((d) => d.id === departmentId)
    : undefined;
  const emailLocked = !!(existing && existing.headUserId);

  const [dept, setDept] = useState(existing?.name || "");
  const [headName, setHeadName] = useState(existing?.headName || "");
  const [headEmail, setHeadEmail] = useState(existing?.headEmail || "");
  const [err, setErr] = useState("");

  // Name → staff autocomplete: on an exact match fill the email and mapped department.
  function applyPick(v: string) {
    setHeadName(v);
    const hit = staffPick(v);
    if (!hit) return;
    if (!emailLocked) setHeadEmail(staffEmail(hit[0]));
    if (hit[2]) setDept(hit[2]);
  }

  async function save() {
    const name = dept;
    const hn = headName.trim();
    const he = headEmail.trim().toLowerCase();
    if (!name || !hn || !he) {
      setErr("Department name, head name and email are all required.");
      return;
    }
    if (departmentId) {
      mutate((d) => {
        const cur = (d.departments || []).find((x) => x.id === departmentId);
        if (!cur) return;
        cur.name = name;
        cur.headName = hn;
        if (!cur.headUserId) cur.headEmail = he;
      });
      modal.close();
      return;
    }
    // New department → provision the head as an action_owner login user.
    setErr("");
    let userId = "";
    let emailSent = false;
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: hn, email: he, department: name, role: "action_owner" }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (res.status === 409) {
        // Head already has an account — link it by looking up the directory.
        const dir = await loadDirectory();
        const linked = dir.find((u) => (u.email || "").toLowerCase() === he);
        if (linked) userId = linked.id;
        else {
          setErr("That email already has an account that couldn't be linked.");
          return;
        }
      } else if (!res.ok) {
        setErr(String(data.error || "Could not create the action-owner login."));
        return;
      } else {
        userId = String((data.user as { id?: string } | undefined)?.id || "");
        emailSent = !!data.emailSent;
      }
    } catch {
      setErr("Network error creating the login.");
      return;
    }
    mutate((d) => {
      d.departments = d.departments || [];
      d.departments.push({
        id: uid(),
        name,
        headName: hn,
        headEmail: he,
        headUserId: userId || "",
        createdAt: new Date().toISOString(),
      });
    });
    await onProvisioned();
    modal.close();
    if (emailSent) toast(`Action owner added. A welcome email was sent to ${he}.`, "success");
    else modal.open(<CredentialsDialog name={hn} email={he} />);
  }

  return (
    <ModalFrame
      title={departmentId ? "Edit department" : "Add Action Owner"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn" onClick={save}>
            Add User
          </BusyButton>
        </>
      }
    >
      <label>Department name *</label>
      <select value={dept} onChange={(e) => setDept(e.target.value)}>
        <DeptOptions sel={existing?.name || ""} />
      </select>
      <div className="f2">
        <div>
          <label>Name *</label>
          {departmentId ? (
            <input
              value={headName}
              onChange={(e) => setHeadName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          ) : (
            <>
              <input
                value={headName}
                list="staffNamesDept"
                autoComplete="off"
                placeholder="Start typing a staff name…"
                onChange={(e) => applyPick(e.target.value)}
              />
              <StaffNamesDatalist id="staffNamesDept" />
            </>
          )}
        </div>
        <div>
          <label>Email *</label>
          <input
            type="email"
            value={headEmail}
            onChange={(e) => setHeadEmail(e.target.value)}
            disabled={emailLocked}
            title={
              emailLocked
                ? "Linked to a login account — email cannot be changed here"
                : undefined
            }
          />
        </div>
      </div>
      {departmentId ? null : (
        <p className="hint" style={{ margin: "10px 0 0" }}>
          On save, an <b>Action Owner</b> login is created for this person and a welcome email
          (temporary password) is sent.
        </p>
      )}
      <ErrHint>{err}</ErrHint>
    </ModalFrame>
  );
}

/* ---------------- modalUser / saveUser ---------------- */

export function UserDialog({
  userId,
  users,
  directory,
  onSaved,
}: {
  userId?: string;
  users: ManagedUser[];
  directory: DirectoryUser[];
  onSaved: () => Promise<void>;
}) {
  const modal = useModal();
  const u = userId ? users.find((x) => x.id === userId) : undefined;
  const isEdit = !!u;

  const [name, setName] = useState(u?.name || "");
  const [dept, setDept] = useState(u ? u.department || "" : "Audit Department");
  const [email, setEmail] = useState(u?.email || "");
  const [role, setRole] = useState(u?.role || "audit_staff");
  const [access, setAccess] = useState<string[]>(u?.sidebarAccess || []);
  const [err, setErr] = useState("");

  const roleOpts: [string, string][] = [
    ["audit_staff", "Audit Staff"],
    ["head_of_audit", "Head of Audit"],
    ["action_owner", "Action Owner"],
    ["admin", "Admin"],
  ];

  function applyPick(v: string) {
    setName(v);
    const hit = staffPick(v);
    if (!hit) return;
    setEmail(staffEmail(hit[0]));
    if (hit[2]) setDept(hit[2]);
  }

  function toggleAccess(view: string, checked: boolean) {
    setAccess((cur) => (checked ? [...new Set([...cur, view])] : cur.filter((v) => v !== view)));
  }

  async function save() {
    setErr("");
    const payload = {
      name: name.trim(),
      email: email.trim(),
      department: dept,
      role,
      sidebarAccess: access,
    };
    if (!payload.name || !payload.email) {
      setErr("Name and email are required.");
      return;
    }
    const emailLc = payload.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLc)) {
      setErr("Enter a valid email address.");
      return;
    }
    // Prevent creating/assigning an email that is already registered (also enforced server-side).
    const clash =
      users.find((x) => x.email && x.email.toLowerCase() === emailLc && x.id !== userId) ||
      directory.find((x) => x.email && x.email.toLowerCase() === emailLc && x.id !== userId);
    if (clash) {
      setErr("A user with this email already exists.");
      return;
    }
    let res: Response;
    let data: Record<string, unknown>;
    try {
      res = await fetch(userId ? `/api/users/${userId}` : "/api/users", {
        method: userId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(() => ({}) as Record<string, unknown>);
    } catch {
      setErr("Network error — could not save user. Please try again.");
      return;
    }
    if (!res.ok) {
      setErr(String(data.error || "Could not save user."));
      return;
    }
    modal.close();
    if (!userId) {
      if (data.emailSent)
        modal.success(
          "User created. A welcome email with Microsoft sign-in instructions was sent to " +
            payload.email +
            ".",
          "User created",
        );
      else
        modal.open(
          <CredentialsDialog
            name={payload.name}
            email={payload.email}
            emailError={data.emailError ? String(data.emailError) : undefined}
          />,
        );
    } else {
      toast("Changes saved.", "success");
    }
    await onSaved();
  }

  return (
    <ModalFrame
      title={isEdit ? "Edit user" : "Add user"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <BusyButton className="btn" onClick={save}>
            Save
          </BusyButton>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Name *</label>
          {isEdit ? (
            <input value={name} onChange={(e) => setName(e.target.value)} />
          ) : (
            <>
              <input
                value={name}
                list="staffNamesUser"
                autoComplete="off"
                placeholder="Start typing a staff name…"
                onChange={(e) => applyPick(e.target.value)}
              />
              <StaffNamesDatalist id="staffNamesUser" />
            </>
          )}
        </div>
        <div>
          <label>Department</label>
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <DeptOptions sel={u ? u.department || "" : "Audit Department"} />
          </select>
        </div>
      </div>
      <div className="f2">
        <div>
          <label>Email *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roleOpts.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isEdit ? null : (
        <p className="hint" style={{ margin: "10px 0 0" }}>
          A welcome email with a temporary password will be sent. The user sets their own password
          on first sign-in.
        </p>
      )}
      {role === "audit_staff" ? (
        <div style={{ marginTop: 10 }}>
          <div className="seclabel" style={{ marginBottom: 6 }}>
            Additional sidebar access
          </div>
          <div className="hint" style={{ marginBottom: 6 }}>
            Main sections (Dashboard, Audits &amp; Reports, Remediation Tracker) are always
            included.
          </div>
          <div>
            {ASSESSMENT_NAV.map(([id, label]) => (
              <label key={id} className="filter-check" style={{ display: "block", margin: "4px 0" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={access.includes(id)}
                  onChange={(e) => toggleAccess(id, e.target.checked)}
                />{" "}
                {label}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="hint" style={{ marginTop: 10 }}>
          {role === "head_of_audit"
            ? "Sidebar access: all sections, including Settings and the Audit log."
            : role === "admin"
              ? "Full access to all sections. Can switch between any role."
              : "Sidebar access: the Action Owner portal (their assigned observations) only."}
        </div>
      )}
      <ErrHint>{err}</ErrHint>
    </ModalFrame>
  );
}

/* ---------------- deleteUser / doDeleteUser (delete-with-progress) ---------------- */

type DelStep = { label: string; state: "pending" | "busy" | "done" | "fail" };

const DEL_ICONS: Record<DelStep["state"], string> = {
  done: "✅",
  busy: "⏳",
  fail: "❌",
  pending: "◻️",
};

export function DeleteUserDialog({
  user,
  onDeleted,
  onMakeInactive,
}: {
  user: ManagedUser;
  /** Refresh users + directory after the server deletion succeeds. */
  onDeleted: () => Promise<void>;
  /** "Make inactive instead" — the caller re-runs the setUserActive(false) confirm flow. */
  onMakeInactive: () => void;
}) {
  const modal = useModal();
  const [steps, setSteps] = useState<DelStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  async function doDelete() {
    setRunning(true);
    setErr("");
    setSteps([
      { label: "Remove the login account", state: "busy" },
      { label: "Record the deletion in the audit trail", state: "pending" },
      { label: "Refresh users and assignment lists", state: "pending" },
    ]);
    let res: Response;
    let data: Record<string, unknown>;
    try {
      res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      data = await res.json().catch(() => ({}) as Record<string, unknown>);
    } catch {
      setSteps((cur) => (cur ? [{ ...cur[0], state: "fail" }, cur[1], cur[2]] : cur));
      setRunning(false);
      setErr("Network error — could not delete user. Please try again.");
      return;
    }
    if (!res.ok) {
      setSteps((cur) => (cur ? [{ ...cur[0], state: "fail" }, cur[1], cur[2]] : cur));
      setRunning(false);
      setErr(String(data.error || "Could not delete user."));
      return;
    }
    // The server deletes and writes the user.deleted audit-trail entry in the same request.
    setSteps((cur) =>
      cur ? [{ ...cur[0], state: "done" }, { ...cur[1], state: "done" }, { ...cur[2], state: "busy" }] : cur,
    );
    await onDeleted();
    setSteps((cur) => (cur ? cur.map((s) => ({ ...s, state: "done" as const })) : cur));
    modal.close();
    modal.success(
      `${user.name || "The user"} was permanently deleted. The deletion has been recorded in the audit trail.`,
      "User deleted",
    );
  }

  return (
    <ModalFrame
      title="Permanently delete user"
      footer={
        <>
          <button className="btn sec" type="button" disabled={running} onClick={modal.close}>
            Cancel
          </button>
          <button
            className="btn sec"
            type="button"
            disabled={running}
            onClick={() => {
              modal.close();
              onMakeInactive();
            }}
          >
            Make inactive instead
          </button>
          <button className="btn danger" type="button" disabled={running} onClick={() => void doDelete()}>
            Permanently delete
          </button>
        </>
      }
    >
      <div className="note" style={{ borderLeft: "3px solid var(--crit)" }}>
        This <b>permanently</b> removes the login account and cannot be undone. Observations they
        raised or own are kept.
        <br />
        <br />
        💡 Prefer <b>Make inactive</b> if you only want to block sign-in — it keeps the account and
        can be reversed anytime.
      </div>
      <div className="obs-field" style={{ marginTop: 10 }}>
        <div className="ttl">Name</div>
        <div className="txt">{user.name}</div>
      </div>
      <div className="obs-field">
        <div className="ttl">Email</div>
        <div className="txt">{user.email}</div>
      </div>
      <div className="obs-field">
        <div className="ttl">Role</div>
        <div className="txt">
          {roleLabel(user.role)}
          {user.department ? " · " + user.department : ""}
        </div>
      </div>
      {steps ? (
        <div style={{ marginTop: 10 }}>
          <div className="note" style={{ padding: "10px 14px" }}>
            {steps.map((s) => (
              <div key={s.label} style={{ margin: "4px 0", opacity: s.state === "pending" ? 0.5 : undefined }}>
                {DEL_ICONS[s.state]} {s.label}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {err ? (
        <div className="ai-err" style={{ marginTop: 10 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}

/* ---------------- modalExcoRecipient / saveExcoRecipient ---------------- */

export function ExcoRecipientDialog({ recipientId }: { recipientId?: string }) {
  const { db, mutate } = useWorkspace();
  const modal = useModal();
  const existing = recipientId
    ? (db.exco?.recipientList || []).find((x) => x.id === recipientId)
    : undefined;

  const [name, setName] = useState(existing?.name || "");
  const [role, setRole] = useState(existing?.role || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [err, setErr] = useState("");

  function save() {
    const nm = name.trim();
    const rl = role.trim();
    const em = email.trim().toLowerCase();
    if (!nm || !em || !em.includes("@")) {
      setErr("Name and a valid email are required.");
      return;
    }
    mutate((d) => {
      d.exco = d.exco || {};
      d.exco.recipientList = d.exco.recipientList || [];
      const L = d.exco.recipientList;
      if (recipientId) {
        const r = L.find((x) => x.id === recipientId);
        if (r) {
          r.name = nm;
          r.role = rl;
          r.email = em;
        }
      } else {
        L.push({ id: uid(), name: nm, role: rl, email: em });
      }
    });
    modal.close();
    toast("Recipient saved.", "success");
  }

  return (
    <ModalFrame
      title={recipientId ? "Edit recipient" : "Add MD & EXCO recipient"}
      footer={
        <>
          <button className="btn sec" type="button" onClick={modal.close}>
            Cancel
          </button>
          <button className="btn" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="f2">
        <div>
          <label>Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" />
        </div>
        <div>
          <label>Role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Managing Director"
          />
        </div>
      </div>
      <label>Email *</label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@credicorp.ng"
      />
      {err ? (
        <div className="ai-err" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </ModalFrame>
  );
}
