import { NextResponse } from "next/server";
import { requireHeadOfAudit } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";
import { loginUrlFromRequest, sendExecutiveOnboardingEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import type { WorkspaceDb } from "@/lib/db-data";
import { withoutDeleted } from "@/lib/workspace-tombstones";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireHeadOfAudit();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    userId?: string;
    email?: string;
    allExecutives?: boolean;
    isTest?: boolean;
    testEmail?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const loginUrl = loginUrlFromRequest(request);

  // 1. Handle test email explicitly
  if (body.isTest || body.testEmail) {
    const targetEmail = (body.testEmail || body.email || "eanishe@credicorp.ng").trim().toLowerCase();
    const targetName = body.testEmail ? "Eniola Anishe (Test)" : "Executive Test Recipient";

    const res = await sendExecutiveOnboardingEmail({
      to: targetEmail,
      name: targetName,
      loginUrl,
      roleTitle: "Executive / Governance Reviewer",
      isTest: true,
    });

    if (!res.sent) {
      return NextResponse.json(
        { error: res.error || "Failed to send test email." },
        { status: 500 },
      );
    }

    await writeAuditLog({
      user: session,
      action: "user.onboarding_test_sent",
      category: "user",
      summary: `Sent executive onboarding test preview email to ${targetEmail}`,
      metadata: { targetEmail, test: true },
    });

    return NextResponse.json({
      success: true,
      test: true,
      recipient: targetEmail,
      message: `Test onboarding email sent to ${targetEmail}`,
    });
  }

  // 2. Handle onboarding all executives (captures both initial onboarding & re-onboarding)
  if (body.allExecutives) {
    // Sync any exco recipients into prisma.user with role = 'executive'
    const ws = await prisma.workspaceData.findFirst();
    const wsData = withoutDeleted((ws?.data || {}) as WorkspaceDb) as Record<string, unknown>;
    const excoData = (wsData.exco || {}) as { recipientList?: Array<{ name?: string; email?: string; role?: string }> };
    const excoRecipients = excoData.recipientList || [];

    for (const r of excoRecipients) {
      const em = (r.email || "").trim().toLowerCase();
      if (!em || !em.includes("@")) continue;
      const existing = await prisma.user.findUnique({ where: { email: em } });
      if (!existing) {
        await prisma.user.create({
          data: {
            name: r.name || "Executive Member",
            email: em,
            department: "Office of the Managing Director",
            role: "executive",
            active: true,
          },
        });
      } else if (existing.role !== "executive") {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: "executive", active: true },
        });
      }
    }

    const execUsers = await prisma.user.findMany({
      where: { role: "executive" },
    });

    if (!execUsers.length) {
      return NextResponse.json(
        { error: "No executive users found to onboard." },
        { status: 404 },
      );
    }

    const results: Array<{ email: string; name: string; sent: boolean; error?: string }> = [];

    for (const u of execUsers) {
      const emailResult = await sendExecutiveOnboardingEmail({
        to: u.email,
        name: u.name,
        loginUrl,
        roleTitle: "Executive Management / MD & EXCO",
        isTest: false,
      });

      if (emailResult.sent) {
        await prisma.user.update({
          where: { id: u.id },
          data: {
            active: true,
            role: "executive",
            welcomeEmailSentAt: new Date(),
          },
        });
      }

      results.push({
        email: u.email,
        name: u.name,
        sent: emailResult.sent,
        error: emailResult.sent ? undefined : emailResult.error,
      });
    }

    const sentCount = results.filter((r) => r.sent).length;

    await writeAuditLog({
      user: session,
      action: "executive.onboarded_all",
      category: "user",
      summary: `Sent executive onboarding invitations (including re-onboarding) to ${sentCount} of ${execUsers.length} executive(s)`,
      metadata: { results, count: sentCount },
    });

    return NextResponse.json({
      success: true,
      total: execUsers.length,
      sentCount,
      results,
    });
  }

  // 3. Handle single user onboarding
  let targetUser = null;
  if (body.userId) {
    targetUser = await prisma.user.findUnique({ where: { id: body.userId } });
  } else if (body.email) {
    const emailLc = body.email.trim().toLowerCase();
    targetUser = await prisma.user.findUnique({ where: { email: emailLc } });
  }

  if (!targetUser) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // If in exco recipients list, ensure role is executive so they have the executive view
  const ws = await prisma.workspaceData.findFirst();
  const wsData = withoutDeleted((ws?.data || {}) as WorkspaceDb) as Record<string, unknown>;
  const excoData = (wsData.exco || {}) as { recipientList?: Array<{ email?: string }> };
  const inExco = (excoData.recipientList || []).some(
    (r) => (r.email || "").trim().toLowerCase() === targetUser!.email.toLowerCase(),
  );
  if (inExco && targetUser.role !== "executive") {
    targetUser = await prisma.user.update({
      where: { id: targetUser.id },
      data: { role: "executive", active: true },
    });
  }

  const roleTitle =
    targetUser.role === "executive"
      ? "Executive Management / MD & EXCO"
      : targetUser.role === "action_owner"
      ? "Department Action Owner"
      : "Audit Team";

  const emailResult = await sendExecutiveOnboardingEmail({
    to: targetUser.email,
    name: targetUser.name,
    loginUrl,
    roleTitle,
    isTest: false,
  });

  if (!emailResult.sent) {
    return NextResponse.json(
      { error: emailResult.error || "Failed to send onboarding email." },
      { status: 500 },
    );
  }

  await prisma.user.update({
    where: { id: targetUser.id },
    data: {
      active: true,
      welcomeEmailSentAt: new Date(),
    },
  });

  await writeAuditLog({
    user: session,
    action: "executive.onboarded",
    category: "user",
    summary: `Sent onboarding email to ${targetUser.name} (${targetUser.email})`,
    metadata: {
      targetUserId: targetUser.id,
      targetEmail: targetUser.email,
      role: targetUser.role,
    },
  });

  return NextResponse.json({
    success: true,
    user: { id: targetUser.id, email: targetUser.email, name: targetUser.name },
  });
}
