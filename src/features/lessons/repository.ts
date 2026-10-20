import type { SQLiteDatabase } from 'expo-sqlite';
import { lessonSearchText, normalizeForSearch } from '../../lib/text';
import { MAX_OCCURRENCES, addDays, maskToWeekdays, planSeriesEnd, toMoment, toSearchPattern } from './domain';
import type { Moment, Result, SeriesEndError, TimeSlot } from './domain';
import type { Attendance, EditScope, HistoryQuery, Lesson, LessonStatus, LessonUpdate, NewLesson, NewSeries, Scope, SeriesInfo } from './types';

// All SQL is static text with bound parameters; user text never composes SQL.
const MAX_PAGE = 100;
const MAX_SLOTS = 2000;

type LessonRow = {
  id: number;
  subject_id: number;
  subject: string;
  teacher_name: string | null;
  local_date: string;
  start_minute: number;
  duration_minutes: number;
  planned_content: string | null;
  studied_content: string | null;
  attendance: Attendance;
  status: LessonStatus;
  cancel_reason: string | null;
  series_id: number | null;
  series_exception: number;
  created_at: number;
  updated_at: number | null;
};

const LESSON_COLUMNS = `l.id, l.subject_id, s.name AS subject, l.teacher_name, l.local_date, l.start_minute,
  l.duration_minutes, l.planned_content, l.studied_content, l.attendance, l.status, l.cancel_reason,
  l.series_id, l.series_exception, l.created_at, l.updated_at`;

/**
 * Occurrences a series-wide change may touch: still planned, nothing recorded
 * (attendance, studied content, notes, next step), never edited on their own, and not
 * started yet at ($today, $minute). Static SQL fragment; values are bound by name.
 */
const UNTOUCHED_FUTURE = `status = 'planned' AND attendance = 'unmarked' AND studied_content IS NULL
  AND private_notes IS NULL AND next_step IS NULL AND series_exception = 0
  AND (local_date > $today OR (local_date = $today AND start_minute > $minute))`;

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id, subjectId: row.subject_id, subject: row.subject, teacher: row.teacher_name, localDate: row.local_date,
    startMinute: row.start_minute, durationMinutes: row.duration_minutes, plannedContent: row.planned_content,
    studiedContent: row.studied_content, attendance: row.attendance, status: row.status, cancelReason: row.cancel_reason,
    seriesId: row.series_id, seriesException: row.series_exception === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function clampLimit(limit: number, max: number) {
  return Math.max(1, Math.min(Math.trunc(limit) || 1, max));
}

/** Lessons in the half-open date range [from, to), at most 100. */
export async function listLessonsInRange(db: SQLiteDatabase, from: string, to: string, limit = MAX_PAGE): Promise<Lesson[]> {
  const rows = await db.getAllAsync<LessonRow>(`
    SELECT ${LESSON_COLUMNS}
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    WHERE l.local_date >= ? AND l.local_date < ?
    ORDER BY l.local_date, l.start_minute, l.id LIMIT ?`, from, to, clampLimit(limit, MAX_PAGE));
  return rows.map(toLesson);
}

export async function getLesson(db: SQLiteDatabase, id: number): Promise<Lesson | null> {
  const row = await db.getFirstAsync<LessonRow>(`
    SELECT ${LESSON_COLUMNS}
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    WHERE l.id = ?`, id);
  return row ? toLesson(row) : null;
}

/** Light rows (no text) for overlap warnings in the inclusive date range. */
export async function listTimeSlots(db: SQLiteDatabase, from: string, toInclusive: string): Promise<Required<TimeSlot>[]> {
  const rows = await db.getAllAsync<{ id: number; local_date: string; start_minute: number; duration_minutes: number; status: LessonStatus }>(`
    SELECT id, local_date, start_minute, duration_minutes, status
    FROM lessons
    WHERE local_date >= ? AND local_date <= ?
    ORDER BY local_date, start_minute, id LIMIT ?`, from, toInclusive, MAX_SLOTS);
  return rows.map((row) => ({ id: row.id, localDate: row.local_date, startMinute: row.start_minute, durationMinutes: row.duration_minutes, status: row.status }));
}

