import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { validateDateRange } from './domain';
import { cancelLessonsInRange, countBreakTargets, createLesson, getLesson, restoreLesson, updateAttendance, updateLesson } from './repository';

let db: SQLiteDatabase;

beforeEach(async () => {
  ({ db } = openTestDatabase());
  await migrate(db);
});

const lesson = (localDate: string, startMinute = 600) => ({ subject: 'Física', teacher: null, localDate, startMinute, durationMinutes: 50, plannedContent: null });

describe('date ranges', () => {
  it('validates required and open ranges', () => {
    assert.deepEqual(validateDateRange('2026-12-21', '2027-01-02', { required: true, maxDays: 366 }), { ok: true, value: { from: '2026-12-21', to: '2027-01-02' } });
    assert.deepEqual(validateDateRange('', '2027-01-02', { required: true }), { ok: false, error: 'fromInvalid' });
    assert.deepEqual(validateDateRange('2026-12-21', '2027-02-30', { required: true }), { ok: false, error: 'toInvalid' });
    assert.deepEqual(validateDateRange('2027-01-02', '2026-12-21', { required: true }), { ok: false, error: 'rangeReversed' });
    assert.deepEqual(validateDateRange('2026-01-01', '2027-01-03', { required: true, maxDays: 366 }), { ok: false, error: 'rangeTooLong' });
    assert.deepEqual(validateDateRange(' ', '', { required: false }), { ok: true, value: { from: null, to: null } });
    assert.deepEqual(validateDateRange('2026-10-01', '', { required: false }), { ok: true, value: { from: '2026-10-01', to: null } });
    assert.deepEqual(validateDateRange('', 'ontem', { required: false }), { ok: false, error: 'toInvalid' });
  });
});

describe('holiday or break', () => {
  it('cancels only planned, unrecorded lessons in the inclusive range, with the reason', async () => {
    const before = await createLesson(db, lesson('2026-12-20'));
    const first = await createLesson(db, lesson('2026-12-21'));
    const second = await createLesson(db, lesson('2026-12-21', 900));
    const attended = await createLesson(db, lesson('2026-12-22'));
    await updateAttendance(db, attended, 'attended');
    const studied = await createLesson(db, lesson('2026-12-23'));
    await updateLesson(db, studied, { ...lesson('2026-12-23'), studiedContent: 'Revisão' });
    const absent = await createLesson(db, lesson('2026-12-29'));
    await updateAttendance(db, absent, 'absent');
    const last = await createLesson(db, lesson('2027-01-02'));
    const after = await createLesson(db, lesson('2027-01-03'));

    assert.equal(await countBreakTargets(db, '2026-12-21', '2027-01-02'), 3);
    assert.equal(await cancelLessonsInRange(db, '2026-12-21', '2027-01-02', 'Férias de Natal'), 3);
    for (const id of [first, second, last]) {
      const row = await getLesson(db, id);
      assert.deepEqual([row?.status, row?.cancelReason, row?.attendance], ['cancelled', 'Férias de Natal', 'unmarked']);
    }
    // Recorded lessons and lessons outside the range are untouched; nothing became an absence.
    assert.equal((await getLesson(db, attended))?.attendance, 'attended');
    assert.equal((await getLesson(db, absent))?.attendance, 'absent');
    for (const id of [before, attended, studied, absent, after]) assert.equal((await getLesson(db, id))?.status, 'planned');
    // Repeating the break finds nothing new; a cancelled lesson can be reactivated.
    assert.equal(await countBreakTargets(db, '2026-12-21', '2027-01-02'), 0);
    await restoreLesson(db, first);
    assert.equal((await getLesson(db, first))?.status, 'planned');
    assert.equal(await cancelLessonsInRange(db, '2026-12-21', '2026-12-21', null), 1);
    assert.equal((await getLesson(db, first))?.cancelReason, null);
  });
});
