// Plans the "fill in your lesson notes" reminders. Pure logic, no React/Expo: the
// scheduler turns each planned reminder into a local notification. Holidays and
// breaks already cancel the lessons they cover (status 'cancelled'), so cancelled
// lessons never produce reminders; neither do lessons the student marked as missed.
import type { Translations } from '../../lib/locales';
import { addDays, daysBetween, formatTemplate, weekdayOf } from '../lessons/domain';
import type { Moment } from '../lessons/domain';
import type { Attendance, LessonStatus } from '../lessons/types';

export type ReminderLesson = {
  id: number;
  subject: string;
  localDate: string;
  startMinute: number;
  durationMinutes: number;
  status: LessonStatus;
  attendance: Attendance;
  /** Studied content, next step or private notes already written. */
  hasNotes: boolean;
};

export type PlannedReminder = {
  at: Moment;
  /** 0 = friendly "the lesson just ended" … NAG_LEVELS - 1 = most dramatic. */
  level: number;
  /** Lesson the message talks about (the most overdue one in this reminder). */
  lessonId: number;
  subject: string;
  /** Every lesson this reminder nags about, most overdue first. */
  lessonIds: number[];
  /** Lessons without notes that ended by this time (this one included). */
  pendingCount: number;
};

/** Minutes after the lesson's end for each escalation level (Duolingo style). */
export const NAG_OFFSETS = [0, 45, 120, 240, 480, 1440, 2880] as const;
export const NAG_LEVELS = NAG_OFFSETS.length;
/** No reminders from 21:30 until 07:30 on school days (09:30 at weekends). */
const QUIET_FROM = 21 * 60 + 30;
const QUIET_UNTIL_WEEKDAY = 7 * 60 + 30;
const QUIET_UNTIL_WEEKEND = 9 * 60 + 30;
/** Reminders closer than this are merged into one notification. */
const MERGE_WINDOW = 10;
/** Lessons older than this (after their end) are no longer counted as pending. */
const PENDING_WINDOW = NAG_OFFSETS[NAG_LEVELS - 1] + 1440;
/** Android keeps at most 500 alarms per app; stay far below. */
export const MAX_SCHEDULED = 60;
/** Lessons read for planning: from this many days back up to LOOKAHEAD_DAYS ahead. */
export const LOOKBACK_DAYS = 3;
export const LOOKAHEAD_DAYS = 8;

const BASE_DATE = '2000-01-01';

function toAbsolute(localDate: string, minute: number): number {
  return daysBetween(BASE_DATE, localDate) * 1440 + minute;
}

function fromAbsolute(value: number): Moment {
  const day = Math.floor(value / 1440);
  return { localDate: addDays(BASE_DATE, day), minute: value - day * 1440 };
}

export function needsNotes(lesson: ReminderLesson): boolean {
  return lesson.status === 'planned' && lesson.attendance !== 'absent' && !lesson.hasNotes;
}

/** Moves a time out of lessons in progress (to their end) and out of the night (to the morning). */
function settle(time: number, busy: readonly [number, number][]): number {
  let t = time;
  for (let guard = 0; guard < 50; guard++) {
    const lesson = busy.find(([start, end]) => t > start && t < end);
    if (lesson) { t = lesson[1]; continue; }
    const { localDate, minute } = fromAbsolute(t);
    const morningOf = (date: string) => toAbsolute(date, [0, 6].includes(weekdayOf(date)) ? QUIET_UNTIL_WEEKEND : QUIET_UNTIL_WEEKDAY);
    if (minute >= QUIET_FROM) { t = morningOf(addDays(localDate, 1)); continue; }
    const morning = morningOf(localDate);
    if (t < morning) { t = morning; continue; }
    return t;
  }
  return t;
}

type NagEvent = { time: number; level: number; lesson: ReminderLesson; end: number };

/**
 * Every reminder still to come at `now`, in time order, at most `limit`.
 * Each lesson without notes gets one reminder per level after its end; reminders that
 * would fire during another lesson wait for that lesson's end, night ones move to the
 * morning, and reminders that land together are merged (the most overdue lesson and
 * the highest level win, so the tone keeps escalating).
 */
export function planReminders(lessons: readonly ReminderLesson[], now: Moment, limit = MAX_SCHEDULED): PlannedReminder[] {
  const nowAbs = toAbsolute(now.localDate, now.minute);
  const busy = lessons.filter((lesson) => lesson.status === 'planned').map((lesson): [number, number] => {
    const start = toAbsolute(lesson.localDate, lesson.startMinute);
    return [start, start + lesson.durationMinutes];
  });
  const pending = lessons.filter(needsNotes).map((lesson) => ({ lesson, end: toAbsolute(lesson.localDate, lesson.startMinute) + lesson.durationMinutes }));

  const events: NagEvent[] = [];
  for (const { lesson, end } of pending) {
    let previous = -Infinity;
    NAG_OFFSETS.forEach((offset, level) => {
      const time = settle(end + offset, busy);
      // Two levels squeezed into the same moment (e.g. both pushed to the morning): keep the first.
      if (time - previous < MERGE_WINDOW) return;
      previous = time;
      if (time > nowAbs) events.push({ time, level, lesson, end });
    });
  }
  events.sort((a, b) => a.time - b.time || a.end - b.end);

  const reminders: PlannedReminder[] = [];
  for (let i = 0; i < events.length && reminders.length < limit;) {
    const first = events[i].time;
    const group: NagEvent[] = [];
    while (i < events.length && events[i].time - first < MERGE_WINDOW) group.push(events[i++]);
    const time = group[group.length - 1].time;
    const byLesson = new Map<number, NagEvent>();
    for (const event of group) {
      const known = byLesson.get(event.lesson.id);
      if (!known || event.level > known.level) byLesson.set(event.lesson.id, event);
    }
    const ordered = [...byLesson.values()].sort((a, b) => a.end - b.end || a.lesson.id - b.lesson.id);
    const level = Math.max(...ordered.map((event) => event.level));
    const main = ordered.find((event) => event.level === level) ?? ordered[0];
    const pendingCount = pending.filter(({ end }) => end <= time && time - end <= PENDING_WINDOW).length;
    reminders.push({
      at: fromAbsolute(time), level, lessonId: main.lesson.id, subject: main.lesson.subject,
      lessonIds: ordered.map((event) => event.lesson.id), pendingCount: Math.max(pendingCount, ordered.length),
    });
  }
  return reminders;
}

const TITLE_KEYS = ['nag0Title', 'nag1Title', 'nag2Title', 'nag3Title', 'nag4Title', 'nag5Title', 'nag6Title'] as const;
const BODY_KEYS = ['nag0Body', 'nag1Body', 'nag2Body', 'nag3Body', 'nag4Body', 'nag5Body', 'nag6Body'] as const;

/** Notification title and body for a planned reminder, in the app's language. */
export function reminderText(t: Translations, reminder: Pick<PlannedReminder, 'level' | 'subject' | 'pendingCount'>): { title: string; body: string } {
  const level = Math.max(0, Math.min(reminder.level, NAG_LEVELS - 1));
  const values = { subject: reminder.subject };
  const extra = reminder.pendingCount - 1;
  const more = extra > 0 ? ` ${formatTemplate(extra === 1 ? t.nagMoreOne : t.nagMore, { count: extra })}` : '';
  return { title: formatTemplate(t[TITLE_KEYS[level]], values), body: formatTemplate(t[BODY_KEYS[level]], values) + more };
}
