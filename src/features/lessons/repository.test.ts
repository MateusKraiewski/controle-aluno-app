import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { generateOccurrences } from './domain';
import {
  cancelLessons, createLesson, createLessonSeries, deleteLessons, getLesson, listHistoryPage, listLessonsInRange,
  listTimeSlots, restoreLesson, updateAttendance, updateLesson,
} from './repository';
import { listSubjects, renameSubject, setSubjectArchived } from '../subjects/repository';
import type { Lesson } from './types';

let db: SQLiteDatabase;
let raw: DatabaseSync;

const lesson = (overrides: Partial<Parameters<typeof createLesson>[1]> = {}) => ({
  subject: 'Matemática', teacher: null, localDate: '2026-10-20', startMinute: 900, durationMinutes: 60, plannedContent: null, ...overrides,
});

beforeEach(async () => {
  ({ db, raw } = openTestDatabase());
  await migrate(db);
});

describe('lessons repository', () => {
  it('creates, reads and lists a bounded week', async () => {
    const id = await createLesson(db, lesson({ plannedContent: "Frações d'água" }));
    await createLesson(db, lesson({ subject: 'matemática', localDate: '2026-10-26' })); // same subject, other week
    const week = await listLessonsInRange(db, '2026-10-19', '2026-10-26');
    assert.deepEqual(week.map((item) => item.id), [id]);
    const stored = await getLesson(db, id);
    assert.equal(stored?.plannedContent, "Frações d'água");
    assert.equal(stored?.status, 'planned');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM subjects').get()?.n, 1); // NOCASE unique subject
  });

  it('edits one lesson including studied content', async () => {
    const id = await createLesson(db, lesson());
    await updateLesson(db, id, { ...lesson({ subject: 'Física', teacher: 'Rui', startMinute: 600 }), studiedContent: 'Leis de Newton' });
    const stored = await getLesson(db, id);
    assert.equal(stored?.subject, 'Física');
    assert.equal(stored?.teacher, 'Rui');
    assert.equal(stored?.startMinute, 600);
    assert.equal(stored?.studiedContent, 'Leis de Newton');
    assert.ok(stored?.updatedAt);
  });

  it('cancels without recording an absence and blocks attendance while cancelled', async () => {
    const id = await createLesson(db, lesson());
    assert.equal(await updateAttendance(db, id, 'absent'), true);
    await cancelLessons(db, id, 'this', 'Feriado');
    let stored = await getLesson(db, id);
    assert.equal(stored?.status, 'cancelled');
    assert.equal(stored?.attendance, 'unmarked');
    assert.equal(stored?.cancelReason, 'Feriado');
    assert.equal(await updateAttendance(db, id, 'attended'), false);
    await restoreLesson(db, id);
    stored = await getLesson(db, id);
    assert.equal(stored?.status, 'planned');
    assert.equal(await updateAttendance(db, id, 'attended'), true);
  });

  it('creates a series in one transaction and applies "this and following" scopes', async () => {
    const generated = generateOccurrences({ startDate: '2026-10-19', endDate: '2026-11-13', weekdays: [1, 3], frequency: 'weekly' });
    if (!generated.ok) throw new Error(generated.error);
    const dates = generated.value.dates;
    assert.equal(dates.length, 8);
    const { seriesId, count } = await createLessonSeries(db, { ...lesson({ localDate: dates[0] }), frequency: 'weekly', weekdays: [1, 3], endDate: '2026-11-13', dates });
    assert.equal(count, 8);
    const all = await listLessonsInRange(db, '2026-10-01', '2026-12-01');
    assert.equal(all.length, 8);
    assert.ok(all.every((item) => item.seriesId === seriesId));

    const third = all[2]; // 2026-10-26
    assert.equal(await cancelLessons(db, third.id, 'following', null), 6);
    const afterCancel = await listLessonsInRange(db, '2026-10-01', '2026-12-01');
    assert.deepEqual(afterCancel.map((item) => item.status), ['planned', 'planned', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled']);

    const fifth = all[4]; // 2026-11-02
    assert.equal(await deleteLessons(db, fifth.id, 'following'), 4);
    assert.equal((await listLessonsInRange(db, '2026-10-01', '2026-12-01')).length, 4);
    assert.equal(raw.prepare('SELECT end_date FROM lesson_series WHERE id = ?').get(seriesId)?.end_date, '2026-11-01');

    assert.equal(await deleteLessons(db, all[0].id, 'following'), 4);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lesson_series').get()?.n, 0);
  });

  it('rolls back a series when one occurrence is invalid', async () => {
    await assert.rejects(createLessonSeries(db, { ...lesson(), frequency: 'weekly', weekdays: [2], endDate: '2026-10-27', dates: ['2026-10-20', 'bad'] }));
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons').get()?.n, 0);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lesson_series').get()?.n, 0);
  });

  it('deletes a single occurrence only', async () => {
    const a = await createLesson(db, lesson());
    const b = await createLesson(db, lesson({ startMinute: 1000 }));
    assert.equal(await deleteLessons(db, a, 'this'), 1);
    assert.equal(await getLesson(db, a), null);
    assert.ok(await getLesson(db, b));
  });

  it('lists light time slots for conflict checks', async () => {
    await createLesson(db, lesson());
    const slots = await listTimeSlots(db, '2026-10-20', '2026-10-20');
    assert.deepEqual(slots.map(({ localDate, startMinute, durationMinutes, status }) => ({ localDate, startMinute, durationMinutes, status })), [{ localDate: '2026-10-20', startMinute: 900, durationMinutes: 60, status: 'planned' }]);
  });
});

