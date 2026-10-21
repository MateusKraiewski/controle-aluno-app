import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../db/migrations';
import { openTestDatabase } from '../../testing/nodeSqlite';
import { generateOccurrences } from '../lessons/domain';
import { cancelLessons, changeSeriesEnd, createLesson, createLessonSeries, deleteLessons, updateAttendance, updateLesson } from '../lessons/repository';
import { listSubjects } from '../subjects/repository';
import { MAX_OBJECTIVE_TITLE, REVIEW_AFTER_DAYS, computeReviewSuggestions, normalizeObjectiveTitle } from './domain';
import type { ReviewCandidate } from './domain';
import {
  MAX_OBJECTIVES_PER_SUBJECT, createObjective, dismissReviewSuggestion, listLessonObjectives, listObjectives, listReviewCandidates,
  renameObjective, setLessonObjectiveTag, setObjectiveStatus,
} from './repository';

describe('objective title', () => {
  it('trims, collapses whitespace and enforces 1–200 characters', () => {
    assert.deepEqual(normalizeObjectiveTitle('  Leis   de\nNewton '), { ok: true, value: 'Leis de Newton' });
    assert.deepEqual(normalizeObjectiveTitle(' \n '), { ok: false, error: 'titleRequired' });
    assert.equal(normalizeObjectiveTitle('x'.repeat(MAX_OBJECTIVE_TITLE)).ok, true);
    assert.deepEqual(normalizeObjectiveTitle('x'.repeat(MAX_OBJECTIVE_TITLE + 1)), { ok: false, error: 'titleTooLong' });
  });
});

describe('review suggestions rule', () => {
  const base: ReviewCandidate = {
    objectiveId: 1, subjectId: 1, subject: 'Física', title: 'Leis de Newton', status: 'open',
    createdDate: '2026-09-01', lastWorkedDate: '2026-09-30', dismissedBasis: null,
  };
  const today = '2026-10-21';

  it('suggests reviewing an objective not worked on for 21+ days, citing the last lesson date', () => {
    assert.deepEqual(computeReviewSuggestions([base], today), [{
      objectiveId: 1, subjectId: 1, subject: 'Física', title: 'Leis de Newton', kind: 'notReviewed', basisDate: '2026-09-30', days: 21, weeks: 3,
    }]);
  });

  it('stays silent below the threshold, for done objectives and for an invalid today', () => {
    assert.deepEqual(computeReviewSuggestions([{ ...base, lastWorkedDate: '2026-10-01' }], today), []); // 20 days
    assert.deepEqual(computeReviewSuggestions([{ ...base, status: 'done' }], today), []);
    assert.deepEqual(computeReviewSuggestions([base], '2026-13-01'), []);
    assert.equal(computeReviewSuggestions([{ ...base, status: 'practising' }], today).length, 1);
  });

  it('uses the creation date when the objective was never worked on', () => {
    const [suggestion] = computeReviewSuggestions([{ ...base, lastWorkedDate: null, createdDate: '2026-09-09' }], today);
    assert.equal(suggestion.kind, 'neverWorked');
    assert.equal(suggestion.basisDate, '2026-09-09');
    assert.equal(suggestion.weeks, 6);
    assert.deepEqual(computeReviewSuggestions([{ ...base, lastWorkedDate: null, createdDate: '2026-10-15' }], today), []);
    // A future "last worked" date (clock change) is ignored rather than trusted.
    assert.equal(computeReviewSuggestions([{ ...base, lastWorkedDate: '2026-12-01', createdDate: '2026-09-01' }], today)[0].kind, 'neverWorked');
  });

  it('hides a dismissed suggestion only while its basis is unchanged', () => {
    assert.deepEqual(computeReviewSuggestions([{ ...base, dismissedBasis: '2026-09-30' }], today), []);
    assert.equal(computeReviewSuggestions([{ ...base, dismissedBasis: '2026-09-01' }], today).length, 1);
  });

  it('orders by oldest basis, then id, and applies threshold and limit options', () => {
    const candidates: ReviewCandidate[] = [
      { ...base, objectiveId: 3, lastWorkedDate: '2026-08-01' },
      { ...base, objectiveId: 2, lastWorkedDate: '2026-09-01' },
      { ...base, objectiveId: 1, lastWorkedDate: '2026-08-01' },
    ];
    assert.deepEqual(computeReviewSuggestions(candidates, today).map((item) => item.objectiveId), [1, 3, 2]);
    assert.deepEqual(computeReviewSuggestions(candidates, today, { limit: 2 }).map((item) => item.objectiveId), [1, 3]);
    assert.equal(computeReviewSuggestions(candidates, today, { thresholdDays: 60 }).length, 2);
    assert.equal(REVIEW_AFTER_DAYS, 21);
  });
});

