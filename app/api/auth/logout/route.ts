import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { clearSession, getSessionWithFlags } from "@/lib/auth";

export async function POST() {
  const session = await getSessionWithFlags();

  if (session) {
    await writeAuditLog({
      user: session,
      action: "auth.logout",
      category: "auth",
      summary: `${session.name} signed out`,
      metadata: { email: session.email },
    });
  }

  await clearSession();
  return NextResponse.json({ ok: true });
}
