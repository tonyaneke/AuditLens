/**
 * First-login password change is always mandatory. A user whose
 * mustChangePassword flag is set in the database must set a new password
 * before they can use the app — there is no way to disable this.
 */
export function effectiveMustChangePassword(stored: boolean) {
  return stored;
}