describe('objectives repository', () => {
  let db: SQLiteDatabase;
  let raw: DatabaseSync;
  const lesson = (overrides: Partial<Parameters<typeof createLesson>[1]> = {}) => ({
    subject: 'Física', teacher: null, localDate: '2026-09-30', startMinute: 600, durationMinutes: 50, plannedContent: null, ...overrides,
  });

  beforeEach(async () => {
    ({ db, raw } = openTestDatabase());
    await migrate(db);
  });

  async function subjectId(name: string): Promise<number> {
    const found = (await listSubjects(db, { includeArchived: true })).find((item) => item.name === name);
    assert.ok(found);
    return found.id;
  }

  it('creates, renames and changes status with bound parameters and validation', async () => {
    await createLesson(db, lesson());
    const fisica = await subjectId('Física');
    const created = await createObjective(db, fisica, "  Vetores d'água; DROP TABLE subjects; -- ");
    assert.ok(created.ok);
    assert.equal(raw.prepare('SELECT title FROM learning_objectives').get()?.title, "Vetores d'água; DROP TABLE subjects; --");
    assert.deepEqual(await createObjective(db, fisica, '   '), { ok: false, error: 'titleRequired' });
    assert.deepEqual(await createObjective(db, 999, 'x'), { ok: false, error: 'subjectNotFound' });
    assert.deepEqual(await renameObjective(db, created.value, 'Vetores'), { ok: true, value: true });
    assert.deepEqual(await renameObjective(db, 999, 'Vetores'), { ok: true, value: false });
    assert.equal(await setObjectiveStatus(db, created.value, 'practising'), true);
    await assert.rejects(setObjectiveStatus(db, created.value, 'mastered' as never), RangeError);
    const [stored] = await listObjectives(db, fisica, { includeDone: false });
    assert.deepEqual([stored.title, stored.status, stored.lastWorkedDate, stored.lessonCount], ['Vetores', 'practising', null, 0]);
    assert.ok(stored.updatedAt >= stored.createdAt);
    assert.equal((await listSubjects(db, { includeArchived: false }))[0].activeObjectives, 1);
    await setObjectiveStatus(db, created.value, 'done');
    assert.deepEqual(await listObjectives(db, fisica, { includeDone: false }), []);
    assert.equal((await listObjectives(db, fisica, { includeDone: true })).length, 1);
    assert.equal((await listSubjects(db, { includeArchived: false }))[0].activeObjectives, 0);
  });

  it('orders practising, open, done and caps objectives per subject', async () => {
    await createLesson(db, lesson());
    const fisica = await subjectId('Física');
    const ids: number[] = [];
    for (const title of ['A', 'B', 'C']) {
      const result = await createObjective(db, fisica, title);
      assert.ok(result.ok);
      ids.push(result.value);
    }
    await setObjectiveStatus(db, ids[0], 'done');
    await setObjectiveStatus(db, ids[2], 'practising');
    assert.deepEqual((await listObjectives(db, fisica, { includeDone: true })).map((item) => item.title), ['C', 'B', 'A']);
    const insert = raw.prepare("INSERT INTO learning_objectives (subject_id, title, created_at, updated_at) VALUES (?, 'x', 1, 1)");
    for (let index = 3; index < MAX_OBJECTIVES_PER_SUBJECT; index += 1) insert.run(fisica);
    assert.deepEqual(await createObjective(db, fisica, 'one too many'), { ok: false, error: 'tooMany' });
    assert.equal((await listObjectives(db, fisica, { includeDone: true })).length, MAX_OBJECTIVES_PER_SUBJECT);
  });

  it('tags lessons only with objectives of the same subject and tracks the last worked date', async () => {
    const past = await createLesson(db, lesson({ localDate: '2026-09-30' }));
    const older = await createLesson(db, lesson({ localDate: '2026-09-10' }));
    const future = await createLesson(db, lesson({ localDate: '2026-11-05' }));
    const absent = await createLesson(db, lesson({ localDate: '2026-10-10' }));
    const cancelled = await createLesson(db, lesson({ localDate: '2026-10-12' }));
    const other = await createLesson(db, lesson({ subject: 'Química', localDate: '2026-10-15' }));
    const fisica = await subjectId('Física');
    const objective = await createObjective(db, fisica, 'Leis de Newton');
    assert.ok(objective.ok);
    for (const id of [past, older, future, absent, cancelled]) assert.equal(await setLessonObjectiveTag(db, id, objective.value, true), true);
    assert.equal(await setLessonObjectiveTag(db, past, objective.value, true), true); // idempotent
    assert.equal(await setLessonObjectiveTag(db, other, objective.value, true), false); // other subject refused
    await updateAttendance(db, absent, 'absent');
    await cancelLessons(db, cancelled, 'this', null);
    const [stored] = await listObjectives(db, fisica, { includeDone: false, today: '2026-10-21' });
    // Future, absent and cancelled lessons do not count as worked on.
    assert.deepEqual([stored.lastWorkedDate, stored.lessonCount], ['2026-09-30', 5]);

    const options = await listLessonObjectives(db, past);
    assert.deepEqual(options, [{ id: objective.value, title: 'Leis de Newton', status: 'open', tagged: true }]);
    assert.deepEqual(await listLessonObjectives(db, other), []);
    await setObjectiveStatus(db, objective.value, 'done');
    assert.equal((await listLessonObjectives(db, past)).length, 1); // done but tagged stays visible
    const untagged = await createLesson(db, lesson({ localDate: '2026-10-01' }));
    assert.deepEqual(await listLessonObjectives(db, untagged), []);

    assert.equal(await setLessonObjectiveTag(db, past, objective.value, false), true);
    assert.equal((await listObjectives(db, fisica, { includeDone: true, today: '2026-10-21' }))[0].lastWorkedDate, '2026-09-10');
    // Deleting a lesson drops only its tags.
    await deleteLessons(db, older, 'this');
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM learning_objectives').get()?.n, 1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lesson_objectives WHERE lesson_id = ?').get(older)?.n, 0);
  });

  it('drops tags of the old subject when a lesson moves to another subject', async () => {
    const id = await createLesson(db, lesson());
    const objective = await createObjective(db, await subjectId('Física'), 'Ótica');
    assert.ok(objective.ok);
    await setLessonObjectiveTag(db, id, objective.value, true);
    await updateLesson(db, id, { ...lesson(), studiedContent: null, privateNotes: null, nextStep: null });
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lesson_objectives').get()?.n, 1); // same subject keeps it
    await updateLesson(db, id, { ...lesson({ subject: 'Química' }), studiedContent: null, privateNotes: null, nextStep: null });
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM lesson_objectives').get()?.n, 0);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM learning_objectives').get()?.n, 1);
  });

  it('treats a tagged future occurrence as recorded in series-wide changes', async () => {
    const generated = generateOccurrences({ startDate: '2026-11-02', endDate: '2026-11-30', weekdays: [1], frequency: 'weekly' });
    assert.ok(generated.ok);
    await createLessonSeries(db, { ...lesson({ localDate: '2026-11-02' }), frequency: 'weekly', weekdays: [1], endDate: '2026-11-30', dates: generated.value.dates });
    const rows = raw.prepare('SELECT id, local_date FROM lessons ORDER BY local_date').all() as { id: number; local_date: string }[];
    const objective = await createObjective(db, await subjectId('Física'), 'Ótica');
    assert.ok(objective.ok);
    const tagged = rows.find((row) => row.local_date === '2026-11-23');
    assert.ok(tagged);
    await setLessonObjectiveTag(db, tagged.id, objective.value, true);
    const result = await changeSeriesEnd(db, 1, '2026-11-09', { now: { localDate: '2026-10-21', minute: 0 } });
    assert.ok(result.ok);
    assert.equal(result.value.removed, 2); // 16 and 30; the tagged 23rd stays
    assert.deepEqual((raw.prepare('SELECT local_date FROM lessons ORDER BY local_date').all() as { local_date: string }[]).map((row) => row.local_date),
      ['2026-11-02', '2026-11-09', '2026-11-23']);
  });

  it('feeds the review rule from stored dates and remembers dismissals', async () => {
    const worked = await createLesson(db, lesson({ localDate: '2026-09-30' }));
    await createLesson(db, lesson({ subject: 'História', localDate: '2026-09-01' }));
    const fisica = await subjectId('Física');
    const newton = await createObjective(db, fisica, 'Leis de Newton');
    const done = await createObjective(db, fisica, 'Concluído');
    const historia = await createObjective(db, await subjectId('História'), 'Revolução');
    assert.ok(newton.ok && done.ok && historia.ok);
    await setLessonObjectiveTag(db, worked, newton.value, true);
    await setObjectiveStatus(db, done.value, 'done');
    raw.exec("UPDATE subjects SET archived_at = 1 WHERE name = 'História'"); // archived subjects are not suggested

    const candidates = await listReviewCandidates(db, '2026-10-21');
    assert.deepEqual(candidates.map((item) => [item.title, item.lastWorkedDate, item.dismissedBasis]), [['Leis de Newton', '2026-09-30', null]]);
    const [suggestion] = computeReviewSuggestions(candidates, '2026-10-21');
    assert.deepEqual([suggestion.kind, suggestion.basisDate, suggestion.weeks, suggestion.subject], ['notReviewed', '2026-09-30', 3, 'Física']);

    assert.equal(await dismissReviewSuggestion(db, newton.value, suggestion.basisDate), true);
    await assert.rejects(dismissReviewSuggestion(db, newton.value, '30/09/2026'), RangeError);
    assert.deepEqual(computeReviewSuggestions(await listReviewCandidates(db, '2026-10-21'), '2026-10-21'), []);
    // Worked on again later, then stale again: a new suggestion with the new basis.
    const again = await createLesson(db, lesson({ localDate: '2026-10-05' }));
    await setLessonObjectiveTag(db, again, newton.value, true);
    assert.deepEqual(computeReviewSuggestions(await listReviewCandidates(db, '2026-10-26'), '2026-10-26').map((item) => item.basisDate), ['2026-10-05']);
    await assert.rejects(listReviewCandidates(db, 'ontem'), RangeError);
  });
});
