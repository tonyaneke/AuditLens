import os from "node:os";
import type { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { prisma } from "./prisma";
import { effectiveRole, type SessionUser } from "./permissions";

export { actionLabel, isClientAuditAction } from "./audit-actions";

export const AUDIT_CATEGORIES = [
  "auth",
  "user",
  "data",
  "workspace",
  "security",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Who an entry is attributed to. Pass the session itself: besides the user it carries how the
 *  session was established (lib/auth.ts), and that is what tells a person apart from someone
 *  signed in as them. */
export type AuditActor = Pick<SessionUser, "id" | "name" | "email"> &
  Partial<Pick<SessionUser, "role" | "activeRole" | "sessionId" | "authMethod" | "operator">>;

export type AuditEntry = {
  action: string;
  category: AuditCategory;
  summary: string;
  metadata?: Record<string, unknown>;
};

type AuditLogInput = AuditEntry & {
  user?: AuditActor | null;
  /** For an entry no one signed in wrote: "system" is a scheduled job. A maintenance script is
   *  recognised on its own — it runs outside any request. */
  via?: "system";
};

/** Who is operating this machine: the name a maintenance script, or a developer sign-in served by
 *  this machine, is recorded under. DEV_OPERATOR in .env overrides it with a friendlier name. */
export function machineOperator(): string {
  const configured = process.env.DEV_OPERATOR?.trim();
  if (configured) return configured.slice(0, 120);
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    /* no passwd entry, e.g. a bare container */
  }
  return `${user || "unknown user"} on ${os.hostname() || "unknown machine"}`;
}

type Provenance = {
  userRole: string | null;
  authMethod: string | null;
  actorName: string | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** The requesting browser's address and user agent — or null outside a request, which is how a
 *  script run from a terminal is recognised. On Vercel x-forwarded-for is set by the platform
 *  (a client-supplied value is overwritten), so its first entry is the real client. */
async function requestContext(): Promise<{ ip: string | null; userAgent: string | null } | null> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "").trim();
    return { ip: ip || null, userAgent: h.get("user-agent")?.slice(0, 300) || null };
  } catch {
    return null;
  }
}

async function provenance(user: AuditActor | null | undefined, via?: "system"): Promise<Provenance> {
  const ctx = await requestContext();
  const where = { ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null };
  if (user) {
    return {
      ...where,
      // The role the action was taken under. An admin is recorded with the view they had switched
      // to, because that — not "admin" — is what the permission checks applied.
      userRole: user.role
        ? user.role === "admin"
          ? `admin:${effectiveRole(user as SessionUser)}`
          : user.role
        : null,
      authMethod: user.authMethod || null,
      // Only a developer sign-in is operated by someone other than the account holder.
      actorName: user.authMethod === "dev" ? user.operator || "an unidentified developer" : null,
      sessionId: user.sessionId || null,
    };
  }
  if (!ctx) {
    return { ...where, userRole: null, authMethod: "script", actorName: machineOperator(), sessionId: null };
  }
  return { ...where, userRole: null, authMethod: via || null, actorName: null, sessionId: null };
}

function identity(user: AuditActor | null | undefined, prov: Provenance) {
  const fallback =
    prov.authMethod === "script" ? "Maintenance script" : prov.authMethod === "system" ? "Scheduled job" : "System";
  return {
    userId: user?.id ?? null,
    userName: user?.name?.trim() || fallback,
    userEmail: user?.email?.trim() || "",
  };
}

function row(entry: AuditEntry, who: ReturnType<typeof identity>, prov: Provenance) {
  return {
    ...who,
    ...prov,
    action: entry.action.slice(0, 80),
    category: entry.category,
    summary: entry.summary.trim().slice(0, 500),
    metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : undefined,
  };
}

/* Until scripts/add-audit-provenance.mts has run, the provenance columns do not exist and Prisma
   fails the whole insert (P2022). Rather than let the deploy order turn sign-out or user management
   into a 500, the entry is written with the columns every deployment has and its provenance is kept
   in the metadata — the log viewer reads it from there. Nothing is lost either way. */
function isMissingColumn(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "P2022";
}

function withoutProvenanceColumns(r: ReturnType<typeof row>) {
  const { userRole, authMethod, actorName, sessionId, ip, userAgent, ...rest } = r;
  const meta = r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : {};
  return {
    ...rest,
    metadata: { ...meta, provenance: { userRole, authMethod, actorName, sessionId, ip, userAgent } } as Prisma.InputJsonValue,
  };
}

export async function writeAuditLog(input: AuditLogInput) {
  if (!input.summary.trim()) return;
  const prov = await provenance(input.user, input.via);
  const data = row(input, identity(input.user, prov), prov);
  try {
    await prisma.auditLog.create({ data });
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    await prisma.auditLog.create({ data: withoutProvenanceColumns(data) });
  }
}

/** Several entries from one request — a workspace save's changes — as a single insert. */
export async function writeAuditLogs(
  user: AuditActor | null | undefined,
  entries: AuditEntry[],
  opts: { via?: "system" } = {},
) {
  const real = entries.filter((e) => e.summary.trim());
  if (!real.length) return;
  const prov = await provenance(user, opts.via);
  const who = identity(user, prov);
  const data = real.map((e) => row(e, who, prov));
  try {
    await prisma.auditLog.createMany({ data });
  } catch (e) {
    if (!isMissingColumn(e)) throw e;
    await prisma.auditLog.createMany({ data: data.map(withoutProvenanceColumns) });
  }
}

export function categoryForAction(action: string): AuditCategory {
  const prefix = action.split(".")[0];
  if (prefix === "auth") return "auth";
  if (prefix === "user") return "user";
  if (prefix === "data") return "data";
  if (prefix === "security") return "security";
  return "workspace";
}
