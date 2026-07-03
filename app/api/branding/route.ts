import { NextResponse } from "next/server";
import { defaultWorkspaceData, type WorkspaceDb } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

const DEFAULT_LOGO = "/org-logo.png";

export async function GET() {
  try {
    const row = await prisma.workspaceData.findUnique({ where: { id: "default" } });
    const data = (row?.data as WorkspaceDb) || defaultWorkspaceData();
    const logo = typeof data.logo === "string" && data.logo ? data.logo : DEFAULT_LOGO;
    const org = typeof data.org === "string" && data.org ? data.org : defaultWorkspaceData().org;

    return NextResponse.json({ logo, org });
  } catch {
    return NextResponse.json({
      logo: DEFAULT_LOGO,
      org: defaultWorkspaceData().org,
    });
  }
}
