import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { photoUrlFor } from "@/lib/photo-url";
import { prisma } from "@/lib/prisma";

// Minimal user directory available to any signed-in user, used to populate
// assignment selects (lead auditor, verifiers). No password/flags exposed.
export async function GET() {
  try {
    await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      department: true,
      role: true,
      photo: true,
      active: true,
      updatedAt: true,
    },
  });

  /* QA-19 — return a cacheable URL per photo instead of the stored base64 data URL. This
     response carried ~109 KB of inline images for nine users and was re-fetched several times
     per page load; it is now a few KB regardless of headcount, and the images themselves are
     cached by the browser after first sight. */
  const users = rows.map(({ photo, updatedAt, ...u }) => ({
    ...u,
    photo: photoUrlFor({ id: u.id, photo, updatedAt }),
  }));

  return NextResponse.json({ users });
}
