/** When true, seeded Head of Audit must change password on first login. */
export function isPasswordChangeRequired() {
  return process.env.REQUIRE_PASSWORD_CHANGE === "true";
}

/** Per-user flag from the database — always honored for invited users. */
export function effectiveMustChangePassword(stored: boolean) {
  return stored;
}
