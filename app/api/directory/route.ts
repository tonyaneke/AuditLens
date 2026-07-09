import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Minimal user directory available to any signed-in user, used to populate
// assignment selects (lead auditor, verifiers). No password/flags exposed.
export async function GET() {
  try {
    await requireActiveSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, department: true, role: true },
  });

  return NextResponse.json({ users });
}
