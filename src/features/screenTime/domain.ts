// Screen-time figures shown by the Screen time screen. Pure: no React/Expo.
import { addDays } from '../lessons/domain';

export type AppUsage = {
  packageName: string;
  label: string;
  foregroundMs: number;
  opens: number;
  lastUsed: number;
};

export type DayUsage = { apps: AppUsage[]; unlocks: number };

export function totalMs(day: DayUsage): number {
  return day.apps.reduce((sum, app) => sum + app.foregroundMs, 0);
}

/** "2 h 05 min", "45 min" or "< 1 min". */
export function formatDuration(ms: number, labels: { hour: string; minute: string; lessThanMinute: string }): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return labels.lessThanMinute;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${labels.minute}`;
  return `${hours} ${labels.hour} ${String(rest).padStart(2, '0')} ${labels.minute}`;
}

/** Local midnight-to-midnight bounds of a YYYY-MM-DD day, in epoch milliseconds. */
export function dayBounds(localDate: string): { start: number; end: number } {
  const [y, m, d] = localDate.split('-').map(Number);
  const [ny, nm, nd] = addDays(localDate, 1).split('-').map(Number);
  return { start: new Date(y, m - 1, d).getTime(), end: new Date(ny, nm - 1, nd).getTime() };
}

/** The last `count` days ending today, oldest first. */
export function lastDays(today: string, count = 7): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - count + 1));
}

/** Average of the days before `today` that had any use (days without data are not counted). */
export function averageOfPrevious(totals: readonly { localDate: string; ms: number }[], today: string): number | null {
  const previous = totals.filter((day) => day.localDate < today && day.ms > 0);
  if (previous.length === 0) return null;
  return previous.reduce((sum, day) => sum + day.ms, 0) / previous.length;
}

/** Share of the bar (0–1) for each value against the largest one. */
export function barRatio(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
}
