import type { SQLiteDatabase } from 'expo-sqlite';
import { isValidLocalDate, toLocalDate } from '../lessons/domain';
import type { Result } from '../lessons/domain';
import { isObjectiveStatus, normalizeObjectiveTitle } from './domain';
import type { ObjectiveStatus, ObjectiveTitleError, ReviewCandidate } from './domain';

// Static SQL with bound parameters only; every listing is bounded.
/** Objectives per subject (also the cap when creating). */
export const MAX_OBJECTIVES_PER_SUBJECT = 200;
/** Not-done objectives read to compute review suggestions. */
const MAX_REVIEW_CANDIDATES = 500;

/**
 * A tagged lesson counts as "worked on" when it already happened (on or before
 * today), was not cancelled and the student did not mark themselves absent.
 * Fragment over alias `l`; `$today` is bound by name.
 */
const WORKED_LESSON = `l.local_date <= $today AND l.status = 'planned' AND l.attendance <> 'absent'`;

export type Objective = {
  id: number;
  subjectId: number;
  title: string;
  status: ObjectiveStatus;
  createdAt: number;
  updatedAt: number;
  /** Latest lesson (see WORKED_LESSON) where the student tagged this objective. */
  lastWorkedDate: string | null;
  /** Tagged lessons of any date or state. */
  lessonCount: number;
};

type ObjectiveRow = {
  id: number; subject_id: number; title: string; status: string; created_at: number; updated_at: number;
  last_worked: string | null; lesson_count: number;
};

function toObjective(row: ObjectiveRow): Objective {
  return {
    id: row.id, subjectId: row.subject_id, title: row.title, status: isObjectiveStatus(row.status) ? row.status : 'open',
    createdAt: row.created_at, updatedAt: row.updated_at, lastWorkedDate: row.last_worked, lessonCount: row.lesson_count,
  };
}

/** Objectives of one subject: practising, then open, then done (only with `includeDone`); at most 200. */
export async function listObjectives(
  db: SQLiteDatabase, subjectId: number, options: { includeDone: boolean; today?: string },
): Promise<Objective[]> {
  const today = options.today ?? toLocalDate(new Date());
  const rows = await db.getAllAsync<ObjectiveRow>(`
    SELECT o.id, o.subject_id, o.title, o.status, o.created_at, o.updated_at,
      (SELECT MAX(l.local_date) FROM lesson_objectives lo JOIN lessons l ON l.id = lo.lesson_id
        WHERE lo.objective_id = o.id AND ${WORKED_LESSON}) AS last_worked,
      (SELECT COUNT(*) FROM lesson_objectives lo WHERE lo.objective_id = o.id) AS lesson_count
    FROM learning_objectives o
    WHERE o.subject_id = $subject AND ($done = 1 OR o.status <> 'done')
    ORDER BY CASE o.status WHEN 'practising' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, o.id
    LIMIT $limit`, { $today: today, $subject: subjectId, $done: options.includeDone ? 1 : 0, $limit: MAX_OBJECTIVES_PER_SUBJECT });
  return rows.map(toObjective);
}

export type CreateObjectiveError = ObjectiveTitleError | 'subjectNotFound' | 'tooMany';

/** Adds an open objective to an existing subject. */
export async function createObjective(db: SQLiteDatabase, subjectId: number, title: string): Promise<Result<number, CreateObjectiveError>> {
  const normalized = normalizeObjectiveTitle(title);
  if (!normalized.ok) return normalized;
  let outcome: Result<number, CreateObjectiveError> = { ok: false, error: 'subjectNotFound' };
  await db.withTransactionAsync(async () => {
    const subject = await db.getFirstAsync<{ total: number }>(
      'SELECT (SELECT COUNT(*) FROM learning_objectives WHERE subject_id = s.id) AS total FROM subjects s WHERE s.id = ?', subjectId);
    if (!subject) { outcome = { ok: false, error: 'subjectNotFound' }; return; }
    if (subject.total >= MAX_OBJECTIVES_PER_SUBJECT) { outcome = { ok: false, error: 'tooMany' }; return; }
    const now = Date.now();
    const result = await db.runAsync(
      "INSERT INTO learning_objectives (subject_id, title, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)",
      subjectId, normalized.value, now, now);
    outcome = { ok: true, value: result.lastInsertRowId };
  });
  return outcome;
}

/** Renames an objective. Returns false when it does not exist. */
export async function renameObjective(db: SQLiteDatabase, id: number, title: string): Promise<Result<boolean, ObjectiveTitleError>> {
  const normalized = normalizeObjectiveTitle(title);
  if (!normalized.ok) return normalized;
  const result = await db.runAsync('UPDATE learning_objectives SET title = ?, updated_at = ? WHERE id = ?', normalized.value, Date.now(), id);
  return { ok: true, value: result.changes > 0 };
}