/** Returns the subject id, creating it or un-archiving it when it is used again. */
async function resolveSubject(db: SQLiteDatabase, name: string, now: number): Promise<number> {
  const row = await db.getFirstAsync<{ id: number }>(
    'INSERT INTO subjects (name, search_name, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET archived_at = NULL RETURNING id',
    name, normalizeForSearch(name), now);
  if (!row) throw new Error('Could not resolve subject');
  return row.id;
}

export async function createLesson(db: SQLiteDatabase, input: NewLesson): Promise<number> {
  let id = 0;
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    const subjectId = await resolveSubject(db, input.subject, now);
    const result = await db.runAsync(
      'INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      subjectId, input.teacher, input.localDate, input.startMinute, input.durationMinutes, input.plannedContent,
      lessonSearchText({ ...input, studiedContent: null }), now, now);
    id = result.lastInsertRowId;
  });
  return id;
}

export function weekdaysToMask(weekdays: readonly number[]): number {
  return weekdays.reduce((mask, day) => (Number.isInteger(day) && day >= 0 && day <= 6 ? mask | (1 << day) : mask), 0);
}

/** Creates the series row and every occurrence in a single transaction. */
export async function createLessonSeries(db: SQLiteDatabase, input: NewSeries): Promise<{ seriesId: number; count: number }> {
  if (input.dates.length === 0 || input.dates.length > 300) throw new RangeError('Series must have 1 to 300 occurrences');
  const mask = weekdaysToMask(input.weekdays);
  if (mask === 0) throw new RangeError('Series needs at least one weekday');
  let seriesId = 0;
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    const subjectId = await resolveSubject(db, input.subject, now);
    const series = await db.runAsync(
      `INSERT INTO lesson_series (subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, teacher_name, planned_content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      subjectId, input.frequency, mask, input.localDate, input.endDate, input.startMinute, input.durationMinutes, input.teacher, input.plannedContent, now);
    seriesId = series.lastInsertRowId;
    const statement = await db.prepareAsync(
      'INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, search_text, series_id, original_local_date, created_at, updated_at) VALUES ($subject, $teacher, $date, $start, $duration, $planned, $search, $series, $date, $now, $now)');
    const searchText = lessonSearchText({ ...input, studiedContent: null });
    try {
      for (const date of input.dates) {
        await statement.executeAsync({
          $subject: subjectId, $teacher: input.teacher, $date: date, $start: input.startMinute,
          $duration: input.durationMinutes, $planned: input.plannedContent, $search: searchText, $series: seriesId, $now: now,
        });
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
  return { seriesId, count: input.dates.length };
}

/**
 * Edits a lesson. Series occurrences keep their link and original date. With scope
 * 'all' on a series occurrence, the new time, duration, teacher and planned content
 * also become the series template and are applied to every other future, untouched
 * occurrence (see UNTOUCHED_FUTURE); past, recorded, cancelled and individually edited
 * occurrences are never changed. The edited occurrence is flagged as individually
 * edited when its governed fields differ from the template. One short transaction.
 * Returns how many other occurrences changed.
 */
export async function updateLesson(db: SQLiteDatabase, id: number, input: LessonUpdate, options: { scope?: EditScope; now?: Moment } = {}): Promise<{ seriesUpdated: number }> {
  let seriesUpdated = 0;
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    const subjectId = await resolveSubject(db, input.subject, now);
    const anchor = await db.getFirstAsync<{ series_id: number | null }>('SELECT series_id FROM lessons WHERE id = ?', id);
    if (!anchor) return;
    if (options.scope === 'all' && anchor.series_id !== null) {
      const moment = options.now ?? toMoment(new Date());
      await db.runAsync(
        'UPDATE lesson_series SET start_minute = ?, duration_minutes = ?, teacher_name = ?, planned_content = ? WHERE id = ?',
        input.startMinute, input.durationMinutes, input.teacher, input.plannedContent, anchor.series_id);
      const result = await db.runAsync(`
        UPDATE lessons SET start_minute = $start, duration_minutes = $duration, teacher_name = $teacher, planned_content = $planned,
          search_text = $search, updated_at = $now
        WHERE series_id = $series AND id <> $id AND ${UNTOUCHED_FUTURE}`, {
        $start: input.startMinute, $duration: input.durationMinutes, $teacher: input.teacher, $planned: input.plannedContent,
        $search: lessonSearchText({ teacher: input.teacher, plannedContent: input.plannedContent, studiedContent: null }),
        $now: now, $series: anchor.series_id, $id: id, $today: moment.localDate, $minute: moment.minute,
      });
      seriesUpdated = result.changes;
    }
    await db.runAsync(`
      UPDATE lessons SET subject_id = $subject, teacher_name = $teacher, local_date = $date, start_minute = $start,
        duration_minutes = $duration, planned_content = $planned, studied_content = $studied, search_text = $search, updated_at = $now,
        series_exception = CASE WHEN series_id IS NULL THEN 0 ELSE MAX(series_exception, EXISTS (
          SELECT 1 FROM lesson_series s WHERE s.id = lessons.series_id AND (
            s.subject_id <> $subject OR lessons.original_local_date IS NOT $date OR s.start_minute <> $start
            OR s.duration_minutes <> $duration OR s.teacher_name IS NOT $teacher OR s.planned_content IS NOT $planned))) END
      WHERE id = $id`, {
      $subject: subjectId, $teacher: input.teacher, $date: input.localDate, $start: input.startMinute, $duration: input.durationMinutes,
      $planned: input.plannedContent, $studied: input.studiedContent, $search: lessonSearchText(input), $now: now, $id: id,
    });
  });
  return { seriesUpdated };
}

/** Other occurrences an 'all' edit of this series would change now (for preview and overlap checks). */
export async function listSeriesEditTargets(db: SQLiteDatabase, seriesId: number, excludeId: number, now: Moment = toMoment(new Date())): Promise<{ id: number; localDate: string }[]> {
  const rows = await db.getAllAsync<{ id: number; local_date: string }>(`
    SELECT id, local_date FROM lessons
    WHERE series_id = $series AND id <> $id AND ${UNTOUCHED_FUTURE}
    ORDER BY local_date, start_minute, id LIMIT $limit`,
  { $series: seriesId, $id: excludeId, $today: now.localDate, $minute: now.minute, $limit: MAX_OCCURRENCES });
  return rows.map((row) => ({ id: row.id, localDate: row.local_date }));
}

type SeriesRow = {
  id: number; subject_id: number; frequency: 'weekly' | 'biweekly'; weekdays_mask: number; start_date: string; end_date: string;
  start_minute: number; duration_minutes: number; teacher_name: string | null; planned_content: string | null;
};

export async function getSeries(db: SQLiteDatabase, id: number): Promise<SeriesInfo | null> {
  const row = await db.getFirstAsync<SeriesRow>(`
    SELECT id, subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, teacher_name, planned_content
    FROM lesson_series WHERE id = ?`, id);
  if (!row) return null;
  return {
    id: row.id, subjectId: row.subject_id, frequency: row.frequency, weekdays: maskToWeekdays(row.weekdays_mask),
    startDate: row.start_date, endDate: row.end_date, startMinute: row.start_minute, durationMinutes: row.duration_minutes,
    teacher: row.teacher_name, plannedContent: row.planned_content,
  };
}

export type SeriesEndOutcome = { added: number; removed: number; seriesDeleted: boolean };

/**
 * Changes the series end date. Extending creates the missing future occurrences after
 * the old end from the series template (idempotent: existing original dates are
 * skipped). Shortening deletes only future, untouched occurrences after the new end;
 * anything recorded, cancelled or edited stays. With `dryRun` nothing is written and
 * the counts are a preview. Writes run in one short transaction.
 */
export async function changeSeriesEnd(
  db: SQLiteDatabase, seriesId: number, newEnd: string, options: { now?: Moment; dryRun?: boolean } = {},
): Promise<Result<SeriesEndOutcome, SeriesEndError | 'notFound'>> {
  const moment = options.now ?? toMoment(new Date());
  const end = newEnd.trim();
  let outcome: Result<SeriesEndOutcome, SeriesEndError | 'notFound'> = { ok: false, error: 'notFound' };
  const run = async () => {
    const series = await getSeries(db, seriesId);
    if (!series) { outcome = { ok: false, error: 'notFound' }; return; }
    const existing = await db.getAllAsync<{ original_local_date: string }>(
      'SELECT original_local_date FROM lessons WHERE series_id = ? AND original_local_date > ? LIMIT ?', seriesId, series.endDate, MAX_OCCURRENCES * 2);
    const plan = planSeriesEnd(series, end, moment, new Set(existing.map((row) => row.original_local_date)));
    if (!plan.ok) { outcome = plan; return; }
    const removable = { $series: seriesId, $end: end, $today: moment.localDate, $minute: moment.minute };
    const removeWhere = `series_id = $series AND local_date > $end AND ${UNTOUCHED_FUTURE}`;
    if (options.dryRun) {
      const count = end < series.endDate
        ? (await db.getFirstAsync<{ total: number }>(`SELECT COUNT(*) AS total FROM lessons WHERE ${removeWhere}`, removable))?.total ?? 0
        : 0;
      outcome = { ok: true, value: { added: plan.value.add.length, removed: count, seriesDeleted: false } };
      return;
    }
    let removed = 0;
    if (end < series.endDate) removed = (await db.runAsync(`DELETE FROM lessons WHERE ${removeWhere}`, removable)).changes;
    if (plan.value.add.length > 0) {
      const now = Date.now();
      const statement = await db.prepareAsync(`
        INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, search_text, series_id, original_local_date, created_at, updated_at)
        VALUES ($subject, $teacher, $date, $start, $duration, $planned, $search, $series, $date, $now, $now)`);
      const searchText = lessonSearchText({ teacher: series.teacher, plannedContent: series.plannedContent, studiedContent: null });
      try {
        for (const date of plan.value.add) {
          await statement.executeAsync({
            $subject: series.subjectId, $teacher: series.teacher, $date: date, $start: series.startMinute,
            $duration: series.durationMinutes, $planned: series.plannedContent, $search: searchText, $series: seriesId, $now: now,
          });
        }
      } finally {
        await statement.finalizeAsync();
      }
    }
    const remaining = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM lessons WHERE series_id = ?', seriesId);
    const seriesDeleted = !remaining || remaining.total === 0;
    if (seriesDeleted) await db.runAsync('DELETE FROM lesson_series WHERE id = ?', seriesId);
    else await db.runAsync('UPDATE lesson_series SET end_date = ? WHERE id = ?', end, seriesId);
    outcome = { ok: true, value: { added: plan.value.add.length, removed, seriesDeleted } };
  };
  if (options.dryRun) await run();
  else await db.withTransactionAsync(run);
  return outcome;
}

/** The student's own attendance record. Cancelled lessons cannot receive attendance. */
export async function updateAttendance(db: SQLiteDatabase, id: number, attendance: Attendance): Promise<boolean> {
  const result = await db.runAsync(
    "UPDATE lessons SET attendance = ?, updated_at = ? WHERE id = ? AND status = 'planned'", attendance, Date.now(), id);
  return result.changes > 0;
}

type Anchor = { series_id: number | null; local_date: string };

async function getAnchor(db: SQLiteDatabase, id: number): Promise<Anchor | null> {
  return db.getFirstAsync<Anchor>('SELECT series_id, local_date FROM lessons WHERE id = ?', id);
}

/**
 * Cancels the lesson (or it and later occurrences of its series). A cancelled lesson
 * is not an absence: the student's attendance record is cleared, never set to absent.
 */
export async function cancelLessons(db: SQLiteDatabase, id: number, scope: Scope, reason: string | null): Promise<number> {
  let changes = 0;
  await db.withTransactionAsync(async () => {
    const anchor = await getAnchor(db, id);
    if (!anchor) return;
    const now = Date.now();
    const result = scope === 'following' && anchor.series_id !== null
      ? await db.runAsync(
        `UPDATE lessons SET status = 'cancelled', cancel_reason = ?, attendance = 'unmarked', updated_at = ?
         WHERE id = ? OR (series_id = ? AND local_date >= ? AND status = 'planned')`,
        reason, now, id, anchor.series_id, anchor.local_date)
      : await db.runAsync(
        "UPDATE lessons SET status = 'cancelled', cancel_reason = ?, attendance = 'unmarked', updated_at = ? WHERE id = ?",
        reason, now, id);
    changes = result.changes;
  });
  return changes;
}

export async function restoreLesson(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync("UPDATE lessons SET status = 'planned', cancel_reason = NULL, updated_at = ? WHERE id = ?", Date.now(), id);
}

/** User-confirmed deletion. Never called automatically. */
export async function deleteLessons(db: SQLiteDatabase, id: number, scope: Scope): Promise<number> {
  let changes = 0;
  await db.withTransactionAsync(async () => {
    const anchor = await getAnchor(db, id);
    if (!anchor) return;
    if (scope === 'following' && anchor.series_id !== null) {
      const result = await db.runAsync('DELETE FROM lessons WHERE id = ? OR (series_id = ? AND local_date >= ?)', id, anchor.series_id, anchor.local_date);
      changes = result.changes;
      const remaining = await db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM lessons WHERE series_id = ?', anchor.series_id);
      if (!remaining || remaining.total === 0) {
        await db.runAsync('DELETE FROM lesson_series WHERE id = ?', anchor.series_id);
      } else {
        // The rule now ends the day before the deleted occurrence (never before it starts).
        await db.runAsync(
          'UPDATE lesson_series SET end_date = MAX(start_date, ?) WHERE id = ? AND end_date >= ?',
          addDays(anchor.local_date, -1), anchor.series_id, anchor.local_date);
      }
    } else {
      const result = await db.runAsync('DELETE FROM lessons WHERE id = ?', id);
      changes = result.changes;
    }
  });
  return changes;
}

/**
 * Keyset-paginated history, newest first. Optional filters are bound parameters
 * (`? IS NULL OR …`); search uses LIKE with escaped wildcards over the app-maintained
 * accent/case-folded columns `subjects.search_name` and `lessons.search_text`.
 */
export async function listHistoryPage(db: SQLiteDatabase, query: HistoryQuery): Promise<Lesson[]> {
  const limit = clampLimit(query.limit ?? 50, MAX_PAGE);
  const pattern = toSearchPattern(query.search);
  const before = query.before;
  const rows = await db.getAllAsync<LessonRow>(`
    SELECT ${LESSON_COLUMNS}
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    WHERE l.local_date <= ?
      AND (? IS NULL OR l.subject_id = ?)
      AND (? IS NULL OR s.search_name LIKE ? ESCAPE '\\' OR l.search_text LIKE ? ESCAPE '\\')
      AND (? IS NULL OR (l.local_date, l.start_minute, l.id) < (?, ?, ?))
    ORDER BY l.local_date DESC, l.start_minute DESC, l.id DESC
    LIMIT ?`,
  query.onOrBefore,
  query.subjectId, query.subjectId,
  pattern, pattern, pattern,
  before ? 1 : null, before?.localDate ?? null, before?.startMinute ?? null, before?.id ?? null,
  limit);
  return rows.map(toLesson);
}
