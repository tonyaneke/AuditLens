import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { downloadFromSharePoint } from "@/lib/sharepoint";

export const runtime = "nodejs";

type Params = { params: Promise<{ itemId: string }> };

// Streams a SharePoint file back through the server, so users who don't have
// direct SharePoint access can still view evidence they're entitled to see.
export async function GET(_request: Request, { params }: Params) {
  try {
    await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { itemId } = await params;
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
