import type { SQLiteDatabase } from 'expo-sqlite';

const SCHEMA_VERSION = 1;

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -4000;');
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (!versionRow) throw new Error('Não foi possível ler a versão da base local');
  const current = versionRow.user_version;
  if (current > SCHEMA_VERSION) throw new Error('Esta base foi criada por uma versão mais recente do app');
  if (current < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
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
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
  }
}

export async function maintainDatabase(db: SQLiteDatabase) {
  // A passive checkpoint flushes WAL pages opportunistically without blocking readers.
  await db.execAsync('PRAGMA wal_checkpoint(PASSIVE);');
}
