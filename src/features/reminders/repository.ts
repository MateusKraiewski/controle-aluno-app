import type { SQLiteDatabase } from 'expo-sqlite';
import type { Attendance, LessonStatus } from '../lessons/types';
import type { ReminderLesson } from './domain';

const MAX_ROWS = 400;

type Row = {
  id: number;
  subject: string;
  local_date: string;
  start_minute: number;
  duration_minutes: number;
  status: LessonStatus;
  attendance: Attendance;
  has_notes: number;
};

/** Lessons between two local dates (inclusive) with what reminder planning needs. Static SQL, bound values. */
export async function listReminderLessons(db: SQLiteDatabase, from: string, to: string): Promise<ReminderLesson[]> {
  const rows = await db.getAllAsync<Row>(`
    SELECT l.id, s.name AS subject, l.local_date, l.start_minute, l.duration_minutes, l.status, l.attendance,
      (trim(coalesce(l.studied_content, '')) <> '' OR trim(coalesce(l.private_notes, '')) <> ''
        OR trim(coalesce(l.next_step, '')) <> '') AS has_notes
    FROM lessons l JOIN subjects s ON s.id = l.subject_id
    WHERE l.local_date >= ? AND l.local_date <= ?
    ORDER BY l.local_date, l.start_minute, l.id LIMIT ?`, from, to, MAX_ROWS);
  return rows.map((row) => ({
    id: row.id, subject: row.subject, localDate: row.local_date, startMinute: row.start_minute,
    durationMinutes: row.duration_minutes, status: row.status, attendance: row.attendance, hasNotes: row.has_notes === 1,
  }));
}
