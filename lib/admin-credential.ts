import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/* The Admin profile's password sign-in — the ONE exception to Microsoft-only sign-in (SEC-03).
 *
 * WHY IT EXISTS. The admin role views the app as any role, and as any department's action owner,
 * which is how Internal Audit tests a flow end to end without signing in as a real person. Giving
 * that role to a real member of staff tied it to their Microsoft account; the Admin profile is a
 * separate account that has no Microsoft identity, so it needs a credential of its own.
 *
 * WHAT IT DOES NOT HAVE that Microsoft sign-in does: MFA and conditional access. That is the cost
 * SEC-03 was about, so the surface is kept as small as it can be:
 *   - only an account whose role is "admin" can use it — app/api/auth/admin-login checks the role
 *     at sign-in and lib/auth.ts re-checks it on every request;
 *   - it is on by default (the Head of Audit asked for no set-up step), and ADMIN_LOGIN_ENABLED=false
 *     is an emergency off switch that also voids every session it issued — the next request from
 *     one is signed out. With no AdminCredential row seeded there is nothing to sign in to anyway;
 *   - five wrong passwords in a row lock the account for 15 minutes (kept in the database, so a
 *     restart does not reset it), and the sign-in route also throttles by IP;
 *   - its sessions last 8 hours, not the 7 days a Microsoft session does;
 *   - rotating the password (scripts/seed-admin-profile.mts --reset-password) voids every session
 *     issued before it;
 *   - every success, failure and lock-out is written to the audit trail as "Admin password".
 *
 * Pure node:crypto — no Prisma — so the seeding script can import it without a database client. */

/** The session's authMethod for a password sign-in. Distinct from "sso" and "dev" everywhere. */
export const ADMIN_AUTH_METHOD = "local";

export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 14;
// Anything longer is refused before hashing, so a huge body cannot buy a long scrypt.
const MAX_PASSWORD_LENGTH = 256;

/** On unless ADMIN_LOGIN_ENABLED=false. Read per call, so flipping the variable needs no rebuild. */
export function adminLoginEnabled(): boolean {
  return process.env.ADMIN_LOGIN_ENABLED?.trim().toLowerCase() !== "false";
}

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().slice(0, 64);
}

/** Why a new password is unacceptable, or null when it is fine. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (pw.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (new Set(pw).size < 6) return "Use a less repetitive password.";
  return null;
}

/* ---------------- hashing ----------------

   Stored as  scrypt$<N>$<r>$<p>$<salt, base64>$<hash, base64>  so the cost can be raised later
   without invalidating what is already stored: verification reads the parameters back off the
   value. N = 2^15, r = 8 is ~32 MiB and ~100 ms per attempt — slow enough to make an offline
   guess at a leaked hash expensive, fast enough that nobody waits on a sign-in. */

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
// Node's default ceiling (32 MiB) is exactly what N=2^15, r=8 needs, and scrypt refuses at the edge.
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Bounds on what we will run: a corrupted row must not be able to request gigabytes.
  if (!Number.isInteger(n) || n < 2 ** 14 || n > 2 ** 20 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 4) {
    return false;
  }
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (!salt.length || !expected.length) return false;
  try {
    const key = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: Math.max(MAXMEM, 256 * n * r) });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/* An unknown username still pays for one scrypt, so how long a refusal takes does not reveal
   whether the username exists. The hash is of random bytes nobody knows; it never verifies. */
let dummy: Promise<string> | null = null;
export async function burnVerification(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(24).toString("base64"));
  await verifyPassword(password || "x", await dummy);
}
