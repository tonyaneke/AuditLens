import { NextResponse } from "next/server";
import { getSessionWithFlags, createSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { actingDepartment, effectiveRole, roleLabel, type SessionUser } from "@/lib/permissions";

const SWITCHABLE_ROLES = ["head_of_audit", "audit_staff", "action_owner", "executive"] as const;

/** What a view is called in the trail: the role, and for an action owner the department too. */
function viewName(u: SessionUser): string {
  const role = effectiveRole(u);
  return role === "action_owner" ? `${roleLabel(role)} (${actingDepartment(u) || "no department"})` : roleLabel(role);
}

export async function POST(request: Request) {
  try {
    /* getSessionWithFlags, not getSession: the latter trusts the JWT alone, so a deactivated or
       deleted admin could keep switching roles — and re-signing their cookie — for the remaining
       life of the token. This was the only auth route that skipped the DB re-check. */
    const session = await getSessionWithFlags();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admin users can switch roles
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: Only admin users can switch roles" }, { status: 403 });
    }

    const body = await request.json();
    const { role } = body;

    // Validate the target role
    if (!role || !(SWITCHABLE_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${SWITCHABLE_ROLES.join(", ")}` },
        { status: 400 }
      );
    }

    /* The action owner's view acts for ONE department, picked here (components/RoleSwitcher.tsx).
       Any name is safe to accept: scope resolves a department by name against the workspace
       (lib/dept-scope.ts), so a name nobody uses simply scopes to nothing. Omitted, the department
       already being acted for is kept; with none, the view falls back to the admin's own
       department. Every other view drops it. */
    let activeDepartment: string | undefined;
    if (role === "action_owner") {
      const raw = body.department === undefined ? session.activeDepartment : body.department;
      activeDepartment = String(raw ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 120) || undefined;
    }

    // Create updated session with activeRole
    const updatedUser: SessionUser = {
      ...session,
      activeRole: role,
      activeDepartment,
    };

    // Re-sign the session with the activeRole
    await createSession(updatedUser);

    /* Recorded because the switch changes what this person may do: every entry until the next
       switch is taken under the new role (the entries' userRole says "admin:<role>"), and as an
       action owner, for the department named here. */
    await writeAuditLog({
      user: updatedUser,
      action: "auth.role_switched",
      category: "auth",
      summary: `${session.name} switched from the ${viewName(session)} view to ${viewName(updatedUser)}`,
      metadata: {
        from: effectiveRole(session),
        to: role,
        ...(session.activeDepartment ? { fromDepartment: session.activeDepartment } : {}),
        ...(activeDepartment ? { department: activeDepartment } : {}),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: `Now viewing as ${viewName(updatedUser)}`,
    });
  } catch (error) {
    console.error("Role switch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
