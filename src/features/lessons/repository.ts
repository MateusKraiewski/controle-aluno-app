import type { SQLiteDatabase } from 'expo-sqlite';
import type { Attendance, Lesson, NewLesson } from './types';

type LessonRow = {
  id: number;
  subject: string;
  teacher_name: string | null;
  local_date: string;
  start_minute: number;
  duration_minutes: number;
  planned_content: string | null;
  studied_content: string | null;
  attendance: Attendance;
  created_at: number;
};

function toLesson(row: LessonRow): Lesson {
  return { id: row.id, subject: row.subject, teacher: row.teacher_name, localDate: row.local_date, startMinute: row.start_minute, durationMinutes: row.duration_minutes, plannedContent: row.planned_content, studiedContent: row.studied_content, attendance: row.attendance, createdAt: row.created_at };
}

export async function listUpcomingLessons(db: SQLiteDatabase, from: string, to: string, limit = 100): Promise<Lesson[]> {
  const rows = await db.getAllAsync<LessonRow>(`
    SELECT l.id, s.name AS subject, l.teacher_name, l.local_date, l.start_minute,
      l.duration_minutes, l.planned_content, l.studied_content, l.attendance, l.created_at
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    WHERE l.local_date >= ? AND l.local_date < ?
    ORDER BY l.local_date, l.start_minute, l.id LIMIT ?`, from, to, Math.max(1, Math.min(limit, 100)));
  return rows.map(toLesson);
}

export type HistoryCursor = { localDate: string; startMinute: number; id: number };

export async function listHistoryPage(db: SQLiteDatabase, before: HistoryCursor | null, limit = 50): Promise<Lesson[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = before
    ? await db.getAllAsync<LessonRow>(`SELECT l.id, s.name AS subject, l.teacher_name, l.local_date, l.start_minute, l.duration_minutes, l.planned_content, l.studied_content, l.attendance, l.created_at FROM lessons l JOIN subjects s ON s.id = l.subject_id WHERE l.local_date < ? OR (l.local_date = ? AND l.start_minute < ?) OR (l.local_date = ? AND l.start_minute = ? AND l.id < ?) ORDER BY l.local_date DESC, l.start_minute DESC, l.id DESC LIMIT ?`, before.localDate, before.localDate, before.startMinute, before.localDate, before.startMinute, before.id, safeLimit)
    : await db.getAllAsync<LessonRow>(`SELECT l.id, s.name AS subject, l.teacher_name, l.local_date, l.start_minute, l.duration_minutes, l.planned_content, l.studied_content, l.attendance, l.created_at FROM lessons l JOIN subjects s ON s.id = l.subject_id ORDER BY l.local_date DESC, l.start_minute DESC, l.id DESC LIMIT ?`, safeLimit);
  return rows.map(toLesson);
}

export async function createLesson(db: SQLiteDatabase, input: NewLesson) {
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    await db.runAsync('INSERT INTO subjects (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO NOTHING', input.subject, now);
    const subject = await db.getFirstAsync<{ id: number }>('SELECT id FROM subjects WHERE name = ?', input.subject);
    if (!subject) throw new Error('Could not resolve subject');
    await db.runAsync('INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', subject.id, input.teacher || null, input.localDate, input.startMinute, input.durationMinutes, input.plannedContent || null, now);
  });
}

export async function updateAttendance(db: SQLiteDatabase, id: number, attendance: Attendance) {
  await db.runAsync('UPDATE lessons SET attendance = ? WHERE id = ?', attendance, id);
}
