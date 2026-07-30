import { NextResponse } from "next/server";
import { getSessionWithFlags, createSession } from "@/lib/auth";
import { type SessionUser } from "@/lib/permissions";

const SWITCHABLE_ROLES = ["head_of_audit", "audit_staff", "action_owner"] as const;

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

    // Create updated session with activeRole
    const updatedUser: SessionUser = {
      ...session,
      activeRole: role,
    };

    // Re-sign the session with the activeRole
    await createSession(updatedUser);

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: `Now viewing as ${role.replace(/_/g, " ")}`,
    });
  } catch (error) {
    console.error("Role switch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
