import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { generateOccurrences, isAfter, maskToWeekdays, planSeriesEnd } from './domain';
import type { Moment } from './domain';
import {
  cancelLessons, changeSeriesEnd, createLessonSeries, getLesson, getSeries, listLessonsInRange, listSeriesEditTargets,
  updateAttendance, updateLesson,
} from './repository';
import type { Lesson } from './types';

let db: SQLiteDatabase;
let raw: DatabaseSync;

// Tuesday 20 October 2026, 10:00 on the device clock.
const NOW: Moment = { localDate: '2026-10-20', minute: 600 };
const base = { subject: 'Física', teacher: 'Ana', startMinute: 900, durationMinutes: 50, plannedContent: 'Ótica' };

beforeEach(async () => {
  ({ db, raw } = openTestDatabase());
  await migrate(db);
});

/** Tue/Thu weekly series from 13 Oct to 12 Nov 2026: 13, 15, 20, 22, 27, 29 Oct, 3, 5, 10, 12 Nov. */
async function createSeries() {
  const generated = generateOccurrences({ startDate: '2026-10-13', endDate: '2026-11-12', weekdays: [2, 4], frequency: 'weekly' });
  if (!generated.ok) throw new Error(generated.error);
  const { seriesId } = await createLessonSeries(db, { ...base, localDate: '2026-10-13', frequency: 'weekly', weekdays: [2, 4], endDate: '2026-11-12', dates: generated.value.dates });
  return seriesId;
}

async function byDate(): Promise<Map<string, Lesson>> {
  const rows = await listLessonsInRange(db, '2026-10-01', '2027-01-01');
  return new Map(rows.map((row) => [row.localDate, row]));
}

function update(lesson: Lesson, changes: Partial<Parameters<typeof updateLesson>[2]>) {
  return {
    subject: lesson.subject, teacher: lesson.teacher, localDate: lesson.localDate, startMinute: lesson.startMinute,
    durationMinutes: lesson.durationMinutes, plannedContent: lesson.plannedContent, studiedContent: lesson.studiedContent,
    privateNotes: lesson.privateNotes, nextStep: lesson.nextStep, ...changes,
  };
}

/** Records, cancels and edits some occurrences so only 20 Oct, 10 and 12 Nov stay untouched. */
async function touchSome() {
  const lessons = await byDate();
  const get = (date: string) => { const lesson = lessons.get(date); assert.ok(lesson, date); return lesson; };
  await updateAttendance(db, get('2026-10-22').id, 'attended');
  await cancelLessons(db, get('2026-10-27').id, 'this', null);
  await updateLesson(db, get('2026-10-29').id, update(get('2026-10-29'), { plannedContent: 'Capítulo especial' }));
  await updateLesson(db, get('2026-11-03').id, update(get('2026-11-03'), { studiedContent: 'Revisão antecipada' }));
  // A future lesson with only a next step written is also "recorded" and kept.
  await updateLesson(db, get('2026-11-05').id, update(get('2026-11-05'), { nextStep: 'Levar calculadora' }));
  return lessons;
}

