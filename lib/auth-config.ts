/** When false, first-login password change is disabled app-wide. */
export function isPasswordChangeRequired() {
  return process.env.REQUIRE_PASSWORD_CHANGE === "true";
}

export function effectiveMustChangePassword(stored: boolean) {
  return isPasswordChangeRequired() && stored;
}
