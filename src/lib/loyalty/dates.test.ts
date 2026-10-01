import { describe, expect, it } from 'vitest';

import { addMonthsLocal, localDaysBetween, zonedTimeToUtc } from './dates';

describe('zonedTimeToUtc', () => {
  it('converts IST wall time', () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 2 },
        10,
        0,
        0,
        'Asia/Kolkata'
      ).toISOString()
    ).toBe('2026-10-02T04:30:00.000Z');
  });
  it('handles DST zones', () => {
    // 10:00 in New York on a summer day is 14:00 UTC, in winter 15:00 UTC.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 7, day: 1 },
        10,
        0,
        0,
        'America/New_York'
      ).toISOString()
    ).toBe('2026-07-01T14:00:00.000Z');
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 1 },
        10,
        0,
        0,
        'America/New_York'
      ).toISOString()
    ).toBe('2026-01-01T15:00:00.000Z');
  });
});

describe('addMonthsLocal', () => {
  it('rolls over years and clamps month ends', () => {
    expect(addMonthsLocal({ year: 2026, month: 11, day: 15 }, 3)).toEqual({
      year: 2027,
      month: 2,
      day: 15,
    });
    expect(addMonthsLocal({ year: 2027, month: 11, day: 30 }, 3)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
    expect(addMonthsLocal({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});

describe('localDaysBetween', () => {
  it('counts calendar days in the store timezone', () => {
    expect(
      localDaysBetween(
        new Date('2026-10-01T04:30:00Z'),
        new Date('2026-10-08T18:29:00Z'),
        'Asia/Kolkata'
      )
    ).toBe(7);
  });
});
