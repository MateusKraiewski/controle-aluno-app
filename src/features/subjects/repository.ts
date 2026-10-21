import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeForSearch } from '../../lib/text';
import { MAX_SORT_ORDER, isSubjectColor } from './colors';
import type { SubjectColor } from './colors';

export type Subject = {
  id: number; name: string; archived: boolean; lessonCount: number; color: SubjectColor | null; sortOrder: number | null;
  /** Learning objectives not yet marked done. */
  activeObjectives: number;
};

const MAX_SUBJECTS = 200;
/** Upper bound when renumbering the manual order (matches the backup limit). */
const MAX_ORDERED = 2_000;

/**
 * Display order: active before archived, then the student's manual order (subjects
 * never moved keep NULL and follow, by name). Shared by every subject listing.
 */
const SUBJECT_ORDER = 's.archived_at IS NOT NULL, s.sort_order IS NULL, s.sort_order, s.name COLLATE NOCASE, s.id';

/** Subjects in display order, with lesson and active-objective counts; bounded to 200 rows. */
export async function listSubjects(db: SQLiteDatabase, options: { includeArchived: boolean }): Promise<Subject[]> {
  const rows = await db.getAllAsync<{ id: number; name: string; archived_at: number | null; lesson_count: number; color: string | null; sort_order: number | null; active_objectives: number }>(`
    SELECT s.id, s.name, s.archived_at, s.color, s.sort_order,
      (SELECT COUNT(*) FROM lessons l WHERE l.subject_id = s.id) AS lesson_count,
      (SELECT COUNT(*) FROM learning_objectives o WHERE o.subject_id = s.id AND o.status <> 'done') AS active_objectives
    FROM subjects s
    WHERE (? = 1 OR s.archived_at IS NULL)
    ORDER BY ${SUBJECT_ORDER}
    LIMIT ?`, options.includeArchived ? 1 : 0, MAX_SUBJECTS);
  return rows.map((row) => ({
    id: row.id, name: row.name, archived: row.archived_at !== null, lessonCount: row.lesson_count,
    color: isSubjectColor(row.color) ? row.color : null, sortOrder: row.sort_order, activeObjectives: row.active_objectives,
  }));
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

/** Sets a colour from the fixed palette, or clears it with null. Unknown keys are refused. */
export async function setSubjectColor(db: SQLiteDatabase, id: number, color: SubjectColor | null): Promise<void> {
  if (color !== null && !isSubjectColor(color)) throw new RangeError('Unknown subject colour');
  await db.runAsync('UPDATE subjects SET color = ? WHERE id = ?', color, id);
}

/**
 * Moves a subject one place up or down within its group (active or archived) and
 * renumbers the whole order 1…n in one transaction. Returns false at the edges.
 */
export async function moveSubject(db: SQLiteDatabase, id: number, direction: 'up' | 'down'): Promise<boolean> {
  let moved = false;
  await db.withTransactionAsync(async () => {
    const rows = await db.getAllAsync<{ id: number; archived: number }>(
      `SELECT s.id, s.archived_at IS NOT NULL AS archived FROM subjects s ORDER BY ${SUBJECT_ORDER} LIMIT ?`, MAX_ORDERED);
    const index = rows.findIndex((row) => row.id === id);
    const other = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || other < 0 || other >= rows.length || rows[other].archived !== rows[index].archived) return;
    [rows[index], rows[other]] = [rows[other], rows[index]];
    const statement = await db.prepareAsync('UPDATE subjects SET sort_order = $order WHERE id = $id');
    try {
      for (let position = 0; position < rows.length && position < MAX_SORT_ORDER; position += 1) {
        await statement.executeAsync({ $order: position + 1, $id: rows[position].id });
      }
    } finally {
      await statement.finalizeAsync();
    }
    moved = true;
  });
  return moved;
}
