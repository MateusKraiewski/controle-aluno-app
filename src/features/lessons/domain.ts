// Pure lesson rules. No React, no SQLite, no platform APIs: this module runs under
// `node --test` and in the app. Dates are civil local dates (YYYY-MM-DD) and times
// are minutes since midnight, matching the SQLite schema.
import { normalizeForSearch } from '../../lib/text';

export const MIN_DURATION = 5;
export const MAX_DURATION = 480;
export const MAX_OCCURRENCES = 300;
/** Recurrence end date may be at most this many days after the start date. */
export const MAX_RECURRENCE_SPAN_DAYS = 366;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 80;
export const MAX_SEARCH_LENGTH = 100;

export type Frequency = 'weekly' | 'biweekly';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Formats a JS Date (in the device's local time zone) as YYYY-MM-DD. */
export function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Returns the date parts only if the string is a real calendar date. */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isValidLocalDate(value: string): boolean {
  return parseLocalDate(value) !== null;
}

// Calendar arithmetic runs in UTC so daylight-saving transitions never shift a civil date.
function toUtcMs(localDate: string): number {
  const parts = parseLocalDate(localDate);
  if (!parts) throw new RangeError(`Invalid local date: ${localDate}`);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function fromUtcMs(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(localDate: string, days: number): string {
  return fromUtcMs(toUtcMs(localDate) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(localDate: string): number {
  return new Date(toUtcMs(localDate)).getUTCDay();
}

/** Monday of the week containing the date (weeks start on Monday). */
export function startOfWeek(localDate: string): string {
  const offset = (weekdayOf(localDate) + 6) % 7;
  return addDays(localDate, -offset);
}

/** Half-open range [from, to) covering the Monday-based week of the date. */
export function weekRange(localDate: string): { from: string; to: string } {
  const from = startOfWeek(localDate);
  return { from, to: addDays(from, 7) };
}

export function parseTime(value: string): number | null {
  const match = /^(\d{1,2})[:h.](\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function formatTime(minutes: number): string {
  const safe = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

export function parseDuration(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const minutes = Number(value.trim());
  return minutes >= MIN_DURATION && minutes <= MAX_DURATION ? minutes : null;
}

export type LessonDraftInput = {
  subject: string;
  teacher: string;
  localDate: string;
  time: string;
  duration: string;
  plannedContent: string;
  studiedContent?: string;
  privateNotes?: string;
  nextStep?: string;
};

export type LessonDraft = {
  subject: string;
  teacher: string | null;
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  plannedContent: string | null;
  studiedContent: string | null;
  privateNotes: string | null;
  nextStep: string | null;
};

export type DraftError = 'subjectRequired' | 'subjectTooLong' | 'teacherTooLong' | 'dateFormat' | 'dateInvalid' | 'time' | 'duration' | 'textTooLong';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

function optionalText(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

export function validateLessonDraft(input: LessonDraftInput): Result<LessonDraft, DraftError> {
  const subject = input.subject.trim().replace(/\s+/g, ' ');
  if (!subject) return { ok: false, error: 'subjectRequired' };
  if (subject.length > MAX_NAME_LENGTH) return { ok: false, error: 'subjectTooLong' };
  const teacher = optionalText(input.teacher);
  if (teacher && teacher.length > MAX_NAME_LENGTH) return { ok: false, error: 'teacherTooLong' };
  const localDate = input.localDate.trim();
  if (!DATE_PATTERN.test(localDate)) return { ok: false, error: 'dateFormat' };
  if (!isValidLocalDate(localDate)) return { ok: false, error: 'dateInvalid' };
  const startMinute = parseTime(input.time);
  if (startMinute === null) return { ok: false, error: 'time' };
  const durationMinutes = parseDuration(input.duration);
  if (durationMinutes === null) return { ok: false, error: 'duration' };
  const plannedContent = optionalText(input.plannedContent);
  const studiedContent = optionalText(input.studiedContent);
  const privateNotes = optionalText(input.privateNotes);
  const nextStep = optionalText(input.nextStep);
  if ([plannedContent, studiedContent, privateNotes, nextStep].some((text) => (text?.length ?? 0) > MAX_TEXT_LENGTH)) {
    return { ok: false, error: 'textTooLong' };
  }
  return { ok: true, value: { subject, teacher, localDate, startMinute, durationMinutes, plannedContent, studiedContent, privateNotes, nextStep } };
}

export type RecurrenceInput = {
  startDate: string;
  endDate: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekdays: readonly number[];
  frequency: Frequency;
  cap?: number;
};

export type RecurrenceError = 'endDateFormat' | 'endBeforeStart' | 'spanTooLong' | 'noWeekdays' | 'noOccurrences';

/**
 * Expands a weekly/biweekly rule into concrete dates, inclusive of both ends.
 * Biweekly counts weeks (Monday-based) from the week of the start date: weeks 0, 2, 4…
 * Returns `truncated: true` when the cap stopped the expansion.
 */
export function generateOccurrences(input: RecurrenceInput): Result<{ dates: string[]; truncated: boolean }, RecurrenceError> {
  if (!isValidLocalDate(input.startDate)) throw new RangeError('startDate must be validated first');
  if (!isValidLocalDate(input.endDate)) return { ok: false, error: 'endDateFormat' };
  const span = daysBetween(input.startDate, input.endDate);
  if (span < 0) return { ok: false, error: 'endBeforeStart' };
  if (span > MAX_RECURRENCE_SPAN_DAYS) return { ok: false, error: 'spanTooLong' };
  const weekdays = new Set(input.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (weekdays.size === 0) return { ok: false, error: 'noWeekdays' };
  const cap = Math.max(1, Math.min(input.cap ?? MAX_OCCURRENCES, MAX_OCCURRENCES));
  const firstWeek = startOfWeek(input.startDate);
  const dates: string[] = [];
  let truncated = false;
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addDays(input.startDate, offset);
    if (!weekdays.has(weekdayOf(date))) continue;
    if (input.frequency === 'biweekly') {
      const weekIndex = Math.floor(daysBetween(firstWeek, date) / 7);
      if (weekIndex % 2 !== 0) continue;
    }
    if (dates.length === cap) { truncated = true; break; }
    dates.push(date);
  }
  if (dates.length === 0) return { ok: false, error: 'noOccurrences' };
  return { ok: true, value: { dates, truncated } };
}

/** Cancellation reasons (lessons and breaks) keep at most this many characters. */
export const MAX_REASON_LENGTH = MAX_NAME_LENGTH * 2;

export type DateRangeError = 'fromInvalid' | 'toInvalid' | 'rangeReversed' | 'rangeTooLong';

/**
 * Validates an inclusive date range typed by the student. With `required`, both ends
 * must be given; otherwise an empty side means "open" (null). `maxDays` limits the
 * span between two given ends.
 */
export function validateDateRange(
  fromInput: string, toInput: string, options: { required: boolean; maxDays?: number },
): Result<{ from: string | null; to: string | null }, DateRangeError> {
  const fromText = fromInput.trim();
  const toText = toInput.trim();
  if ((fromText || options.required) && !isValidLocalDate(fromText)) return { ok: false, error: 'fromInvalid' };
  if ((toText || options.required) && !isValidLocalDate(toText)) return { ok: false, error: 'toInvalid' };
  const from = fromText || null;
  const to = toText || null;
  if (from && to) {
    if (to < from) return { ok: false, error: 'rangeReversed' };
    if (options.maxDays !== undefined && daysBetween(from, to) > options.maxDays) return { ok: false, error: 'rangeTooLong' };
  }
  return { ok: true, value: { from, to } };
}

/** Weekday indexes (0 = Sunday … 6 = Saturday) stored in a series mask. */
export function maskToWeekdays(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((day) => (mask & (1 << day)) !== 0);
}

/** A local civil moment: the date and minutes since midnight on the device clock. */
export type Moment = { localDate: string; minute: number };

export function toMoment(date: Date): Moment {
  return { localDate: toLocalDate(date), minute: date.getHours() * 60 + date.getMinutes() };
}

/** True when a lesson starting at this date/minute has not started yet at `now`. */
export function isAfter(localDate: string, startMinute: number, now: Moment): boolean {
  return localDate > now.localDate || (localDate === now.localDate && startMinute > now.minute);
}

export type SeriesEndError = 'endDateFormat' | 'endBeforeStart' | 'spanTooLong' | 'tooMany';

export type SeriesRule = {
  startDate: string;
  endDate: string;
  weekdays: readonly number[];
  frequency: Frequency;
  startMinute: number;
};

/**
 * Plans a change of the series end date. Extending returns the missing occurrence
 * dates after the current end that are still in the future and do not already exist
 * (by original date), so applying the same change twice adds nothing. Shortening adds
 * nothing; which occurrences may be removed is decided by the repository (only
 * future, untouched ones). The whole rule stays within the creation limits.
 */
export function planSeriesEnd(rule: SeriesRule, newEnd: string, now: Moment, existingOriginalDates: ReadonlySet<string>): Result<{ add: string[] }, SeriesEndError> {
  const end = newEnd.trim();
  if (!isValidLocalDate(end)) return { ok: false, error: 'endDateFormat' };
  if (end < rule.startDate) return { ok: false, error: 'endBeforeStart' };
  if (daysBetween(rule.startDate, end) > MAX_RECURRENCE_SPAN_DAYS) return { ok: false, error: 'spanTooLong' };
  if (end <= rule.endDate) return { ok: true, value: { add: [] } };
  const generated = generateOccurrences({ startDate: rule.startDate, endDate: end, weekdays: rule.weekdays, frequency: rule.frequency });
  if (!generated.ok) return { ok: true, value: { add: [] } };
  if (generated.value.truncated) return { ok: false, error: 'tooMany' };
  const add = generated.value.dates.filter((date) => date > rule.endDate && isAfter(date, rule.startMinute, now) && !existingOriginalDates.has(date));
  return { ok: true, value: { add } };
}

export type TimeSlot = { id?: number; localDate: string; startMinute: number; durationMinutes: number; status?: 'planned' | 'cancelled' };

/** Same-day overlap check. Cancelled lessons and the lesson being edited never conflict. */
export function findConflicts<T extends TimeSlot>(candidate: TimeSlot, existing: readonly T[]): T[] {
  const start = candidate.startMinute;
  const end = start + candidate.durationMinutes;
  return existing.filter((slot) => {
    if (slot.localDate !== candidate.localDate) return false;
    if (slot.status === 'cancelled') return false;
    if (candidate.id !== undefined && slot.id === candidate.id) return false;
    const slotEnd = slot.startMinute + slot.durationMinutes;
    return slot.startMinute < end && start < slotEnd;
  });
}

/** Conflicts for many candidate dates sharing one time slot (recurrence creation). */
export function findSeriesConflicts<T extends TimeSlot>(dates: readonly string[], startMinute: number, durationMinutes: number, existing: readonly T[]): T[] {
  const wanted = new Set(dates);
  const byDate = existing.filter((slot) => wanted.has(slot.localDate));
  return dates.flatMap((localDate) => findConflicts({ localDate, startMinute, durationMinutes }, byDate));
}

/** Escapes LIKE wildcards; use with `LIKE ? ESCAPE '\'`. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Bounded search term folded like the stored `search_*` columns (no accents, lower
 * case), escaped for `LIKE ? ESCAPE '\'`; null when there is nothing to search.
 */
export function toSearchPattern(text: string): string | null {
  const folded = normalizeForSearch(text.slice(0, MAX_SEARCH_LENGTH * 2)).slice(0, MAX_SEARCH_LENGTH);
  return folded ? `%${escapeLike(folded)}%` : null;
}

export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** First day (YYYY-MM-01) of the month `offset` months after the month of `localDate`. */
export function addMonths(localDate: string, offset: number): string {
  const parts = parseLocalDate(localDate);
  if (!parts) throw new RangeError(`Invalid local date: ${localDate}`);
  const index = parts.year * 12 + (parts.month - 1) + Math.trunc(offset);
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/**
 * Monday-first grid for the month containing `localDate`: whole weeks from the Monday
 * on or before the 1st to the Sunday on or after the last day (4–6 rows of 7 dates).
 * `to` is exclusive, ready for a half-open range query.
 */
export function monthGrid(localDate: string): { month: string; from: string; to: string; days: string[] } {
  const month = addMonths(localDate, 0);
  const next = addMonths(localDate, 1);
  const from = startOfWeek(month);
  const to = addDays(startOfWeek(addDays(next, -1)), 7);
  const days: string[] = [];
  for (let day = from; day < to; day = addDays(day, 1)) days.push(day);
  return { month, from, to, days };
}
