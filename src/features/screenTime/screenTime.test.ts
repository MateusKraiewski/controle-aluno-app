import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { averageOfPrevious, barRatio, dayBounds, formatDuration, lastDays, totalMs } from './domain';

const labels = { hour: 'h', minute: 'min', lessThanMinute: '< 1 min' };

describe('screen time', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(30_000, labels), '< 1 min');
    assert.equal(formatDuration(45 * 60_000, labels), '45 min');
    assert.equal(formatDuration(125 * 60_000 + 59_000, labels), '2 h 05 min');
  });

  it('builds the week and day bounds', () => {
    assert.deepEqual(lastDays('2026-11-17', 3), ['2026-11-15', '2026-11-16', '2026-11-17']);
    const { start, end } = dayBounds('2026-11-17');
    assert.equal(new Date(start).getDate(), 17);
    assert.equal(new Date(end).getDate(), 18);
    assert.equal(new Date(end).getHours(), 0);
  });

  it('sums apps, averages previous days with use and scales bars', () => {
    assert.equal(totalMs({ unlocks: 0, apps: [{ packageName: 'a', label: 'A', foregroundMs: 1000, opens: 1, lastUsed: 0 }, { packageName: 'b', label: 'B', foregroundMs: 500, opens: 2, lastUsed: 0 }] }), 1500);
    assert.equal(averageOfPrevious([{ localDate: '2026-11-15', ms: 100 }, { localDate: '2026-11-16', ms: 0 }, { localDate: '2026-11-17', ms: 900 }], '2026-11-17'), 100);
    assert.equal(averageOfPrevious([{ localDate: '2026-11-17', ms: 900 }], '2026-11-17'), null);
    assert.equal(barRatio(50, 200), 0.25);
    assert.equal(barRatio(5, 0), 0);
  });
});
