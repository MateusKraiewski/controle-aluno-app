import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_VERSION, deriveSeriesState, readSchemaVersion } from '../../db/migrations';
import { lessonSearchText, normalizeForSearch } from '../../lib/text';
import { BACKUP_FORMAT, MAX_BACKUP_LESSONS, MAX_BACKUP_SERIES, MAX_BACKUP_SUBJECTS } from './format';
import type { BackupDocument, BackupLesson, BackupSeries, BackupSubject, ValidatedBackup } from './format';

// Export reads in id-ordered pages so no single query materialises a whole table;
// the resulting document is still held in memory, which is why counts are capped.
const EXPORT_PAGE = 500;

export class BackupTooLargeError extends Error {
  constructor() {
    super('Local data exceeds the backup limits');
    this.name = 'BackupTooLargeError';
  }
}

export class SchemaMismatchError extends Error {
  constructor() {
    super('Local database schema does not match this app version');
    this.name = 'SchemaMismatchError';
  }
}

export type DataCounts = { subjects: number; series: number; lessons: number };

async function countAll(db: SQLiteDatabase): Promise<DataCounts> {
  const row = await db.getFirstAsync<{ subjects: number; series: number; lessons: number }>(`
    SELECT (SELECT COUNT(*) FROM subjects) AS subjects,
      (SELECT COUNT(*) FROM lesson_series) AS series,
      (SELECT COUNT(*) FROM lessons) AS lessons`);
  return { subjects: row?.subjects ?? 0, series: row?.series ?? 0, lessons: row?.lessons ?? 0 };
}

async function assertCurrentSchema(db: SQLiteDatabase): Promise<void> {
  if (await readSchemaVersion(db) !== SCHEMA_VERSION) throw new SchemaMismatchError();
}

async function readPaged<T extends { id: number }>(db: SQLiteDatabase, sql: string): Promise<T[]> {
  const rows: T[] = [];
  for (let after = 0; ;) {
    const page = await db.getAllAsync<T>(sql, after, EXPORT_PAGE);
    rows.push(...page);
    if (page.length < EXPORT_PAGE) return rows;
    after = page[page.length - 1].id;
  }
}

/**
 * Builds the versioned backup of every subject, series and lesson. Read-only. Fails
 * with BackupTooLargeError instead of silently truncating when a cap is exceeded.
 */
export async function exportBackup(db: SQLiteDatabase, now: Date = new Date()): Promise<BackupDocument> {
  await assertCurrentSchema(db);
  const counts = await countAll(db);
  if (counts.subjects > MAX_BACKUP_SUBJECTS || counts.series > MAX_BACKUP_SERIES || counts.lessons > MAX_BACKUP_LESSONS) {
    throw new BackupTooLargeError();
  }
  // One read transaction keeps the three tables consistent with each other.
  let document = null as BackupDocument | null;
  await db.withTransactionAsync(async () => {
    const subjects = await readPaged<BackupSubject>(db,
      'SELECT id, name, created_at, archived_at, color, sort_order FROM subjects WHERE id > ? ORDER BY id LIMIT ?');
    const series = await readPaged<BackupSeries>(db, `
      SELECT id, subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, created_at,
        teacher_name, planned_content
      FROM lesson_series WHERE id > ? ORDER BY id LIMIT ?`);
    const lessons = await readPaged<BackupLesson>(db, `
      SELECT id, subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, studied_content,
        attendance, status, cancel_reason, series_id, original_local_date, created_at, updated_at,
        private_notes, next_step, series_exception
      FROM lessons WHERE id > ? ORDER BY id LIMIT ?`);
    document = {
      format: BACKUP_FORMAT, schema_version: SCHEMA_VERSION, exported_at: now.toISOString(),
      subjects, lesson_series: series, lessons,
    };
  });
  if (!document) throw new Error('Export did not complete');
  return document;
}

/**
 * Replaces ALL local subjects, series and lessons with the validated backup in a
 * single transaction. Any failure (constraint, count mismatch, I/O) rolls back and
 * leaves the previous data untouched. Search columns are recomputed on this device;
 * an older (v3) backup gets the v4 series state derived after insertion.
 */
