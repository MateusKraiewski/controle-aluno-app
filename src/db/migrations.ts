// Schema migrations, kept free of expo imports so they can be exercised against
// Node's built-in SQLite in tests. Every step is additive: no DROP; v3 and v4 only fill
// the columns they add; v5 and v6 only create new tables (and v6 one trigger).
import { lessonSearchText, normalizeForSearch } from '../lib/text';

export const SCHEMA_VERSION = 8;

/** Rows per backfill page, so a long history is never read into memory at once. */
const BACKFILL_PAGE = 500;

/** Minimal surface of expo-sqlite's SQLiteDatabase used by the migrator. */
export type MigrationDatabase = {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T[]>;
  runAsync(source: string, ...params: (string | number | null)[]): Promise<unknown>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

const V1 = `
  CREATE TABLE subjects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE lessons (
    id INTEGER PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    teacher_name TEXT,
    local_date TEXT NOT NULL CHECK(length(local_date) = 10),
    start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480),
    planned_content TEXT,
    studied_content TEXT,
    attendance TEXT NOT NULL DEFAULT 'unmarked' CHECK(attendance IN ('unmarked','attended','absent')),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX lessons_date_time_idx ON lessons(local_date, start_minute, id);
  CREATE INDEX lessons_subject_date_idx ON lessons(subject_id, local_date DESC);
`;

// v2: lesson status (cancelled is not an absence), recurrence series, edit timestamps
// and subject archiving. ADD COLUMN keeps every existing row; defaults fill old rows.
const V2 = `
  CREATE TABLE lesson_series (
    id INTEGER PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    frequency TEXT NOT NULL CHECK(frequency IN ('weekly','biweekly')),
    weekdays_mask INTEGER NOT NULL CHECK(weekdays_mask BETWEEN 1 AND 127),
    start_date TEXT NOT NULL CHECK(length(start_date) = 10),
    end_date TEXT NOT NULL CHECK(length(end_date) = 10),
    start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480),
    created_at INTEGER NOT NULL
  );
  ALTER TABLE lessons ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','cancelled'));
  ALTER TABLE lessons ADD COLUMN cancel_reason TEXT;
  ALTER TABLE lessons ADD COLUMN series_id INTEGER REFERENCES lesson_series(id) ON DELETE SET NULL;
  ALTER TABLE lessons ADD COLUMN original_local_date TEXT;
  ALTER TABLE lessons ADD COLUMN updated_at INTEGER;
  ALTER TABLE subjects ADD COLUMN archived_at INTEGER;
  CREATE INDEX lessons_series_date_idx ON lessons(series_id, local_date) WHERE series_id IS NOT NULL;
`;

// v3: accent/case-insensitive search keys computed by the app (SQLite has no unaccent).
// Nullable ADD COLUMN, then backfilled below; existing values are not rewritten.
const V3 = `
  ALTER TABLE subjects ADD COLUMN search_name TEXT;
  ALTER TABLE lessons ADD COLUMN search_text TEXT;
`;

// v4: subject colour/order, series template (teacher and planned content used by
// "all occurrences" edits and extensions), private notes, next step and the
// per-occurrence "individually edited" flag. Nullable/defaulted ADD COLUMN only.
const V4 = `
  ALTER TABLE subjects ADD COLUMN color TEXT;
  ALTER TABLE subjects ADD COLUMN sort_order INTEGER;
  ALTER TABLE lesson_series ADD COLUMN teacher_name TEXT;
  ALTER TABLE lesson_series ADD COLUMN planned_content TEXT;
  ALTER TABLE lessons ADD COLUMN private_notes TEXT;
  ALTER TABLE lessons ADD COLUMN next_step TEXT;
  ALTER TABLE lessons ADD COLUMN series_exception INTEGER NOT NULL DEFAULT 0 CHECK(series_exception IN (0, 1));
`;

// v5: learning objectives per subject and the lessons where each was worked on.
// New tables only; no existing row or column is touched. The dismissed_review_* pair
// remembers which review suggestion (identified by its basis date) the student hid.
const V5 = `
  CREATE TABLE learning_objectives (
    id INTEGER PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','practising','done')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    dismissed_review_basis TEXT CHECK(dismissed_review_basis IS NULL OR length(dismissed_review_basis) = 10),
    dismissed_review_at INTEGER
  );
  CREATE INDEX learning_objectives_subject_idx ON learning_objectives(subject_id, status, id);
  CREATE TABLE lesson_objectives (
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    objective_id INTEGER NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (lesson_id, objective_id)
  ) WITHOUT ROWID;
  CREATE INDEX lesson_objectives_objective_idx ON lesson_objectives(objective_id, lesson_id);
`;

// v6: lesson attachments. The bytes live in files under the app's document directory
// (UUID names); SQLite keeps only metadata. Deleting an attachment row (directly or by
// the lesson's ON DELETE CASCADE) queues its file name in attachment_trash in the same
// transaction through a trigger, so the file is removed after commit and a crash in
// between leaves a pending cleanup, never a row pointing at a file the app deleted.
// New tables, index and trigger only; no existing row or column is touched.
// v7: school lunch menu imported from the school's PDF, one row per date (meals as JSON).
// The lunch the student picked for a day. Kept apart from lunch_days so importing a
// newer menu for the same dates never erases the choice.
const V8 = `
  CREATE TABLE lunch_choices (
    local_date TEXT PRIMARY KEY CHECK(length(local_date) = 10),
    choice TEXT NOT NULL CHECK(choice IN ('main', 'vegetarian', 'go2go')),
    chosen_at INTEGER NOT NULL
  );
`;

const V7 = `
  CREATE TABLE lunch_days (
    local_date TEXT PRIMARY KEY CHECK(length(local_date) = 10),
    holiday INTEGER NOT NULL DEFAULT 0 CHECK(holiday IN (0, 1)),
    meals TEXT NOT NULL,
    source_name TEXT,
    imported_at INTEGER NOT NULL
  );
`;

const V6 = `
  CREATE TABLE lesson_attachments (
    id INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL UNIQUE CHECK(length(file_name) BETWEEN 40 AND 41),
    display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
    mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg','image/webp','text/plain')),
    size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 5242880),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX lesson_attachments_lesson_idx ON lesson_attachments(lesson_id, id);
  CREATE TABLE attachment_trash (
    file_name TEXT PRIMARY KEY,
    queued_at INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TRIGGER lesson_attachments_to_trash AFTER DELETE ON lesson_attachments BEGIN
    INSERT OR IGNORE INTO attachment_trash (file_name, queued_at) VALUES (old.file_name, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  END;
`;

/**
 * Derives the v4 series state for data written before v4 (migration and restore of a
 * v3 backup). The series template takes teacher/planned content from the earliest
 * occurrence that was never edited (updated_at equal to created_at), falling back to
 * the earliest one. An occurrence whose governed fields differ from its series is
 * marked as individually edited, so "all occurrences" edits never overwrite it.
 * Only the v4 columns are written. Static SQL, no user values.
 */
export async function deriveSeriesState(db: MigrationDatabase): Promise<void> {
  const pick = (column: string) => `(SELECT l.${column} FROM lessons l WHERE l.series_id = lesson_series.id
    ORDER BY (l.updated_at IS NOT NULL AND l.updated_at <> l.created_at), l.original_local_date, l.id LIMIT 1)`;
  await db.execAsync(`
    UPDATE lesson_series SET teacher_name = ${pick('teacher_name')}, planned_content = ${pick('planned_content')};
    UPDATE lessons SET series_exception = 1
    WHERE series_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM lesson_series s WHERE s.id = lessons.series_id AND (
        lessons.subject_id <> s.subject_id OR lessons.start_minute <> s.start_minute
        OR lessons.duration_minutes <> s.duration_minutes OR lessons.local_date IS NOT lessons.original_local_date
        OR lessons.teacher_name IS NOT s.teacher_name OR lessons.planned_content IS NOT s.planned_content));
  `);
}

/** Fills the v3 search columns in id-ordered pages inside the migration transaction. */
async function backfillSearchColumns(db: MigrationDatabase): Promise<void> {
  for (let after = 0; ;) {
    const subjects = await db.getAllAsync<{ id: number; name: string }>(
      'SELECT id, name FROM subjects WHERE id > ? ORDER BY id LIMIT ?', after, BACKFILL_PAGE);
    for (const row of subjects) {
      await db.runAsync('UPDATE subjects SET search_name = ? WHERE id = ?', normalizeForSearch(row.name), row.id);
    }
    if (subjects.length < BACKFILL_PAGE) break;
    after = subjects[subjects.length - 1].id;
  }
  for (let after = 0; ;) {
    const lessons = await db.getAllAsync<{ id: number; teacher_name: string | null; planned_content: string | null; studied_content: string | null }>(
      'SELECT id, teacher_name, planned_content, studied_content FROM lessons WHERE id > ? ORDER BY id LIMIT ?', after, BACKFILL_PAGE);
    for (const row of lessons) {
      const searchText = lessonSearchText({ teacher: row.teacher_name, plannedContent: row.planned_content, studiedContent: row.studied_content });
      await db.runAsync('UPDATE lessons SET search_text = ? WHERE id = ?', searchText, row.id);
    }
    if (lessons.length < BACKFILL_PAGE) break;
    after = lessons[lessons.length - 1].id;
  }
}

export async function readSchemaVersion(db: MigrationDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (!row) throw new Error('Não foi possível ler a versão da base local');
  return row.user_version;
}

/** Brings the database to SCHEMA_VERSION in one transaction; failure rolls everything back. */
export async function migrate(db: MigrationDatabase): Promise<number> {
  const current = await readSchemaVersion(db);
  if (current > SCHEMA_VERSION) throw new Error('Esta base foi criada por uma versão mais recente do app');
  if (current === SCHEMA_VERSION) return current;
  await db.withTransactionAsync(async () => {
    if (current < 1) await db.execAsync(V1);
    if (current < 2) await db.execAsync(V2);
    if (current < 3) {
      await db.execAsync(V3);
      await backfillSearchColumns(db);
    }
    if (current < 4) {
      await db.execAsync(V4);
      await deriveSeriesState(db);
    }
    if (current < 5) await db.execAsync(V5);
    if (current < 6) await db.execAsync(V6);
    if (current < 7) await db.execAsync(V7);
    if (current < 8) await db.execAsync(V8);
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
  return SCHEMA_VERSION;
}
