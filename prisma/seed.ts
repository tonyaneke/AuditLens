import { PrismaClient, Prisma } from "@prisma/client";
import { defaultWorkspaceData } from "../lib/db-data";

const prisma = new PrismaClient();

async function main() {
  const email = (
    process.env.HEAD_AUDIT_EMAIL || "head.audit@credicorp.ng"
  ).toLowerCase();
  const name = process.env.HEAD_AUDIT_NAME || "Awa Michael";
  const department = process.env.HEAD_AUDIT_DEPARTMENT || "Internal Audit";

  /* SEC-03 — the bootstrap Head of Audit is provisioned as an identity only. There is no
     HEAD_AUDIT_PASSWORD any more: this account signs in through Microsoft Entra like everyone
     else, and the row exists so that the SSO callback (which never creates users) finds one to
     match. Remove HEAD_AUDIT_PASSWORD from .env — nothing reads it. */
  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      department,
      role: "head_of_audit",
      sidebarAccess: [],
    },
    create: {
      name,
      email,
      department,
      role: "head_of_audit",
      sidebarAccess: [],
    },
  });

  await prisma.workspaceData.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      data: defaultWorkspaceData() as Prisma.InputJsonValue,
    },
  });

  console.log(`Seeded Head of Audit: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
