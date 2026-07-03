import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { isPasswordChangeRequired } from "../lib/auth-config";
import { defaultWorkspaceData } from "../lib/db-data";

const prisma = new PrismaClient();

async function main() {
  const email = (
    process.env.HEAD_AUDIT_EMAIL || "head.audit@credicorp.ng"
  ).toLowerCase();
  const password = process.env.HEAD_AUDIT_PASSWORD || "ChangeMe123!";
  const name = process.env.HEAD_AUDIT_NAME || "Awa Michael";
  const department = process.env.HEAD_AUDIT_DEPARTMENT || "Internal Audit";

  const passwordHash = await bcrypt.hash(password, 12);
  const mustChangePassword = isPasswordChangeRequired();

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      department,
      role: "head_of_audit",
      passwordHash,
      sidebarAccess: [],
      mustChangePassword,
    },
    create: {
      name,
      email,
      department,
      role: "head_of_audit",
      passwordHash,
      sidebarAccess: [],
      mustChangePassword,
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