describe('series domain rules', () => {
  it('decodes weekday masks and compares moments', () => {
    assert.deepEqual(maskToWeekdays(0b0010100), [2, 4]);
    assert.equal(isAfter('2026-10-20', 601, NOW), true);
    assert.equal(isAfter('2026-10-20', 600, NOW), false);
    assert.equal(isAfter('2026-10-19', 1400, NOW), false);
    assert.equal(isAfter('2026-10-21', 0, NOW), true);
  });

  it('plans extensions after the old end, in the future, without duplicates', () => {
    const rule = { startDate: '2026-10-13', endDate: '2026-11-12', weekdays: [2, 4], frequency: 'weekly' as const, startMinute: 900 };
    const plan = planSeriesEnd(rule, '2026-11-26', NOW, new Set(['2026-11-19']));
    assert.deepEqual(plan, { ok: true, value: { add: ['2026-11-17', '2026-11-24', '2026-11-26'] } });
    // Shortening or keeping the end never adds.
    assert.deepEqual(planSeriesEnd(rule, '2026-11-12', NOW, new Set()), { ok: true, value: { add: [] } });
    assert.deepEqual(planSeriesEnd(rule, '2026-10-20', NOW, new Set()), { ok: true, value: { add: [] } });
    // A rule that ended in the past only gains future dates.
    const old = { ...rule, endDate: '2026-10-01', startDate: '2026-09-01' };
    const resumed = planSeriesEnd(old, '2026-10-27', NOW, new Set());
    assert.deepEqual(resumed, { ok: true, value: { add: ['2026-10-20', '2026-10-22', '2026-10-27'] } });
    assert.deepEqual(planSeriesEnd(old, '2026-10-27', { localDate: '2026-10-20', minute: 900 }, new Set()), { ok: true, value: { add: ['2026-10-22', '2026-10-27'] } });
  });

  it('rejects invalid end dates and rules above the creation limits', () => {
    const rule = { startDate: '2026-10-13', endDate: '2026-11-12', weekdays: [2, 4], frequency: 'weekly' as const, startMinute: 900 };
    assert.deepEqual(planSeriesEnd(rule, '2026-13-01', NOW, new Set()), { ok: false, error: 'endDateFormat' });
    assert.deepEqual(planSeriesEnd(rule, '2026-10-12', NOW, new Set()), { ok: false, error: 'endBeforeStart' });
    assert.deepEqual(planSeriesEnd(rule, '2027-10-20', NOW, new Set()), { ok: false, error: 'spanTooLong' });
    const daily = { ...rule, weekdays: [0, 1, 2, 3, 4, 5, 6] };
    assert.deepEqual(planSeriesEnd(daily, '2027-10-10', NOW, new Set()), { ok: false, error: 'tooMany' });
  });
});

