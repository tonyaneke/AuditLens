import { NextResponse } from "next/server";
import { defaultWorkspaceData } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

// The logo is a static asset (public/org-logo.png) — only the org name comes from the
// workspace, extracted inside Postgres (never ship the multi-MB document for one field)
// and cached briefly: this endpoint is hit on every login-page load.
const STATIC_LOGO = "/org-logo.png";

let cache: { org: string; at: number } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  const fallbackOrg = defaultWorkspaceData().org || "AuditLens";
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(
      { logo: STATIC_LOGO, org: cache.org },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  }
  try {
    const rows = await prisma.$queryRaw<{ org: string | null }[]>`
      SELECT data->>'org' AS org FROM "WorkspaceData" WHERE id = 'default'`;
    const org = rows[0]?.org || fallbackOrg;
    cache = { org, at: Date.now() };
    return NextResponse.json(
      { logo: STATIC_LOGO, org },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return NextResponse.json({ logo: STATIC_LOGO, org: fallbackOrg });
  }
}
