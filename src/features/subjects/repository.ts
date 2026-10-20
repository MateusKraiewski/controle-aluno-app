import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeForSearch } from '../../lib/text';

export type Subject = { id: number; name: string; archived: boolean; lessonCount: number };

const MAX_SUBJECTS = 200;

/** Subjects ordered by name, with lesson counts; bounded to 200 rows. */
export async function listSubjects(db: SQLiteDatabase, options: { includeArchived: boolean }): Promise<Subject[]> {
  const rows = await db.getAllAsync<{ id: number; name: string; archived_at: number | null; lesson_count: number }>(`
    SELECT s.id, s.name, s.archived_at,
      (SELECT COUNT(*) FROM lessons l WHERE l.subject_id = s.id) AS lesson_count
    FROM subjects s
    WHERE (? = 1 OR s.archived_at IS NULL)
    ORDER BY s.archived_at IS NOT NULL, s.name COLLATE NOCASE, s.id
    LIMIT ?`, options.includeArchived ? 1 : 0, MAX_SUBJECTS);
  return rows.map((row) => ({ id: row.id, name: row.name, archived: row.archived_at !== null, lessonCount: row.lesson_count }));
}

/** Renames a subject; names are unique ignoring case. */
export async function renameSubject(db: SQLiteDatabase, id: number, name: string): Promise<'ok' | 'duplicate'> {
  let outcome: 'ok' | 'duplicate' = 'ok';
  await db.withTransactionAsync(async () => {
    const clash = await db.getFirstAsync<{ id: number }>('SELECT id FROM subjects WHERE name = ? AND id <> ?', name, id);
    if (clash) { outcome = 'duplicate'; return; }
    await db.runAsync('UPDATE subjects SET name = ?, search_name = ? WHERE id = ?', name, normalizeForSearch(name), id);
  });
  return outcome;
}

/** Archiving hides a subject from quick picks; its lessons and history stay intact. */
export async function setSubjectArchived(db: SQLiteDatabase, id: number, archived: boolean): Promise<void> {
  await db.runAsync('UPDATE subjects SET archived_at = ? WHERE id = ?', archived ? Date.now() : null, id);
}
