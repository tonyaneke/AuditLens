import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { clearSession, getSessionWithFlags } from "@/lib/auth";

export async function POST() {
  const session = await getSessionWithFlags();

  if (session) {
    // Signing out must always clear the cookie, whatever happens to the log entry.
    await writeAuditLog({
      user: session,
      action: "auth.logout",
      category: "auth",
      summary: `${session.name} signed out`,
      metadata: { email: session.email },
    }).catch((e) => console.error("[audit] could not record sign-out", e));
  }

  await clearSession();
  return NextResponse.json({ ok: true });
}
