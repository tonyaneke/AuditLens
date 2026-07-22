import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireActiveSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";
import { authorizeWorkspaceWrite } from "@/lib/workspace-authz";

const WORKSPACE_ID = "default";

export async function GET() {
  try {
    await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const data = (row?.data as WorkspaceDb) || defaultWorkspaceData();
  return NextResponse.json({ data, updatedAt: row?.updatedAt ?? null });
}

export async function PUT(request: Request) {
  let session;
  try {
    session = await requireActiveSession();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (message === "PasswordChangeRequired") {
      return NextResponse.json({ error: "Password change required." }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { data?: WorkspaceDb };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body.data || !Array.isArray(body.data.audits)) {
    return NextResponse.json(
      { error: "Invalid workspace data — audits array required." },
      { status: 400 },
    );
  }

  // Authorize the write against the stored workspace: non-head users may only make the changes their
  // role permits (raise observations, request approvals, comment, remediate). Anything else — editing/
  // deleting/withdrawing/closing observations directly, deciding approvals, touching head-only
  // sections — is reconciled away server-side so the client cannot bypass the approval workflow.
  const existing = await prisma.workspaceData.findUnique({ where: { id: WORKSPACE_ID } });
  const current = (existing?.data as WorkspaceDb) || defaultWorkspaceData();
  const { data: authorized, violations } = authorizeWorkspaceWrite(
    session.role,
    session.id,
    current,
    body.data,
  );

  const payload = authorized as Prisma.InputJsonValue;

  const row = await prisma.workspaceData.upsert({
    where: { id: WORKSPACE_ID },
    update: { data: payload },
    create: { id: WORKSPACE_ID, data: payload },
  });

  if (violations.length) {
    // Persisted the sanitized document; record what was filtered for the security trail.
    await writeAuditLog({
      user: session,
      action: "security.workspace_write_filtered",
      category: "security",
      summary: `Reconciled ${violations.length} disallowed change(s) from a ${session.role} workspace write`,
      metadata: { violations: violations.slice(0, 50), count: violations.length },
    }).catch(() => {});
  }

  return NextResponse.json({
    data: row.data as WorkspaceDb,
    updatedAt: row.updatedAt,
  });
}
