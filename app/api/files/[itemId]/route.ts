import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { fileVisibleTo } from "@/lib/file-access";
import { prisma } from "@/lib/prisma";
import { downloadFromSharePoint } from "@/lib/sharepoint";
import { withoutDeleted } from "@/lib/workspace-tombstones";
import { viewerFor } from "@/lib/workspace-scope";

export const runtime = "nodejs";

const WORKSPACE_ID = "default";

type Params = { params: Promise<{ itemId: string }> };

// Streams a SharePoint file back through the server, so users who don't have
// direct SharePoint access can still view evidence they're entitled to see —
// and only that: the file must be attached to a record served to this viewer
// (see lib/file-access.ts).
export async function GET(_request: Request, { params }: Params) {
  let session;
  try {
    session = await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { itemId } = await params;

  const row = await prisma.workspaceData.findUnique({
    where: { id: WORKSPACE_ID },
    select: { data: true },
  });
  const doc = withoutDeleted((row?.data as WorkspaceDb) || defaultWorkspaceData());
  if (!fileVisibleTo(doc, viewerFor(session, doc), itemId)) {
    await writeAuditLog({
      user: session,
      action: "security.file_access_denied",
      category: "security",
      summary: `Refused a file download not attached to any record visible to this ${session.role}`,
      metadata: { itemId: String(itemId).slice(0, 200) },
    }).catch(() => {});
    // 404, not 403: whether a file exists is itself not the caller's to learn.
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  try {
    const { stream, contentType, name } = await downloadFromSharePoint(itemId);
    if (!stream) return NextResponse.json({ error: "No content." }, { status: 502 });
    return new NextResponse(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Download failed." },
      { status: 502 },
    );
  }
}
