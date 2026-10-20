import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, SCHEMA_VERSION } from './migrations';
import { openTestDatabase } from '../testing/nodeSqlite';

// Exact v1 DDL as shipped in the first increment, to prove the upgrade path.
const V1_SHIPPED = `
  CREATE TABLE subjects (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at INTEGER NOT NULL);
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
  PRAGMA user_version = 1;
`;

describe('migrations', () => {
  it('creates a fresh database at the current version', async () => {
    const { db, raw } = openTestDatabase();
    assert.equal(await migrate(db), SCHEMA_VERSION);
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name);
    assert.deepEqual(tables, ['lesson_series', 'lessons', 'subjects']);
    // Idempotent on reopen.
    assert.equal(await migrate(db), SCHEMA_VERSION);
  });

  it('upgrades a v1 database without losing rows', async () => {
    const { db, raw } = openTestDatabase();
    raw.exec(V1_SHIPPED);
    raw.exec(`
      INSERT INTO subjects (id, name, created_at) VALUES (1, 'Física', 1), (2, 'Inglês', 1);
      INSERT INTO lessons (subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, studied_content, attendance, created_at)
      VALUES (1, 'Ana', '2026-10-01', 600, 50, 'Ótica', 'Lentes', 'attended', 1),
             (2, NULL, '2026-10-02', 900, 60, NULL, NULL, 'absent', 2);
    `);
    await migrate(db);
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 2);
    const rows = raw.prepare('SELECT subject_id, teacher_name, local_date, planned_content, studied_content, attendance, status, series_id, cancel_reason FROM lessons ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.deepEqual({ ...rows[0] }, { subject_id: 1, teacher_name: 'Ana', local_date: '2026-10-01', planned_content: 'Ótica', studied_content: 'Lentes', attendance: 'attended', status: 'planned', series_id: null, cancel_reason: null });
    assert.equal(rows[1].attendance, 'absent');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM subjects WHERE archived_at IS NULL').get()?.n, 2);
  });

  it('rolls back a failed upgrade and keeps v1 intact', async () => {
    const { db, raw } = openTestDatabase();
    raw.exec(V1_SHIPPED);
    raw.exec("INSERT INTO subjects (id, name, created_at) VALUES (1, 'Química', 1); INSERT INTO lessons (subject_id, local_date, start_minute, duration_minutes, created_at) VALUES (1, '2026-10-01', 600, 50, 1);");
    raw.exec('CREATE TABLE lesson_series (id INTEGER PRIMARY KEY);'); // injected failure: name clash
    await assert.rejects(migrate(db));
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 1);
    const columns = raw.prepare('PRAGMA table_info(lessons)').all().map((row) => row.name);
    assert.equal(columns.includes('status'), false);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons').get()?.n, 1);
  });

  it('refuses a database from a newer app version', async () => {
    const { db, raw } = openTestDatabase();
    raw.exec('PRAGMA user_version = 99');
    await assert.rejects(migrate(db), /mais recente/);
  });
});
