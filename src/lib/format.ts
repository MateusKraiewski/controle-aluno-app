import { addDays, parseLocalDate } from '../features/lessons/domain';
import type { Language } from './preferences';

function toDate(localDate: string): Date {
  const parts = parseLocalDate(localDate);
  if (!parts) return new Date(Number.NaN);
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** "terça-feira, 20 de outubro" in the chosen app language. */
export function prettyDate(localDate: string, language: Language): string {
  return toDate(localDate).toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Compact date with year, for history rows and alerts. */
export function shortDate(localDate: string, language: Language): string {
  return toDate(localDate).toLocaleDateString(language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** "19 – 25 out." for a Monday-based week starting at `from`. */
export function weekLabel(from: string, language: Language): string {
  const options = { day: 'numeric', month: 'short' } as const;
  return `${toDate(from).toLocaleDateString(language, options)} – ${toDate(addDays(from, 6)).toLocaleDateString(language, options)}`;
}

/** Date and time of an ISO timestamp (e.g. a backup's `exported_at`) in the app language. */
export function dateTime(iso: string, language: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
