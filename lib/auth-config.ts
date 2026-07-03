/**
 * When true, users with mustChangePassword in the database must set a new
 * password before using the app. When false, first-login password change is
 * disabled app-wide (restart the dev server after changing this value).
 */
export function isPasswordChangeRequired() {
  return process.env.REQUIRE_PASSWORD_CHANGE === "true";
}

/** DB flag, gated by REQUIRE_PASSWORD_CHANGE. */
export function effectiveMustChangePassword(stored: boolean) {
  return isPasswordChangeRequired() && stored;
}
