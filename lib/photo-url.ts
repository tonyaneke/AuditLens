/* QA defect #19 — one place that decides how a profile photo is addressed.
 *
 * Every API that returns a user (directory, user management, /api/auth/me) used to inline the
 * stored base64 data URL. They now return this URL instead, pointing at
 * app/api/users/[id]/photo/route.ts.
 *
 * The field is still called `photo` on purpose: every consumer already does
 * `<img src={user.photo}>`, and a URL works there exactly as a data URL did — so the payload
 * problem is fixed without touching a single rendering site.
 */

export function photoUrlFor(
  user: { id: string; photo?: string | null; updatedAt?: Date | string | null },
): string | null {
  if (!user.photo) return null;
  // Version stamp: changes only when the user row changes, so the URL is stable and the
  // response can be cached immutably.
  const v = user.updatedAt
    ? new Date(user.updatedAt).getTime()
    : 0;
  return `/api/users/${user.id}/photo?v=${v}`;
}