describe('history pagination and search', () => {
  async function seed() {
    for (let day = 1; day <= 9; day += 1) {
      await createLesson(db, lesson({ localDate: `2026-10-0${day}`, subject: day % 2 ? 'Física' : 'Química', plannedContent: day === 3 ? 'Taxa de 100% e _sublinhado_' : `Tópico ${day}` }));
    }
    await createLesson(db, lesson({ localDate: '2026-10-05', startMinute: 600 }));
    await createLesson(db, lesson({ localDate: '2026-12-01' })); // future: not history
  }

  async function collect(query: { subjectId?: number | null; search?: string; limit: number }) {
    const pages: Lesson[][] = [];
    let before = null as Lesson | null;
    for (let i = 0; i < 20; i += 1) {
      const page = await listHistoryPage(db, { before: before && { localDate: before.localDate, startMinute: before.startMinute, id: before.id }, onOrBefore: '2026-10-20', subjectId: query.subjectId ?? null, search: query.search ?? '', limit: query.limit });
      if (page.length === 0) break;
      pages.push(page);
      before = page[page.length - 1];
      if (page.length < query.limit) break;
    }
    return pages;
  }

  it('walks every past lesson exactly once, newest first', async () => {
    await seed();
    const pages = await collect({ limit: 3 });
    const flat = pages.flat();
    assert.equal(flat.length, 10);
    assert.equal(new Set(flat.map((item) => item.id)).size, 10);
    assert.equal(flat[0].localDate, '2026-10-09');
    assert.deepEqual(flat.filter((item) => item.localDate === '2026-10-05').map((item) => item.startMinute), [900, 600]);
  });

  it('filters by subject and searches literal wildcards', async () => {
    await seed();
    const subjects = await listSubjects(db, { includeArchived: true });
    const quimica = subjects.find((item) => item.name === 'Química');
    assert.ok(quimica);
    assert.equal((await collect({ subjectId: quimica.id, limit: 50 })).flat().length, 4);
    assert.deepEqual((await collect({ search: '100%', limit: 50 })).flat().map((item) => item.localDate), ['2026-10-03']);
    assert.equal((await collect({ search: '%', limit: 50 })).flat().length, 1);
    assert.equal((await collect({ search: '_', limit: 50 })).flat().length, 1);
    assert.equal((await collect({ search: "'; DROP TABLE lessons; --", limit: 50 })).flat().length, 0);
    assert.equal((await collect({ search: 'FÍSICA', limit: 50 })).flat().length, 0); // LIKE folds ASCII case only
    assert.equal((await collect({ search: 'Física', limit: 50 })).flat().length, 5);
  });
});

describe('subjects repository', () => {
  it('renames with case-insensitive uniqueness and archives without touching lessons', async () => {
    await createLesson(db, lesson({ subject: 'Historia' }));
    await createLesson(db, lesson({ subject: 'Geografia' }));
    let subjects = await listSubjects(db, { includeArchived: false });
    const historia = subjects.find((item) => item.name === 'Historia');
    assert.ok(historia);
    assert.equal(await renameSubject(db, historia.id, 'GEOGRAFIA'), 'duplicate');
    assert.equal(await renameSubject(db, historia.id, 'História'), 'ok');
    await setSubjectArchived(db, historia.id, true);
    subjects = await listSubjects(db, { includeArchived: false });
    assert.deepEqual(subjects.map((item) => item.name), ['Geografia']);
    const all = await listSubjects(db, { includeArchived: true });
    assert.deepEqual(all.map((item) => [item.name, item.archived, item.lessonCount]), [['Geografia', false, 1], ['História', true, 1]]);
    // Using an archived subject again restores it.
    await createLesson(db, lesson({ subject: 'história' }));
    assert.equal((await listSubjects(db, { includeArchived: false })).length, 2);
  });
});
