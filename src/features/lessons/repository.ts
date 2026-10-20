import type { SQLiteDatabase } from 'expo-sqlite';
import { addDays, toSearchPattern } from './domain';
import type { TimeSlot } from './domain';
import type { Attendance, HistoryQuery, Lesson, LessonStatus, LessonUpdate, NewLesson, NewSeries, Scope } from './types';

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
  created_at: number;
  updated_at: number | null;
};

const LESSON_COLUMNS = `l.id, l.subject_id, s.name AS subject, l.teacher_name, l.local_date, l.start_minute,
  l.duration_minutes, l.planned_content, l.studied_content, l.attendance, l.status, l.cancel_reason,
  l.series_id, l.created_at, l.updated_at`;

function toLesson(row: LessonRow): Lesson {
  return {
    id: row.id, subjectId: row.subject_id, subject: row.subject, teacher: row.teacher_name, localDate: row.local_date,
    startMinute: row.start_minute, durationMinutes: row.duration_minutes, plannedContent: row.planned_content,
    studiedContent: row.studied_content, attendance: row.attendance, status: row.status, cancelReason: row.cancel_reason,
    seriesId: row.series_id, createdAt: row.created_at, updatedAt: row.updated_at,
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
    'INSERT INTO subjects (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET archived_at = NULL RETURNING id', name, now);
  if (!row) throw new Error('Could not resolve subject');
  return row.id;
}

export async function createLesson(db: SQLiteDatabase, input: NewLesson): Promise<number> {
  let id = 0;
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    const subjectId = await resolveSubject(db, input.subject, now);
    const result = await db.runAsync(
      'INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      subjectId, input.teacher, input.localDate, input.startMinute, input.durationMinutes, input.plannedContent, now, now);
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
      'INSERT INTO lesson_series (subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      subjectId, input.frequency, mask, input.localDate, input.endDate, input.startMinute, input.durationMinutes, now);
    seriesId = series.lastInsertRowId;
    const statement = await db.prepareAsync(
      'INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, series_id, original_local_date, created_at, updated_at) VALUES ($subject, $teacher, $date, $start, $duration, $planned, $series, $date, $now, $now)');
    try {
      for (const date of input.dates) {
        await statement.executeAsync({
          $subject: subjectId, $teacher: input.teacher, $date: date, $start: input.startMinute,
          $duration: input.durationMinutes, $planned: input.plannedContent, $series: seriesId, $now: now,
        });
      }
    } finally {
      await statement.finalizeAsync();
    }
  });
  return { seriesId, count: input.dates.length };
}

/** Edits one occurrence only. Series occurrences keep their link and original date. */
export async function updateLesson(db: SQLiteDatabase, id: number, input: LessonUpdate): Promise<void> {
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    const subjectId = await resolveSubject(db, input.subject, now);
    await db.runAsync(
      `UPDATE lessons SET subject_id = ?, teacher_name = ?, local_date = ?, start_minute = ?, duration_minutes = ?,
        planned_content = ?, studied_content = ?, updated_at = ? WHERE id = ?`,
      subjectId, input.teacher, input.localDate, input.startMinute, input.durationMinutes,
      input.plannedContent, input.studiedContent, now, id);
  });
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
 * (`? IS NULL OR …`); search uses LIKE with escaped wildcards.
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
      AND (? IS NULL OR (s.name LIKE ? ESCAPE '\\' OR l.teacher_name LIKE ? ESCAPE '\\'
        OR l.planned_content LIKE ? ESCAPE '\\' OR l.studied_content LIKE ? ESCAPE '\\'))
      AND (? IS NULL OR (l.local_date, l.start_minute, l.id) < (?, ?, ?))
    ORDER BY l.local_date DESC, l.start_minute DESC, l.id DESC
    LIMIT ?`,
  query.onOrBefore,
  query.subjectId, query.subjectId,
  pattern, pattern, pattern, pattern, pattern,
  before ? 1 : null, before?.localDate ?? null, before?.startMinute ?? null, before?.id ?? null,
  limit);
  return rows.map(toLesson);
}