/** Sets open / practising / done as chosen by the student. Unknown values are refused. */
export async function setObjectiveStatus(db: SQLiteDatabase, id: number, status: ObjectiveStatus): Promise<boolean> {
  if (!isObjectiveStatus(status)) throw new RangeError('Unknown objective status');
  const result = await db.runAsync('UPDATE learning_objectives SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), id);
  return result.changes > 0;
}

export type LessonObjective = { id: number; title: string; status: ObjectiveStatus; tagged: boolean };

/**
 * Objectives that can be tagged on a lesson: those of the lesson's subject that are
 * not done, plus any already tagged (so a done objective stays visible). At most 200.
 */
export async function listLessonObjectives(db: SQLiteDatabase, lessonId: number): Promise<LessonObjective[]> {
  const rows = await db.getAllAsync<{ id: number; title: string; status: string; tagged: number }>(`
    SELECT o.id, o.title, o.status,
      EXISTS (SELECT 1 FROM lesson_objectives lo WHERE lo.lesson_id = l.id AND lo.objective_id = o.id) AS tagged
    FROM lessons l JOIN learning_objectives o ON o.subject_id = l.subject_id
    WHERE l.id = ? AND (o.status <> 'done' OR EXISTS (SELECT 1 FROM lesson_objectives lo WHERE lo.lesson_id = l.id AND lo.objective_id = o.id))
    ORDER BY CASE o.status WHEN 'practising' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, o.id
    LIMIT ?`, lessonId, MAX_OBJECTIVES_PER_SUBJECT);
  return rows.map((row) => ({ id: row.id, title: row.title, status: isObjectiveStatus(row.status) ? row.status : 'open', tagged: row.tagged === 1 }));
}

/**
 * Tags (or untags) an objective as worked on in a lesson. Tagging only succeeds when
 * the objective belongs to the lesson's subject; repeating it is a no-op. Returns
 * whether the stored state now matches `tagged`.
 */
export async function setLessonObjectiveTag(db: SQLiteDatabase, lessonId: number, objectiveId: number, tagged: boolean): Promise<boolean> {
  if (!tagged) {
    await db.runAsync('DELETE FROM lesson_objectives WHERE lesson_id = ? AND objective_id = ?', lessonId, objectiveId);
    return true;
  }
  await db.runAsync(`
    INSERT INTO lesson_objectives (lesson_id, objective_id, created_at)
    SELECT l.id, o.id, ? FROM lessons l JOIN learning_objectives o ON o.subject_id = l.subject_id
    WHERE l.id = ? AND o.id = ?
    ON CONFLICT(lesson_id, objective_id) DO NOTHING`, Date.now(), lessonId, objectiveId);
  const row = await db.getFirstAsync<{ found: number }>(
    'SELECT EXISTS (SELECT 1 FROM lesson_objectives WHERE lesson_id = ? AND objective_id = ?) AS found', lessonId, objectiveId);
  return row?.found === 1;
}

/**
 * Inputs of the review rule: not-done objectives of active (non-archived) subjects
 * with their last worked date up to `today`. Bounded to 500 rows, oldest first.
 */
export async function listReviewCandidates(db: SQLiteDatabase, today: string): Promise<ReviewCandidate[]> {
  if (!isValidLocalDate(today)) throw new RangeError('Invalid local date');
  const rows = await db.getAllAsync<{
    id: number; subject_id: number; subject: string; title: string; status: string; created_at: number;
    last_worked: string | null; dismissed_review_basis: string | null;
  }>(`
    SELECT o.id, o.subject_id, s.name AS subject, o.title, o.status, o.created_at, o.dismissed_review_basis,
      (SELECT MAX(l.local_date) FROM lesson_objectives lo JOIN lessons l ON l.id = lo.lesson_id
        WHERE lo.objective_id = o.id AND ${WORKED_LESSON}) AS last_worked
    FROM learning_objectives o JOIN subjects s ON s.id = o.subject_id
    WHERE o.status <> 'done' AND s.archived_at IS NULL
    ORDER BY o.id
    LIMIT $limit`, { $today: today, $limit: MAX_REVIEW_CANDIDATES });
  return rows.map((row) => ({
    objectiveId: row.id, subjectId: row.subject_id, subject: row.subject, title: row.title,
    status: isObjectiveStatus(row.status) ? row.status : 'open',
    // Creation instant shown as the device's local date.
    createdDate: toLocalDate(new Date(row.created_at)),
    lastWorkedDate: row.last_worked, dismissedBasis: row.dismissed_review_basis,
  }));
}

/** Hides the suggestion whose basis is `basisDate`; a later basis can suggest again. */
export async function dismissReviewSuggestion(db: SQLiteDatabase, objectiveId: number, basisDate: string): Promise<boolean> {
  if (!isValidLocalDate(basisDate)) throw new RangeError('Invalid local date');
  const result = await db.runAsync(
    'UPDATE learning_objectives SET dismissed_review_basis = ?, dismissed_review_at = ? WHERE id = ?', basisDate, Date.now(), objectiveId);
  return result.changes > 0;
}
