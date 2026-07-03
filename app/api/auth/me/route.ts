import { NextResponse } from "next/server";
import { getSessionWithFlags } from "@/lib/auth";

export async function GET() {
  const user = await getSessionWithFlags();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