describe('editing all occurrences of a series', () => {
  it('changes only future untouched occurrences and the series template', async () => {
    const seriesId = await createSeries();
    const lessons = await touchSome();
    const first = lessons.get('2026-10-13');
    assert.ok(first);
    const targets = await listSeriesEditTargets(db, seriesId, first.id, NOW);
    assert.deepEqual(targets.map((row) => row.localDate), ['2026-10-20', '2026-11-10', '2026-11-12']);

    const before = await byDate();
    const result = await updateLesson(db, first.id, update(first, { startMinute: 960, durationMinutes: 60, teacher: 'Rui', plannedContent: 'Novo plano' }), { scope: 'all', now: NOW });
    assert.equal(result.seriesUpdated, 3);
    const after = await byDate();
    for (const date of ['2026-10-13', '2026-10-20', '2026-11-10', '2026-11-12']) {
      const lesson = after.get(date);
      assert.deepEqual([lesson?.startMinute, lesson?.durationMinutes, lesson?.teacher, lesson?.plannedContent, lesson?.seriesException], [960, 60, 'Rui', 'Novo plano', false], date);
    }
    // Past, recorded, cancelled, individually edited and studied occurrences keep everything.
    for (const date of ['2026-10-15', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05']) {
      assert.deepEqual(after.get(date), before.get(date), date);
    }
    assert.equal(after.get('2026-10-29')?.seriesException, true);
    assert.equal(after.get('2026-11-03')?.seriesException, false);
    const series = await getSeries(db, seriesId);
    assert.deepEqual([series?.startMinute, series?.durationMinutes, series?.teacher, series?.plannedContent], [960, 60, 'Rui', 'Novo plano']);
    // Updated occurrences stay searchable by their new text.
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM lessons WHERE search_text LIKE '%novo plano%'").get()?.n, 4);
  });

  it('does not touch a lesson that already started today', async () => {
    const seriesId = await createSeries();
    const lessons = await byDate();
    const first = lessons.get('2026-10-13');
    assert.ok(first);
    const lateToday: Moment = { localDate: '2026-10-20', minute: 900 };
    const targets = await listSeriesEditTargets(db, seriesId, first.id, lateToday);
    assert.equal(targets[0].localDate, '2026-10-22');
    await updateLesson(db, first.id, update(first, { startMinute: 990 }), { scope: 'all', now: lateToday });
    assert.equal((await getLesson(db, lessons.get('2026-10-20')!.id))?.startMinute, 900);
  });

  it('keeps "this occurrence" edits local and flags them', async () => {
    await createSeries();
    const lessons = await byDate();
    const target = lessons.get('2026-11-05')!;
    const result = await updateLesson(db, target.id, update(target, { startMinute: 1000 }));
    assert.equal(result.seriesUpdated, 0);
    const after = await byDate();
    assert.equal(after.get('2026-11-05')?.seriesException, true);
    assert.equal(after.get('2026-11-10')?.startMinute, 900);
  });
});

describe('changing the series end date', () => {
  it('extends idempotently and shortens only untouched future occurrences', async () => {
    const seriesId = await createSeries();
    await touchSome();
    const first = (await byDate()).get('2026-10-13')!;
    await updateLesson(db, first.id, update(first, { startMinute: 960, teacher: 'Rui', plannedContent: 'Novo plano' }), { scope: 'all', now: NOW });

    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-11-26', { now: NOW, dryRun: true }), { ok: true, value: { added: 4, removed: 0, seriesDeleted: false } });
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons').get()?.n, 10); // dry run wrote nothing
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-11-26', { now: NOW }), { ok: true, value: { added: 4, removed: 0, seriesDeleted: false } });
    const extended = await byDate();
    for (const date of ['2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26']) {
      const lesson = extended.get(date);
      assert.deepEqual([lesson?.startMinute, lesson?.teacher, lesson?.plannedContent, lesson?.seriesId], [960, 'Rui', 'Novo plano', seriesId], date);
    }
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-11-26', { now: NOW }), { ok: true, value: { added: 0, removed: 0, seriesDeleted: false } });
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons').get()?.n, 14);

    // Shorten to 28 Oct: edited 29 Oct, studied 3 Nov and 5 Nov (next step) stay; 6 untouched go.
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-10-28', { now: NOW, dryRun: true }), { ok: true, value: { added: 0, removed: 6, seriesDeleted: false } });
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-10-28', { now: NOW }), { ok: true, value: { added: 0, removed: 6, seriesDeleted: false } });
    assert.deepEqual([...(await byDate()).keys()], ['2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05']);
    assert.equal((await getSeries(db, seriesId))?.endDate, '2026-10-28');

    // Extending again recreates only the missing dates (29 Oct, 3 and 5 Nov still exist).
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-11-12', { now: NOW }), { ok: true, value: { added: 2, removed: 0, seriesDeleted: false } });
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons WHERE series_id = ?').get(seriesId)?.n, 10);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM lessons WHERE original_local_date = '2026-10-29'").get()?.n, 1);
  });

  it('never removes past occurrences, reports errors and rolls back on failure', async () => {
    const seriesId = await createSeries();
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-10-14', { now: NOW }), { ok: true, value: { added: 0, removed: 8, seriesDeleted: false } });
    assert.deepEqual([...(await byDate()).keys()], ['2026-10-13', '2026-10-15']); // 15 Oct is in the past, kept
    assert.deepEqual(await changeSeriesEnd(db, seriesId, '2026-10-01', { now: NOW }), { ok: false, error: 'endBeforeStart' });
    assert.deepEqual(await changeSeriesEnd(db, 999, '2026-10-30', { now: NOW }), { ok: false, error: 'notFound' });

    raw.exec("CREATE TRIGGER fail_extend BEFORE INSERT ON lessons WHEN NEW.local_date = '2026-10-29' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
    await assert.rejects(changeSeriesEnd(db, seriesId, '2026-11-05', { now: NOW }), /injected/);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lessons').get()?.n, 2);
    assert.equal((await getSeries(db, seriesId))?.endDate, '2026-10-14');
  });
});
