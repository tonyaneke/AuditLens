// Tests for lib/admin-credential.ts — the Admin profile's password hashing and policy.
// Run with: npm test   (or: npx tsx scripts/admin-credential.test.mts)
import {
  adminLoginEnabled,
  hashPassword,
  normalizeUsername,
  passwordProblem,
  verifyPassword,
} from "../lib/admin-credential";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log("  ok " + msg); } else { fail++; console.error("  x FAIL: " + msg); } }

console.log("\n== Hashing ==");
{
  const pw = "correct horse battery staple";
  const h1 = await hashPassword(pw);
  const h2 = await hashPassword(pw);
  ok(h1.startsWith("scrypt$32768$8$1$"), "the stored value names its algorithm and cost");
  ok(h1 !== h2, "each hash is salted — the same password never stores the same way twice");
  ok(!h1.includes(pw), "the password itself is not in the stored value");
  ok(await verifyPassword(pw, h1), "the right password verifies");
  ok(!(await verifyPassword(pw + " ", h1)), "a near miss does not");
  ok(!(await verifyPassword("", h1)), "an empty password does not");
  ok(!(await verifyPassword(pw, "")), "an empty stored value never verifies");
  ok(!(await verifyPassword(pw, "plain$" + pw)), "a value in another format never verifies");
  const [, , r, p, salt, key] = h1.split("$");
  ok(!(await verifyPassword(pw, ["scrypt", String(2 ** 24), r, p, salt, key].join("$"))), "a stored cost beyond the ceiling is refused, not run");
}

console.log("\n== Policy ==");
{
  ok(passwordProblem("short") !== null, "too short is refused");
  ok(passwordProblem("aaaaaaaaaaaaaaaaaaaa") !== null, "a repetitive password is refused");
  ok(passwordProblem("Tr1cky-Lens-Audit-26") === null, "a reasonable one is accepted");
  ok(normalizeUsername("  Admin ") === "admin", "usernames compare case-insensitively");
}

console.log("\n== The off switch ==");
{
  const was = process.env.ADMIN_LOGIN_ENABLED;
  delete process.env.ADMIN_LOGIN_ENABLED;
  ok(adminLoginEnabled(), "on by default — nothing to set");
  process.env.ADMIN_LOGIN_ENABLED = "true";
  ok(adminLoginEnabled(), "on when set to true");
  process.env.ADMIN_LOGIN_ENABLED = " FALSE ";
  ok(!adminLoginEnabled(), "off only when explicitly set to false");
  if (was === undefined) delete process.env.ADMIN_LOGIN_ENABLED;
  else process.env.ADMIN_LOGIN_ENABLED = was;
}

console.log("\n----------------------------------------");
console.log(`${pass}/${pass + fail} assertions passed` + (fail ? `, ${fail} FAILED` : ""));
process.exit(fail ? 1 : 0);
