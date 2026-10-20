import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, escapeLike, findConflicts, findSeriesConflicts, formatTemplate, formatTime, generateOccurrences,
  isValidLocalDate, parseDuration, parseTime, startOfWeek, toLocalDate, toSearchPattern, validateLessonDraft,
  weekRange, weekdayOf,
} from './domain';

describe('dates', () => {
  it('validates real calendar dates only', () => {
    assert.equal(isValidLocalDate('2026-10-20'), true);
    assert.equal(isValidLocalDate('2028-02-29'), true);
    assert.equal(isValidLocalDate('2026-02-29'), false);
    assert.equal(isValidLocalDate('2026-13-01'), false);
    assert.equal(isValidLocalDate('2026-1-01'), false);
    assert.equal(isValidLocalDate('20/10/2026'), false);
  });

  it('formats a local Date without UTC shifts', () => {
    assert.equal(toLocalDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });

  it('adds days across month, year and DST boundaries', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('computes Monday-based weeks', () => {
    assert.equal(weekdayOf('2026-10-20'), 2); // Tuesday
    assert.equal(startOfWeek('2026-10-20'), '2026-10-19');
    assert.equal(startOfWeek('2026-10-25'), '2026-10-19'); // Sunday belongs to the previous Monday
    assert.equal(startOfWeek('2026-10-19'), '2026-10-19');
    assert.deepEqual(weekRange('2026-10-20'), { from: '2026-10-19', to: '2026-10-26' });
  });
});

describe('time and duration', () => {
  it('parses and formats times', () => {
    assert.equal(parseTime('15:00'), 900);
    assert.equal(parseTime('9:05'), 545);
    assert.equal(parseTime('09h30'), 570);
    assert.equal(parseTime('24:00'), null);
    assert.equal(parseTime('12:60'), null);
    assert.equal(parseTime('noon'), null);
    assert.equal(formatTime(545), '09:05');
    assert.equal(formatTime(0), '00:00');
    assert.equal(formatTime(1439), '23:59');
  });

  it('accepts durations from 5 to 480 minutes', () => {
    assert.equal(parseDuration('60'), 60);
    assert.equal(parseDuration('5'), 5);
    assert.equal(parseDuration('480'), 480);
    assert.equal(parseDuration('4'), null);
    assert.equal(parseDuration('481'), null);
    assert.equal(parseDuration('1.5'), null);
    assert.equal(parseDuration(''), null);
  });
});

describe('validateLessonDraft', () => {
  const base = { subject: '  Matemática  ', teacher: '', localDate: '2026-10-20', time: '15:00', duration: '60', plannedContent: '  ' };

  it('normalises a valid draft', () => {
    const result = validateLessonDraft(base);
    assert.deepEqual(result, { ok: true, value: { subject: 'Matemática', teacher: null, localDate: '2026-10-20', startMinute: 900, durationMinutes: 60, plannedContent: null, studiedContent: null } });
  });

  it('reports the first invalid field', () => {
    assert.deepEqual(validateLessonDraft({ ...base, subject: ' ' }), { ok: false, error: 'subjectRequired' });
    assert.deepEqual(validateLessonDraft({ ...base, localDate: '20-10-2026' }), { ok: false, error: 'dateFormat' });
    assert.deepEqual(validateLessonDraft({ ...base, localDate: '2026-02-30' }), { ok: false, error: 'dateInvalid' });
    assert.deepEqual(validateLessonDraft({ ...base, time: '25:00' }), { ok: false, error: 'time' });
    assert.deepEqual(validateLessonDraft({ ...base, duration: '1000' }), { ok: false, error: 'duration' });
    assert.deepEqual(validateLessonDraft({ ...base, plannedContent: 'x'.repeat(2001) }), { ok: false, error: 'textTooLong' });
  });

  it('keeps quotes and accents literal', () => {
    const result = validateLessonDraft({ ...base, subject: "D'Artagnan's 'História'", studiedContent: ' 50% _feito_ ' });
    assert.equal(result.ok && result.value.subject, "D'Artagnan's 'História'");
    assert.equal(result.ok && result.value.studiedContent, '50% _feito_');
  });
});

describe('generateOccurrences', () => {
  it('expands weekly rules on the selected weekdays, inclusive', () => {
    const result = generateOccurrences({ startDate: '2026-10-19', endDate: '2026-11-02', weekdays: [1, 3], frequency: 'weekly' });
    assert.deepEqual(result, { ok: true, value: { dates: ['2026-10-19', '2026-10-21', '2026-10-26', '2026-10-28', '2026-11-02'], truncated: false } });
  });

  it('skips the start date when its weekday is not selected', () => {
    const result = generateOccurrences({ startDate: '2026-10-20', endDate: '2026-10-27', weekdays: [1], frequency: 'weekly' });
    assert.deepEqual(result.ok && result.value.dates, ['2026-10-26']);
  });

  it('expands biweekly rules every other Monday-based week', () => {
    // Start on a Wednesday: weeks of 19 Oct (0), 26 Oct (1, skipped), 2 Nov (2).
    const result = generateOccurrences({ startDate: '2026-10-21', endDate: '2026-11-08', weekdays: [1, 3, 5], frequency: 'biweekly' });
    assert.deepEqual(result.ok && result.value.dates, ['2026-10-21', '2026-10-23', '2026-11-02', '2026-11-04', '2026-11-06']);
  });

  it('caps the expansion at 300 and reports truncation', () => {
    const result = generateOccurrences({ startDate: '2026-01-01', endDate: '2026-12-31', weekdays: [0, 1, 2, 3, 4, 5, 6], frequency: 'weekly' });
    assert.equal(result.ok && result.value.dates.length, 300);
    assert.equal(result.ok && result.value.truncated, true);
  });

  it('rejects invalid ranges and empty rules', () => {
    assert.deepEqual(generateOccurrences({ startDate: '2026-10-20', endDate: '2026-10-19', weekdays: [1], frequency: 'weekly' }), { ok: false, error: 'endBeforeStart' });
    assert.deepEqual(generateOccurrences({ startDate: '2026-10-20', endDate: '2027-10-22', weekdays: [1], frequency: 'weekly' }), { ok: false, error: 'spanTooLong' });
    assert.deepEqual(generateOccurrences({ startDate: '2026-10-20', endDate: 'x', weekdays: [1], frequency: 'weekly' }), { ok: false, error: 'endDateFormat' });
    assert.deepEqual(generateOccurrences({ startDate: '2026-10-20', endDate: '2026-10-30', weekdays: [], frequency: 'weekly' }), { ok: false, error: 'noWeekdays' });
    assert.deepEqual(generateOccurrences({ startDate: '2026-10-20', endDate: '2026-10-21', weekdays: [5], frequency: 'weekly' }), { ok: false, error: 'noOccurrences' });
  });
});

describe('conflicts', () => {
  const existing = [
    { id: 1, localDate: '2026-10-20', startMinute: 900, durationMinutes: 60, status: 'planned' as const },
    { id: 2, localDate: '2026-10-20', startMinute: 1000, durationMinutes: 30, status: 'cancelled' as const },
    { id: 3, localDate: '2026-10-21', startMinute: 900, durationMinutes: 60, status: 'planned' as const },
  ];

  it('detects same-day overlap only', () => {
    assert.deepEqual(findConflicts({ localDate: '2026-10-20', startMinute: 930, durationMinutes: 60 }, existing).map((s) => s.id), [1]);
    assert.deepEqual(findConflicts({ localDate: '2026-10-20', startMinute: 960, durationMinutes: 60 }, existing), []); // touching ends
    assert.deepEqual(findConflicts({ localDate: '2026-10-20', startMinute: 840, durationMinutes: 60 }, existing), []);
  });

  it('ignores cancelled lessons and the lesson being edited', () => {
    assert.deepEqual(findConflicts({ localDate: '2026-10-20', startMinute: 1000, durationMinutes: 10 }, existing), []);
    assert.deepEqual(findConflicts({ id: 1, localDate: '2026-10-20', startMinute: 900, durationMinutes: 60 }, existing), []);
  });

  it('checks every generated date of a series', () => {
    assert.deepEqual(findSeriesConflicts(['2026-10-20', '2026-10-21', '2026-10-22'], 920, 20, existing).map((s) => s.id), [1, 3]);
  });
});

describe('search helpers', () => {
  it('escapes LIKE wildcards', () => {
    assert.equal(escapeLike('50%_a\\b'), '50\\%\\_a\\\\b');
    assert.equal(toSearchPattern('  frações   100% '), '%frações 100\\%%');
    assert.equal(toSearchPattern('   '), null);
    assert.equal(toSearchPattern('x'.repeat(500))?.length, 102);
  });

  it('fills templates', () => {
    assert.equal(formatTemplate('{count} aulas', { count: 3 }), '3 aulas');
    assert.equal(formatTemplate('{missing}', {}), '{missing}');
  });
});
