// Schema migrations, kept free of expo imports so they can be exercised against
// Node's built-in SQLite in tests. Every step is additive: no DROP, no data rewrite.

export const SCHEMA_VERSION = 2;

/** Minimal surface of expo-sqlite's SQLiteDatabase used by the migrator. */
export type MigrationDatabase = {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string): Promise<T | null>;
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
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
  return SCHEMA_VERSION;
}
