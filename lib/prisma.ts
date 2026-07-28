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

// The database sits behind a remote TCP proxy (Railway) that silently kills idle
// connections. A pooled connection can therefore be dead by the time the next query
// picks it up — the query fails with a connection error even though the server is
// fine, and a fresh connection would succeed. Retry those (and only those) errors:
// the first retry re-establishes the connection. Writes here are idempotent
// (upserts / full-document PUTs), so a retry after an ambiguous failure is safe.
function isTransientDbError(e: unknown): boolean {
  const code = (e as { errorCode?: string; code?: string })?.errorCode ||
    (e as { code?: string })?.code || "";
  if (code === "P1001" || code === "P1002" || code === "P1008" || code === "P1017") return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Can't reach database server|Connection reset|ECONNRESET|EPIPE|Closed connection|connection closed|Server has closed the connection|Timed out fetching a new connection/i.test(
    msg,
  );
}

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Pass the cleaned URL explicitly so the runtime client uses it even if the
    // schema-level env() resolved a quoted/whitespaced value.
    ...(dbUrl ? { datasources: { db: { url: dbUrl } } } : {}),
  }).$extends({
    query: {
      async $allOperations({ query, args }) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            lastErr = e;
            if (!isTransientDbError(e) || attempt === 2) throw e;
            await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  });
}

type ExtendedPrisma = ReturnType<typeof createPrisma>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
