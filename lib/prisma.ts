import { PrismaClient } from "@prisma/client";

// Normalise DATABASE_URL before Prisma reads it. Some hosting env setups store the
// value with surrounding quotes or stray whitespace/newlines (e.g. a value pasted as
// "postgres://..." including the quotes), which makes Prisma fail with
// "the URL must start with the protocol postgresql://". Strip those defensively.
function normalizeDbUrl(raw?: string) {
  if (!raw) return raw;
  let url = raw.trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  return url;
}

const dbUrl = normalizeDbUrl(process.env.DATABASE_URL);
if (dbUrl && dbUrl !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = dbUrl;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Pass the cleaned URL explicitly so the runtime client uses it even if the
    // schema-level env() resolved a quoted/whitespaced value.
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
