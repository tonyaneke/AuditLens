import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const ws = await prisma.workspaceData.findUnique({ where: { id: "default" } });
  const data = ws?.data as any;
  const financeDept = (data?.departments || []).filter((d: any) => d.name?.toLowerCase().includes("finance"));
  console.log("Finance dept in workspaceData:", JSON.stringify(financeDept, null, 2));

  const allDepts = (data?.departments || []).map((d: any) => ({ id: d.id, name: d.name, headName: d.headName, headEmail: d.headEmail }));
  console.log("All workspace departments:", JSON.stringify(allDepts, null, 2));

  const financeUsers = await prisma.user.findMany({
    where: { department: { contains: "Finance", mode: "insensitive" } },
    select: { id: true, name: true, email: true, department: true, role: true }
  });
  console.log("Finance users in DB:", JSON.stringify(financeUsers, null, 2));
}

main().finally(() => prisma.$disconnect());
