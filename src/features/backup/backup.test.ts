import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { generateOccurrences } from '../lessons/domain';
import { cancelLessons, createLesson, createLessonSeries, listHistoryPage, updateAttendance, updateLesson } from '../lessons/repository';
import { createObjective, dismissReviewSuggestion, setLessonObjectiveTag, setObjectiveStatus } from '../objectives/repository';
import { listSubjects, moveSubject, setSubjectArchived, setSubjectColor } from '../subjects/repository';
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, MAX_BACKUP_CHARS, backupFileName, serializeBackup, summarizeBackup, validateBackup } from './format';
import type { BackupDocument, BackupErrorCode } from './format';
import { SchemaMismatchError, countLocalData, deleteAllData, exportBackup, restoreBackup } from './repository';

let db: SQLiteDatabase;
let raw: DatabaseSync;

async function openMigrated() {
  const opened = openTestDatabase();
  await migrate(opened.db);
  return opened;
}

beforeEach(async () => {
  ({ db, raw } = await openMigrated());
});

/** Every stored column of every table, including derived search keys. */
function snapshot(database: DatabaseSync): string {
  const dump = (sql: string) => database.prepare(sql).all().map((row) => ({ ...row }));
  return JSON.stringify({
    subjects: dump('SELECT id, name, search_name, created_at, archived_at, color, sort_order FROM subjects ORDER BY id'),
    series: dump('SELECT id, subject_id, frequency, weekdays_mask, start_date, end_date, start_minute, duration_minutes, created_at, teacher_name, planned_content FROM lesson_series ORDER BY id'),
    lessons: dump(`SELECT id, subject_id, teacher_name, local_date, start_minute, duration_minutes, planned_content, studied_content, attendance,
      status, cancel_reason, series_id, original_local_date, created_at, updated_at, private_notes, next_step, series_exception, search_text FROM lessons ORDER BY id`),
    objectives: dump('SELECT id, subject_id, title, status, created_at, updated_at, dismissed_review_basis, dismissed_review_at FROM learning_objectives ORDER BY id'),
    links: dump('SELECT lesson_id, objective_id, created_at FROM lesson_objectives ORDER BY lesson_id, objective_id'),
  });
}

const base = { teacher: null, startMinute: 600, durationMinutes: 50, plannedContent: null };

async function seed(target: SQLiteDatabase) {
  const a = await createLesson(target, { ...base, subject: 'Física', teacher: 'José Álvares', localDate: '2026-10-01', plannedContent: "Ótica d'água\nlinha 2" });
  await updateLesson(target, a, { ...base, subject: 'Física', teacher: 'José Álvares', localDate: '2026-10-01', plannedContent: "Ótica d'água\nlinha 2", studiedContent: 'Lentes 100% _ok_', privateNotes: 'Pedir lista à Ana', nextStep: 'Rever exercícios 3 e 4' });
  await updateAttendance(target, a, 'attended');
  const b = await createLesson(target, { ...base, subject: 'Química', localDate: '2026-10-02', startMinute: 900 });
  await updateAttendance(target, b, 'absent');
  const c = await createLesson(target, { ...base, subject: 'Química', localDate: '2026-10-03' });
  await cancelLessons(target, c, 'this', 'Feriado');
  const generated = generateOccurrences({ startDate: '2026-10-05', endDate: '2026-11-30', weekdays: [1, 4], frequency: 'biweekly' });
  if (!generated.ok) throw new Error(generated.error);
  await createLessonSeries(target, { ...base, subject: 'Inglês', localDate: '2026-10-05', frequency: 'biweekly', weekdays: [1, 4], endDate: '2026-11-30', dates: generated.value.dates });
  const history = await createLesson(target, { ...base, subject: 'História', localDate: '2026-09-01' });
  const subjects = await listSubjects(target, { includeArchived: true });
  const historia = subjects.find((item) => item.name === 'História');
  assert.ok(historia && history);
  await setSubjectArchived(target, historia.id, true);
  await setSubjectColor(target, historia.id, 'purple');
  const quimica = subjects.find((item) => item.name === 'Química');
  assert.ok(quimica);
  await moveSubject(target, quimica.id, 'up');
  // v5: objectives of Física, one tagged on lesson a with a dismissed suggestion, one done.
  const fisica = subjects.find((item) => item.name === 'Física');
  assert.ok(fisica);
  const newton = await createObjective(target, fisica.id, "Leis de Newton, \"forças\"; d'água");
  const optics = await createObjective(target, fisica.id, 'Ótica');
  assert.ok(newton.ok && optics.ok);
  assert.equal(await setLessonObjectiveTag(target, a, newton.value, true), true);
  await setObjectiveStatus(target, newton.value, 'practising');
  await dismissReviewSuggestion(target, newton.value, '2026-10-01');
  await setObjectiveStatus(target, optics.value, 'done');
}

