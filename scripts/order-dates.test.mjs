import test from 'node:test';
import assert from 'node:assert/strict';
import { getPacificDate, pacificMidnightToUtc, nextCalendarDate } from '../src/services/orderDates.mjs';

test('UTC midnight does not advance the Pacific order date', () => {
  assert.equal(getPacificDate('2026-11-05T01:00:00Z'), '2026-11-04');
  assert.equal(getPacificDate('2026-11-05T07:59:59Z'), '2026-11-04');
  assert.equal(getPacificDate('2026-11-05T08:00:00Z'), '2026-11-05');
});

test('Pacific filters use DST-aware midnight and exclusive next-day boundaries', () => {
  for (const [date, start, end, hours] of [
    ['2026-11-04','2026-11-04T08:00:00.000Z','2026-11-05T08:00:00.000Z',24],
    ['2026-03-08','2026-03-08T08:00:00.000Z','2026-03-09T07:00:00.000Z',23],
    ['2026-11-01','2026-11-01T07:00:00.000Z','2026-11-02T08:00:00.000Z',25],
    ['2026-12-31','2026-12-31T08:00:00.000Z','2027-01-01T08:00:00.000Z',24],
  ]) {
    const from = pacificMidnightToUtc(date), to = pacificMidnightToUtc(nextCalendarDate(date));
    assert.equal(from.toISOString(), start);
    assert.equal(to.toISOString(), end);
    assert.equal((to-from)/3600000,hours);
    assert.equal(getPacificDate(to.getTime()-1),date);
  }
});
