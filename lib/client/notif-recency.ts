/** Whether a notification timestamp falls on today or yesterday (local calendar days). */

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isRecentNotifAt(at: string | undefined, now = new Date()): boolean {
  if (!at) return false;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return false;
  const today = startOfLocalDay(now);
  const yesterday = today - 86_400_000;
  const day = startOfLocalDay(when);
  return day === today || day === yesterday;
}