function withoutExportedAt(document: BackupDocument) {
  const { exported_at: _ignored, ...rest } = document;
  return rest;
}

function validated(document: unknown) {
  const result = validateBackup(JSON.stringify(document));
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.path ?? ''}`);
  return result.value;
}

describe('backup export', () => {
  it('produces a versioned document without derived columns or preferences', async () => {
    await seed(db);
    const document = await exportBackup(db, new Date('2026-10-20T12:00:00.000Z'));
    assert.equal(document.format, BACKUP_FORMAT);
    assert.equal(document.schema_version, BACKUP_SCHEMA_VERSION);
    assert.equal(document.exported_at, '2026-10-20T12:00:00.000Z');
    assert.deepEqual(Object.keys(document), ['format', 'schema_version', 'exported_at', 'subjects', 'lesson_series', 'lessons', 'learning_objectives', 'lesson_objectives']);
    assert.equal(document.learning_objectives.length, 2);
    assert.equal(document.lesson_objectives.length, 1);
    assert.equal(document.subjects.length, 4);
    assert.equal(document.lesson_series.length, 1);
    assert.ok(document.lessons.every((row) => !('search_text' in row)));
    assert.ok(document.subjects.every((row) => !('search_name' in row)));
    assert.equal(backupFileName(document.exported_at), 'aula-em-dia-backup-2026-10-20.json');
    assert.deepEqual(summarizeBackup(document), { exportedAt: document.exported_at, schemaVersion: BACKUP_SCHEMA_VERSION, subjects: 4, series: 1, lessons: document.lessons.length, objectives: 2 });
  });

  it('reads more rows than one page', async () => {
    raw.exec("INSERT INTO subjects (id, name, search_name, created_at) VALUES (1, 'Matemática', 'matematica', 1)");
    const insert = raw.prepare("INSERT INTO lessons (subject_id, local_date, start_minute, duration_minutes, created_at, search_text) VALUES (1, '2026-01-01', ?, 30, 1, '\n\n')");
    for (let index = 0; index < 1203; index += 1) insert.run(index % 1440);
    const document = await exportBackup(db);
    assert.equal(document.lessons.length, 1203);
    assert.equal(new Set(document.lessons.map((row) => row.id)).size, 1203);
  });
});

describe('backup round trip', () => {
  it('export → validate → restore into another device reproduces every row', async () => {
    await seed(db);
    const original = await exportBackup(db);
    const text = serializeBackup(original);
    assert.ok(text.length < MAX_BACKUP_CHARS);
    const check = validateBackup(text);
    if (!check.ok) throw new Error(check.error.code);

    const target = await openMigrated();
    await createLesson(target.db, { ...base, subject: 'Dados antigos', localDate: '2026-01-01' }); // replaced, not merged
    const counts = await restoreBackup(target.db, check.value);
    assert.deepEqual(counts, { subjects: 4, series: 1, lessons: original.lessons.length, objectives: 2, objectiveLinks: 1 });
    assert.equal(snapshot(target.raw), snapshot(raw));
    assert.deepEqual(withoutExportedAt(await exportBackup(target.db)), withoutExportedAt(original));

    // Restored data is usable: accent-insensitive search and new writes work.
    const found = await listHistoryPage(target.db, { before: null, onOrBefore: '2026-12-31', subjectId: null, search: 'OTICA', limit: 10 });
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].privateNotes, found[0].nextStep], ['Pedir lista à Ana', 'Rever exercícios 3 e 4']);
    assert.equal((await listHistoryPage(target.db, { before: null, onOrBefore: '2026-12-31', subjectId: null, search: 'rever EXERCICIOS', limit: 10 })).length, 1);
    await createLesson(target.db, { ...base, subject: 'física', localDate: '2026-12-01' });
    assert.equal((await countLocalData(target.db)).subjects, 4);
  });

  it('restores an empty backup as an empty device', async () => {
    const empty = validated({ format: BACKUP_FORMAT, schema_version: BACKUP_SCHEMA_VERSION, exported_at: '2026-10-20T00:00:00.000Z', subjects: [], lesson_series: [], lessons: [], learning_objectives: [], lesson_objectives: [] });
    await seed(db);
    assert.deepEqual(await restoreBackup(db, empty), { subjects: 0, series: 0, lessons: 0, objectives: 0, objectiveLinks: 0 });
  });
});

describe('backup validation and rollback', () => {
  async function exported() {
    await seed(db);
    return JSON.parse(serializeBackup(await exportBackup(db))) as BackupDocument & Record<string, unknown>;
  }

  it('rejects malformed, newer and inconsistent backups without touching data', async () => {
    const good = await exported();
    const before = snapshot(raw);
    const mutate = (change: (doc: any) => void) => {
      const copy = structuredClone(good);
      change(copy);
      return JSON.stringify(copy);
    };
    const cases: [string, string, BackupErrorCode, string?][] = [
      ['empty', '   ', 'empty'],
      ['not json', '{"format": ', 'notJson'],
      ['array', '[]', 'notBackup'],
      ['other format', mutate((doc) => { doc.format = 'something-else'; }), 'notBackup'],
      ['newer schema', mutate((doc) => { doc.schema_version = BACKUP_SCHEMA_VERSION + 1; doc.new_table = []; }), 'newerSchema'],
      ['older schema', mutate((doc) => { doc.schema_version = 2; }), 'olderSchema'],
      ['fractional schema', mutate((doc) => { doc.schema_version = 2.5; }), 'invalidField', 'schema_version'],
      ['unknown top key', mutate((doc) => { doc.extra = 1; }), 'invalidField', '$.extra'],
      ['bad exported_at', mutate((doc) => { doc.exported_at = 'ontem'; }), 'invalidField', 'exported_at'],
      ['missing field', mutate((doc) => { delete doc.lessons[0].attendance; }), 'invalidField', 'lessons[0].attendance'],
      ['unknown field', mutate((doc) => { doc.lessons[0].search_text = 'x'; }), 'invalidField', 'lessons[0].search_text'],
      ['impossible date', mutate((doc) => { doc.lessons[0].local_date = '2026-02-30'; }), 'invalidField', 'lessons[0].local_date'],
      ['date with time', mutate((doc) => { doc.lessons[0].local_date = '2026-10-01T00:00'; }), 'invalidField', 'lessons[0].local_date'],
      ['minute out of range', mutate((doc) => { doc.lessons[0].start_minute = 1440; }), 'invalidField', 'lessons[0].start_minute'],
      ['string number', mutate((doc) => { doc.lessons[0].duration_minutes = '50'; }), 'invalidField', 'lessons[0].duration_minutes'],
      ['short duration', mutate((doc) => { doc.lessons[0].duration_minutes = 4; }), 'invalidField', 'lessons[0].duration_minutes'],
      ['long name', mutate((doc) => { doc.subjects[0].name = 'x'.repeat(81); }), 'invalidField', 'subjects[0].name'],
      ['blank name', mutate((doc) => { doc.subjects[0].name = '  '; }), 'invalidField', 'subjects[0].name'],
      ['long content', mutate((doc) => { doc.lessons[0].planned_content = 'x'.repeat(2001); }), 'invalidField', 'lessons[0].planned_content'],
      ['NUL in text', mutate((doc) => { doc.lessons[0].studied_content = 'a\u0000b'; }), 'invalidField', 'lessons[0].studied_content'],
      ['bad enum', mutate((doc) => { doc.lessons[0].attendance = 'late'; }), 'invalidField', 'lessons[0].attendance'],
      ['cancelled with absence', mutate((doc) => { doc.lessons[2].attendance = 'absent'; }), 'invalidField', 'lessons[2].attendance'],
      ['planned with reason', mutate((doc) => { doc.lessons[0].cancel_reason = 'x'; }), 'invalidField', 'lessons[0].cancel_reason'],
      ['series end before start', mutate((doc) => { doc.lesson_series[0].end_date = '2026-01-01'; }), 'invalidField', 'lesson_series[0].end_date'],
      ['weekday mask', mutate((doc) => { doc.lesson_series[0].weekdays_mask = 128; }), 'invalidField', 'lesson_series[0].weekdays_mask'],
      ['negative id', mutate((doc) => { doc.subjects[0].id = -1; }), 'invalidField', 'subjects[0].id'],
      ['duplicate lesson id', mutate((doc) => { doc.lessons[1].id = doc.lessons[0].id; }), 'duplicateId', 'lessons[1].id'],
      ['duplicate subject name', mutate((doc) => { doc.subjects[1].name = doc.subjects[0].name.replace('F', 'f'); }), 'duplicateSubject', 'subjects[1].name'],
      ['missing subject', mutate((doc) => { doc.lessons[0].subject_id = 999; }), 'missingReference', 'lessons[0].subject_id'],
      ['missing series', mutate((doc) => { doc.lessons[0].series_id = 999; }), 'missingReference', 'lessons[0].series_id'],
      ['series missing subject', mutate((doc) => { doc.lesson_series[0].subject_id = 999; }), 'missingReference', 'lesson_series[0].subject_id'],
      ['too many', mutate((doc) => { doc.subjects = Array.from({ length: 2001 }, (_, index) => ({ id: index + 1, name: `S${index}`, created_at: 1, archived_at: null })); }), 'tooManyRecords', 'subjects'],
      ['too large', ' '.repeat(MAX_BACKUP_CHARS) + '{}', 'tooLarge'],
    ];
    for (const [label, text, code, path] of cases) {
      const result = validateBackup(text);
      assert.equal(result.ok, false, label);
      if (!result.ok) {
        assert.equal(result.error.code, code, label);
        if (path) assert.equal(result.error.path, path, label);
      }
    }
    assert.equal(snapshot(raw), before);
  });

  it('never restores a backup from a newer schema, even if handed one directly', async () => {
    const good = await exported();
    const before = snapshot(raw);
    const newer = validateBackup(JSON.stringify({ ...good, schema_version: BACKUP_SCHEMA_VERSION + 1 }), BACKUP_SCHEMA_VERSION + 1);
    if (!newer.ok) throw new Error(newer.error.code);
    await assert.rejects(restoreBackup(db, newer.value), SchemaMismatchError);
    assert.equal(snapshot(raw), before);
  });

  it('rolls back completely when a write fails midway', async () => {
    const good = await exported();
    const backup = validated(good);
    const before = snapshot(raw);
    const lastId = good.lessons[good.lessons.length - 1].id;
    // Injected failure on the very last lesson insert, after subjects/series/most lessons were written.
    raw.exec(`CREATE TRIGGER fail_restore BEFORE INSERT ON lessons WHEN NEW.id = ${lastId} BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
    await assert.rejects(restoreBackup(db, backup), /injected/);
    assert.equal(snapshot(raw), before);
  });
});

