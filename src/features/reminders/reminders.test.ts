import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrate } from '../../db/migrations';
import { getTranslations } from '../../lib/locales';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { cancelLessonsInRange, createLesson, updateAttendance, updateLesson } from '../lessons/repository';
import { NAG_LEVELS, planReminders, reminderText } from './domain';
import type { ReminderLesson } from './domain';
import { listReminderLessons } from './repository';

const at = (localDate: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return { localDate, minute: h * 60 + m };
};
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const lesson = (id: number, localDate: string, start: string, extra: Partial<ReminderLesson> = {}): ReminderLesson => ({
  id, subject: `S${id}`, localDate, startMinute: at(localDate, start).minute, durationMinutes: 50,
  status: 'planned', attendance: 'unmarked', hasNotes: false, ...extra,
});
const when = (reminders: ReturnType<typeof planReminders>) => reminders.map((r) => `${r.at.localDate} ${hhmm(r.at.minute)} L${r.level}`);

// 2026-11-18 is a Wednesday; 2026-11-21 a Saturday.
describe('reminder planning', () => {
  it('escalates after a lesson ends, skipping the night and stopping after the last level', () => {
    const plan = planReminders([lesson(1, '2026-11-18', '10:00')], at('2026-11-18', '08:00'));
    assert.deepEqual(when(plan), [
      '2026-11-18 10:50 L0', '2026-11-18 11:35 L1', '2026-11-18 12:50 L2', '2026-11-18 14:50 L3',
      '2026-11-18 18:50 L4', '2026-11-19 10:50 L5', '2026-11-20 10:50 L6',
    ]);
    assert.equal(plan.length, NAG_LEVELS);
  });

  it('never nags during another lesson and merges with that lesson\'s end', () => {
    const plan = planReminders([lesson(1, '2026-11-18', '08:00'), lesson(2, '2026-11-18', '09:00', { durationMinutes: 90 })], at('2026-11-18', '07:00'));
    // Lesson 1 ends 08:50; +45 = 09:35 falls inside lesson 2 → moved to 10:30 and merged with lesson 2's end.
    assert.deepEqual(when(plan).slice(0, 2), ['2026-11-18 08:50 L0', '2026-11-18 10:30 L1']);
    assert.equal(plan[1].lessonId, 1);
    assert.deepEqual(plan[1].lessonIds, [1, 2]);
    assert.equal(plan[1].pendingCount, 2);
  });

  it('moves night reminders to the morning, later at weekends', () => {
    const plan = planReminders([lesson(1, '2026-11-20', '17:00')], at('2026-11-20', '12:00'));
    // Friday 17:50 end: +4h = 21:50 and +8h = 01:50 both land on Saturday 09:30 (merged into one).
    assert.deepEqual(when(plan).slice(0, 5), ['2026-11-20 17:50 L0', '2026-11-20 18:35 L1', '2026-11-20 19:50 L2', '2026-11-21 09:30 L3', '2026-11-21 17:50 L5']);
  });

  it('skips lessons with notes, cancelled (holiday/break) or marked as missed, and past reminders', () => {
    const lessons = [
      lesson(1, '2026-11-18', '10:00', { hasNotes: true }),
      lesson(2, '2026-11-18', '11:00', { status: 'cancelled' }),
      lesson(3, '2026-11-18', '12:00', { attendance: 'absent' }),
      lesson(4, '2026-11-18', '14:00', { attendance: 'attended' }),
    ];
    const plan = planReminders(lessons, at('2026-11-18', '16:00'));
    assert.ok(plan.every((r) => r.lessonIds.length === 1 && r.lessonId === 4));
    assert.deepEqual(when(plan)[0], '2026-11-18 16:50 L2');
  });

  it('respects the limit', () => {
    const lessons = Array.from({ length: 30 }, (_, i) => lesson(i + 1, `2026-11-${String(18 + Math.floor(i / 6)).padStart(2, '0')}`, `${8 + (i % 6)}:00`));
    assert.equal(planReminders(lessons, at('2026-11-18', '07:00'), 10).length, 10);
  });
});

describe('reminder text', () => {
  it('gets more dramatic and counts the other pending lessons', () => {
    const t = getTranslations('pt-PT');
    assert.equal(reminderText(t, { level: 0, subject: 'Física', pendingCount: 1 }).title, '📝 A aula de Física acabou!');
    const last = reminderText(t, { level: 99, subject: 'Física', pendingCount: 3 });
    assert.equal(last.title, '☠️ Física: o drama final');
    assert.match(last.body, /E há mais 2 aulas à espera\.$/);
    assert.match(reminderText(t, { level: 2, subject: 'Física', pendingCount: 2 }).body, /E há mais 1 aula à espera\.$/);
  });
});

describe('reminder repository', () => {
  let db: SQLiteDatabase;
  beforeEach(async () => {
    ({ db } = openTestDatabase());
    await migrate(db);
  });

  it('reports notes, attendance and holiday cancellations', async () => {
    const base = { teacher: null, durationMinutes: 50, plannedContent: null };
    const a = await createLesson(db, { ...base, subject: 'Física', localDate: '2026-11-18', startMinute: 600 });
    const b = await createLesson(db, { ...base, subject: 'Química', localDate: '2026-11-18', startMinute: 700 });
    const c = await createLesson(db, { ...base, subject: 'História', localDate: '2026-12-01', startMinute: 600 });
    await createLesson(db, { ...base, subject: 'Inglês', localDate: '2026-12-20', startMinute: 600 });
    await updateLesson(db, a, { ...base, subject: 'Física', localDate: '2026-11-18', startMinute: 600, studiedContent: null, privateNotes: '  ', nextStep: 'Rever cap. 3' });
    await updateAttendance(db, b, 'absent');
    await cancelLessonsInRange(db, '2026-12-01', '2026-12-01', 'Feriado');
    const rows = await listReminderLessons(db, '2026-11-18', '2026-12-08');
    assert.deepEqual(rows.map((r) => [r.subject, r.hasNotes, r.attendance, r.status]), [
      ['Física', true, 'unmarked', 'planned'], ['Química', false, 'absent', 'planned'], ['História', false, 'unmarked', 'cancelled'],
    ]);
    assert.equal(planReminders(rows, at('2026-11-18', '07:00')).length, 0);
    void c;
  });
});
