import type { SQLiteDatabase } from 'expo-sqlite';
import { isValidLocalDate } from '../lessons/domain';
import type { HistoryCsvRow } from './csv';

/** Same cap as the backup: the export is held in memory while it is shared. */
export const MAX_CSV_LESSONS = 30_000;
const PAGE = 500;

export class HistoryExportTooLargeError extends Error {
  constructor() {
    super('History exceeds the CSV export limit');
    this.name = 'HistoryExportTooLargeError';
  }
}

type Row = {
  id: number; local_date: string; start_minute: number; duration_minutes: number; subject: string; status: HistoryCsvRow['status'];
  attendance: HistoryCsvRow['attendance']; planned_content: string | null; studied_content: string | null; next_step: string | null;
  private_notes?: string | null;
};

// Two static statements: private notes are only read when the student asked for them.
const COLUMNS = `l.id, l.local_date, l.start_minute, l.duration_minutes, s.name AS subject, l.status, l.attendance,
  l.planned_content, l.studied_content, l.next_step`;
const PAGE_WHERE = `FROM lessons l JOIN subjects s ON s.id = l.subject_id
  WHERE l.local_date <= $today AND (l.local_date, l.start_minute, l.id) > ($date, $minute, $id)
  ORDER BY l.local_date, l.start_minute, l.id LIMIT $limit`;
const WITHOUT_NOTES = `SELECT ${COLUMNS} ${PAGE_WHERE}`;
const WITH_NOTES = `SELECT ${COLUMNS}, l.private_notes ${PAGE_WHERE}`;

/**
 * Lessons up to `today` (the history, as on the History tab), oldest first, read in
 * keyset pages of 500 inside one read transaction. Refuses, without truncating, more
 * than 30 000 lessons.
 */
export async function readHistoryForCsv(db: SQLiteDatabase, today: string, options: { includePrivateNotes: boolean }): Promise<HistoryCsvRow[]> {
  if (!isValidLocalDate(today)) throw new RangeError('Invalid local date');
  const rows: HistoryCsvRow[] = [];
  await db.withTransactionAsync(async () => {
    const total = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM lessons WHERE local_date <= ?', today);
    if ((total?.n ?? 0) > MAX_CSV_LESSONS) throw new HistoryExportTooLargeError();
    const sql = options.includePrivateNotes ? WITH_NOTES : WITHOUT_NOTES;
    for (let cursor = { date: '', minute: -1, id: 0 }; ;) {
      const page = await db.getAllAsync<Row>(sql, { $today: today, $date: cursor.date, $minute: cursor.minute, $id: cursor.id, $limit: PAGE });
      for (const row of page) {
        rows.push({
          localDate: row.local_date, startMinute: row.start_minute, durationMinutes: row.duration_minutes, subject: row.subject,
          status: row.status, attendance: row.attendance, plannedContent: row.planned_content, studiedContent: row.studied_content,
          nextStep: row.next_step, ...(options.includePrivateNotes ? { privateNotes: row.private_notes ?? null } : {}),
        });
      }
      if (page.length < PAGE) return;
      const last = page[page.length - 1];
      cursor = { date: last.local_date, minute: last.start_minute, id: last.id };
    }
  });
  return rows;
}