describe('delete all data', () => {
  it('erases subjects, series and lessons in one step and leaves a working database', async () => {
    await seed(db);
    const before = await countLocalData(db);
    const result = await deleteAllData(db);
    assert.deepEqual(result.deleted, before);
    assert.equal(result.compacted, true);
    assert.deepEqual(await countLocalData(db), { subjects: 0, series: 0, lessons: 0, objectives: 0, objectiveLinks: 0 });
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, SCHEMA_VERSION);
    await createLesson(db, { ...base, subject: 'Nova', localDate: '2026-10-20' });
    assert.deepEqual(await countLocalData(db), { subjects: 1, series: 0, lessons: 1, objectives: 0, objectiveLinks: 0 });
  });

  it('rolls back when the erase fails', async () => {
    await seed(db);
    const before = snapshot(raw);
    raw.exec("CREATE TRIGGER fail_erase BEFORE DELETE ON subjects BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    await assert.rejects(deleteAllData(db), /injected/);
    assert.equal(snapshot(raw), before);
  });
});

describe('backup schema compatibility', () => {
  /** Turns a current export into a document exactly as the app version with schema v4 wrote it. */
  function asV4(document: BackupDocument): Record<string, unknown> {
    const { learning_objectives: _o, lesson_objectives: _l, ...rest } = document;
    return { ...rest, schema_version: 4 };
  }

  /** Turns a current export into a document exactly as the app version with schema v3 wrote it. */
  function asV3(document: BackupDocument): Record<string, unknown> {
    const { learning_objectives: _o, lesson_objectives: _l, ...rest } = document;
    return {
      ...rest,
      schema_version: 3,
      subjects: document.subjects.map(({ color: _c, sort_order: _o, ...row }) => row),
      lesson_series: document.lesson_series.map(({ teacher_name: _t, planned_content: _p, ...row }) => row),
      lessons: document.lessons.map(({ private_notes: _n, next_step: _s, series_exception: _e, ...row }) => row),
    };
  }

  it('exports the v4 and v5 fields', async () => {
    await seed(db);
    raw.exec("UPDATE subjects SET color = 'blue', sort_order = 2 WHERE name = 'Física'");
    const document = await exportBackup(db);
    assert.equal(document.schema_version, 5);
    assert.deepEqual(Object.keys(document.learning_objectives[0]), ['id', 'subject_id', 'title', 'status', 'created_at', 'updated_at', 'dismissed_review_basis', 'dismissed_review_at']);
    assert.deepEqual(document.learning_objectives.map((row) => [row.status, row.dismissed_review_basis]), [['practising', '2026-10-01'], ['done', null]]);
    assert.deepEqual(Object.keys(document.lesson_objectives[0]), ['lesson_id', 'objective_id', 'created_at']);
    assert.deepEqual(Object.keys(document.subjects[0]), ['id', 'name', 'created_at', 'archived_at', 'color', 'sort_order']);
    assert.ok(document.lesson_series.every((row) => 'teacher_name' in row && 'planned_content' in row));
    assert.ok(document.lessons.every((row) => 'private_notes' in row && 'next_step' in row && 'series_exception' in row));
    const fisica = document.subjects.find((row) => row.name === 'Física');
    assert.deepEqual([fisica?.color, fisica?.sort_order], ['blue', 2]);
  });

  it('still restores a v3 backup and derives the series state', async () => {
    await seed(db);
    raw.exec("UPDATE lessons SET start_minute = 700, series_exception = 1 WHERE id = (SELECT MAX(id) FROM lessons WHERE series_id IS NOT NULL)");
    const v4 = await exportBackup(db);
    const text = JSON.stringify(asV3(v4));
    const check = validateBackup(text);
    if (!check.ok) throw new Error(`${check.error.code} ${check.error.path ?? ''}`);
    assert.equal(check.value.schema_version, 3);
    assert.equal(summarizeBackup(check.value).schemaVersion, 3);

    const target = await openMigrated();
    await restoreBackup(target.db, check.value);
    const restored = await exportBackup(target.db);
    assert.equal(restored.schema_version, BACKUP_SCHEMA_VERSION);
    assert.deepEqual([restored.learning_objectives, restored.lesson_objectives], [[], []]);
    // Everything the v3 document carried is identical; v4 fields are filled/derived.
    assert.deepEqual(asV3(restored).lessons, asV3(v4).lessons);
    assert.deepEqual(restored.lesson_series.map((row) => [row.teacher_name, row.planned_content]), [[null, null]]);
    assert.deepEqual(restored.lessons.filter((row) => row.series_exception === 1).map((row) => row.id), v4.lessons.filter((row) => row.series_exception === 1).map((row) => row.id));
    assert.ok(restored.subjects.every((row) => row.color === null && row.sort_order === null));
  });

  it('still restores a v4 backup, without objectives', async () => {
    await seed(db);
    const v5 = await exportBackup(db);
    const check = validateBackup(JSON.stringify(asV4(v5)));
    if (!check.ok) throw new Error(`${check.error.code} ${check.error.path ?? ''}`);
    assert.equal(check.value.schema_version, 4);
    assert.equal(summarizeBackup(check.value).objectives, 0);
    const target = await openMigrated();
    const counts = await restoreBackup(target.db, check.value);
    assert.deepEqual([counts.objectives, counts.objectiveLinks], [0, 0]);
    const restored = await exportBackup(target.db);
    assert.deepEqual(asV4(restored), { ...asV4(v5), exported_at: restored.exported_at });
  });

  it('rejects invalid v5 objectives and tags without touching data', async () => {
    await seed(db);
    await createLesson(db, { ...base, subject: 'Química', localDate: '2026-10-04' });
    const good = JSON.parse(serializeBackup(await exportBackup(db))) as any;
    const before = snapshot(raw);
    const quimicaLesson = good.lessons.find((row: any) => row.local_date === '2026-10-04').id;
    const objective = (change: (row: any) => void) => ({ ...good, learning_objectives: good.learning_objectives.map((row: any, index: number) => { const copy = { ...row }; if (index === 0) change(copy); return copy; }) });
    const link = (change: (row: any) => void) => ({ ...good, lesson_objectives: good.lesson_objectives.map((row: any) => { const copy = { ...row }; change(copy); return copy; }) });
    const cases: [string, unknown, BackupErrorCode, string][] = [
      ['v4 document with objectives', { ...asV4(good), learning_objectives: [] }, 'invalidField', '$.learning_objectives'],
      ['v5 document without tags', (({ lesson_objectives: _l, ...rest }) => rest)(good), 'invalidField', '$.lesson_objectives'],
      ['unknown status', objective((row) => { row.status = 'mastered'; }), 'invalidField', 'learning_objectives[0].status'],
      ['grade-like field', objective((row) => { row.score = 10; }), 'invalidField', 'learning_objectives[0].score'],
      ['long title', objective((row) => { row.title = 'x'.repeat(201); }), 'invalidField', 'learning_objectives[0].title'],
      ['title with newline', objective((row) => { row.title = 'a\nb'; }), 'invalidField', 'learning_objectives[0].title'],
      ['blank title', objective((row) => { row.title = ' '; }), 'invalidField', 'learning_objectives[0].title'],
      ['half dismissal', objective((row) => { row.dismissed_review_at = null; }), 'invalidField', 'learning_objectives[0].dismissed_review_at'],
      ['bad dismissal date', objective((row) => { row.dismissed_review_basis = '2026-02-30'; }), 'invalidField', 'learning_objectives[0].dismissed_review_basis'],
      ['objective of unknown subject', objective((row) => { row.subject_id = 999; }), 'missingReference', 'learning_objectives[0].subject_id'],
      ['duplicate objective id', { ...good, learning_objectives: [good.learning_objectives[0], good.learning_objectives[0]] }, 'duplicateId', 'learning_objectives[1].id'],
      ['tag of unknown lesson', link((row) => { row.lesson_id = 999; }), 'missingReference', 'lesson_objectives[0].lesson_id'],
      ['tag of unknown objective', link((row) => { row.objective_id = 999; }), 'missingReference', 'lesson_objectives[0].objective_id'],
      ['tag across subjects', link((row) => { row.lesson_id = quimicaLesson; }), 'invalidField', 'lesson_objectives[0].objective_id'],
      ['duplicate tag', { ...good, lesson_objectives: [good.lesson_objectives[0], good.lesson_objectives[0]] }, 'duplicateId', 'lesson_objectives[1]'],
      ['too many tags', { ...good, lesson_objectives: Array.from({ length: 60_001 }, () => good.lesson_objectives[0]) }, 'tooManyRecords', 'lesson_objectives'],
    ];
    for (const [label, document, code, path] of cases) {
      const result = validateBackup(JSON.stringify(document));
      assert.equal(result.ok, false, label);
      if (!result.ok) {
        assert.equal(result.error.code, code, label);
        assert.equal(result.error.path, path, label);
      }
    }
    assert.equal(snapshot(raw), before);
  });

  it('rejects mixed or invalid v4 fields', async () => {
    await seed(db);
    const good = JSON.parse(serializeBackup(await exportBackup(db))) as any;
    const v3 = asV3(good) as any;
    const cases: [string, unknown, string][] = [
      ['v3 document with a v4 key', { ...v3, lessons: v3.lessons.map((row: any, index: number) => (index === 0 ? { ...row, private_notes: null } : row)) }, 'lessons[0].private_notes'],
      ['v4 document without a v4 key', { ...good, subjects: good.subjects.map(({ color: _c, ...row }: any) => row) }, 'subjects[0].color'],
      ['unknown colour', { ...good, subjects: good.subjects.map((row: any) => ({ ...row, color: '#ff0000' })) }, 'subjects[0].color'],
      ['negative order', { ...good, subjects: good.subjects.map((row: any) => ({ ...row, sort_order: -1 })) }, 'subjects[0].sort_order'],
      ['exception without series', { ...good, lessons: good.lessons.map((row: any, index: number) => (index === 0 ? { ...row, series_exception: 1 } : row)) }, 'lessons[0].series_exception'],
      ['exception not 0/1', { ...good, lessons: good.lessons.map((row: any) => ({ ...row, series_exception: 2 })) }, 'lessons[0].series_exception'],
      ['blank notes', { ...good, lessons: good.lessons.map((row: any) => ({ ...row, private_notes: '  ' })) }, 'lessons[0].private_notes'],
      ['long next step', { ...good, lessons: good.lessons.map((row: any) => ({ ...row, next_step: 'x'.repeat(2001) })) }, 'lessons[0].next_step'],
      ['series teacher with newline', { ...good, lesson_series: good.lesson_series.map((row: any) => ({ ...row, teacher_name: 'a\nb' })) }, 'lesson_series[0].teacher_name'],
    ];
    for (const [label, document, path] of cases) {
      const result = validateBackup(JSON.stringify(document));
      assert.equal(result.ok, false, label);
      if (!result.ok) {
        assert.equal(result.error.code, 'invalidField', label);
        assert.equal(result.error.path, path, label);
      }
    }
  });
});
