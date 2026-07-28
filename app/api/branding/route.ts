import { NextResponse } from "next/server";
import { defaultWorkspaceData } from "@/lib/db-data";
import { prisma } from "@/lib/prisma";

const DEFAULT_LOGO = "/org-logo.png";

// The workspace document is multi-megabytes (embedded base64 logo, SOP PDFs…). Branding only
// needs two fields, so extract them inside Postgres instead of shipping the whole blob over
// the wire — and cache the result briefly: it's hit on every login page and changes rarely.
let cache: { logo: string; org: string; at: number } | null = null;
const TTL_MS = 60_000;

export async function GET() {
  const fallbackOrg = defaultWorkspaceData().org || "AuditLens";
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(
      { logo: cache.logo, org: cache.org },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  }
  try {
    const rows = await prisma.$queryRaw<{ logo: string | null; org: string | null }[]>`
      SELECT data->>'logo' AS logo, data->>'org' AS org
      FROM "WorkspaceData" WHERE id = 'default'`;
    const row = rows[0];
    const logo = row?.logo || DEFAULT_LOGO;
    const org = row?.org || fallbackOrg;
    cache = { logo, org, at: Date.now() };
    return NextResponse.json(
      { logo, org },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch {
    return NextResponse.json({ logo: DEFAULT_LOGO, org: fallbackOrg });
  }
}
