import { NextResponse } from "next/server";
import {
  createSession,
  findUserByEmail,
  userToSession,
  verifyPassword,
} from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 },
    );
  }

  const sessionUser = userToSession(user);
  await createSession(sessionUser);

  await writeAuditLog({
    user: sessionUser,
    action: "auth.login",
    category: "auth",
    summary: `${sessionUser.name} signed in`,
    metadata: { email: sessionUser.email },
  });

  return NextResponse.json({ user: sessionUser, mustChangePassword: user.mustChangePassword });
}