export async function restoreBackup(db: SQLiteDatabase, backup: ValidatedBackup): Promise<DataCounts> {
  if (backup.schema_version > SCHEMA_VERSION) throw new SchemaMismatchError();
  await assertCurrentSchema(db);
  let counts: DataCounts = { subjects: 0, series: 0, lessons: 0 };
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM lessons; DELETE FROM lesson_series; DELETE FROM subjects;');
    const subjectInsert = await db.prepareAsync(
      'INSERT INTO subjects (id, name, search_name, created_at, archived_at, color, sort_order) VALUES ($id, $name, $search, $created, $archived, $color, $order)');
    try {
      for (const row of backup.subjects) {
        await subjectInsert.executeAsync({ $id: row.id, $name: row.name, $search: normalizeForSearch(row.name), $created: row.created_at, $archived: row.archived_at, $color: row.color, $order: row.sort_order });
      }
    } finally {
      await subjectInsert.finalizeAsync();
    }
    const seriesInsert = await db.prepareAsync(`
      INSERT INTO lesson_series (id, subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, created_at,
        teacher_name, planned_content)
      VALUES ($id, $subject, $frequency, $mask, $start, $end, $minute, $duration, $created, $teacher, $planned)`);
    try {
      for (const row of backup.lesson_series) {
        await seriesInsert.executeAsync({
          $id: row.id, $subject: row.subject_id, $frequency: row.frequency, $mask: row.weekdays_mask, $start: row.start_date,
          $end: row.end_date, $minute: row.start_minute, $duration: row.duration_minutes, $created: row.created_at,
          $teacher: row.teacher_name, $planned: row.planned_content,
        });
      }
    } finally {
      await seriesInsert.finalizeAsync();
    }
    const lessonInsert = await db.prepareAsync(`
      INSERT INTO lessons (id, subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, studied_content,
        attendance, status, cancel_reason, series_id, original_local_date, created_at, updated_at, private_notes, next_step,
        series_exception, search_text)
      VALUES ($id, $subject, $teacher, $date, $minute, $duration, $planned, $studied, $attendance, $status, $reason, $series,
        $original, $created, $updated, $notes, $next, $exception, $search)`);
    try {
      for (const row of backup.lessons) {
        await lessonInsert.executeAsync({
          $id: row.id, $subject: row.subject_id, $teacher: row.teacher_name, $date: row.local_date, $minute: row.start_minute,
          $duration: row.duration_minutes, $planned: row.planned_content, $studied: row.studied_content, $attendance: row.attendance,
          $status: row.status, $reason: row.cancel_reason, $series: row.series_id, $original: row.original_local_date,
          $created: row.created_at, $updated: row.updated_at, $notes: row.private_notes, $next: row.next_step,
          $exception: row.series_exception,
          $search: lessonSearchText({
            teacher: row.teacher_name, plannedContent: row.planned_content, studiedContent: row.studied_content,
            privateNotes: row.private_notes, nextStep: row.next_step,
          }),
        });
      }
    } finally {
      await lessonInsert.finalizeAsync();
    }
    // A v3 backup has no series template or edit flags: derive them as the v4 migration does.
    if (backup.schema_version < 4) await deriveSeriesState(db);
    counts = await countAll(db);
    if (counts.subjects !== backup.subjects.length || counts.series !== backup.lesson_series.length || counts.lessons !== backup.lessons.length) {
      throw new Error('Restored row counts do not match the backup');
    }
  });
  return counts;
}

/**
 * Student-initiated erase of every subject, series and lesson in one transaction.
 * Afterwards, best effort, VACUUM and a WAL checkpoint drop the freed pages from the
 * files; a failure there does not undo the (already committed) deletion.
 * Language/theme preferences are kept.
 */
export async function deleteAllData(db: SQLiteDatabase): Promise<{ deleted: DataCounts; compacted: boolean }> {
  let deleted: DataCounts = { subjects: 0, series: 0, lessons: 0 };
  await db.withTransactionAsync(async () => {
    deleted = await countAll(db);
    await db.execAsync('DELETE FROM lessons; DELETE FROM lesson_series; DELETE FROM subjects;');
  });
  let compacted = true;
  try {
    await db.execAsync('VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    compacted = false;
  }
  return { deleted, compacted };
}

export async function countLocalData(db: SQLiteDatabase): Promise<DataCounts> {
  return countAll(db);
}
