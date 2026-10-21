import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { addMonths, monthGrid } from './domain';
import { cancelLessons, countLessonsByDay, createLesson } from './repository';

describe('monthly overview', () => {
  it('moves between months across years', () => {
    assert.equal(addMonths('2026-10-20', 0), '2026-10-01');
    assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
    assert.equal(addMonths('2026-01-15', -1), '2025-12-01');
    assert.equal(addMonths('2026-10-20', -22), '2024-12-01');
  });

  it('builds whole Monday-first weeks covering the month', () => {
    const october = monthGrid('2026-10-20');
    assert.deepEqual([october.month, october.from, october.to, october.days.length], ['2026-10-01', '2026-09-28', '2026-11-02', 35]);
    const february = monthGrid('2027-02-10'); // starts on a Monday, 28 days
    assert.deepEqual([february.from, february.to, february.days.length], ['2027-02-01', '2027-03-01', 28]);
    const august = monthGrid('2026-08-01'); // Saturday start: six rows
    assert.equal(august.days.length, 42);
    assert.equal(august.days[0], '2026-07-27');
    assert.equal(august.days[41], '2026-09-06');
  });

  it('counts planned and cancelled lessons per day in the grid range', async () => {
    const { db } = openTestDatabase();
    await migrate(db);
    const lesson = (localDate: string, startMinute: number) => ({ subject: 'Física', teacher: null, localDate, startMinute, durationMinutes: 50, plannedContent: null });
    await createLesson(db, lesson('2026-09-28', 600));
    await createLesson(db, lesson('2026-10-20', 600));
    await createLesson(db, lesson('2026-10-20', 900));
    const cancelled = await createLesson(db, lesson('2026-10-20', 1000));
    await cancelLessons(db, cancelled, 'this', null);
    await createLesson(db, lesson('2026-11-02', 600)); // first day after the grid
    const { from, to } = monthGrid('2026-10-01');
    assert.deepEqual(await countLessonsByDay(db, from, to), [
      { localDate: '2026-09-28', planned: 1, cancelled: 0 },
      { localDate: '2026-10-20', planned: 2, cancelled: 1 },
    ]);
  });
});
