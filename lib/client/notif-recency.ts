/** Whether a notification timestamp falls on today or yesterday (local calendar days). */

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayOf(at: string | undefined, now = new Date()): number | null {
  if (!at) return null;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  return startOfLocalDay(when);
}

export function isTodayNotifAt(at: string | undefined, now = new Date()): boolean {
  const d = dayOf(at, now);
  if (d == null) return false;
  return d === startOfLocalDay(now);
}

export function isYesterdayNotifAt(at: string | undefined, now = new Date()): boolean {
  const d = dayOf(at, now);
  if (d == null) return false;
  return d === startOfLocalDay(now) - 86_400_000;
}

export function isRecentNotifAt(at: string | undefined, now = new Date()): boolean {
  return isTodayNotifAt(at, now) || isYesterdayNotifAt(at, now);
}
