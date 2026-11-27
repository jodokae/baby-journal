import { describe, expect, it } from 'vitest';
import { dayKeyToNoon, dayRangeMs, monthRangeMs, toDayKey } from './dates';

describe('toDayKey', () => {
  it('formats a timestamp as YYYY-MM-DD in local time', () => {
    expect(toDayKey(new Date(2026, 10, 27).getTime())).toBe('2026-11-27');
  });

  it('zero-pads month and day', () => {
    expect(toDayKey(new Date(2026, 0, 5, 9, 30).getTime())).toBe('2026-01-05');
  });

  it('keeps the last millisecond of a day on that day', () => {
    expect(toDayKey(new Date(2026, 10, 27, 23, 59, 59, 999).getTime())).toBe('2026-11-27');
  });

  it('maps the whole DST spring-forward day to one key', () => {
    // 2026-03-29 is the DST change in Europe/Berlin. Both local times exist in
    // every time zone, so this holds regardless of where the tests run.
    expect(toDayKey(new Date(2026, 2, 29, 0, 30).getTime())).toBe('2026-03-29');
    expect(toDayKey(new Date(2026, 2, 29, 23, 30).getTime())).toBe('2026-03-29');
    expect(toDayKey(new Date(2026, 2, 28, 23, 59, 59, 999).getTime())).toBe('2026-03-28');
  });

  it('maps the whole DST fall-back day to one key', () => {
    expect(toDayKey(new Date(2026, 9, 25, 0, 30).getTime())).toBe('2026-10-25');
    expect(toDayKey(new Date(2026, 9, 25, 23, 30).getTime())).toBe('2026-10-25');
  });

  it('handles the year boundary', () => {
    expect(toDayKey(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
    expect(toDayKey(new Date(2027, 0, 1, 0, 0, 0, 0).getTime())).toBe('2027-01-01');
  });
});

describe('dayKeyToNoon', () => {
  it('returns local noon of the given day', () => {
    expect(dayKeyToNoon('2026-11-27')).toBe(new Date(2026, 10, 27, 12).getTime());
  });

  it('stays on the same day key across DST spring-forward and fall-back', () => {
    // 2026-03-29 and 2026-10-25 are the 2026 DST transitions in Europe/Berlin.
    for (const key of ['2026-03-29', '2026-10-25']) {
      expect(toDayKey(dayKeyToNoon(key))).toBe(key);
    }
  });
});

describe('dayRangeMs', () => {
  it('starts at the first millisecond of the day', () => {
    const { start } = dayRangeMs(new Date(2026, 10, 27));
    expect(start).toBe(new Date(2026, 10, 27, 0, 0, 0, 0).getTime());
  });

  it('includes the last millisecond of the day and excludes the first of the next', () => {
    const { start, end } = dayRangeMs(new Date(2026, 10, 27));
    expect(new Date(2026, 10, 27, 23, 59, 59, 999).getTime()).toBeLessThan(end);
    expect(new Date(2026, 10, 27, 23, 59, 59, 999).getTime()).toBeGreaterThanOrEqual(start);
    expect(new Date(2026, 10, 28, 0, 0, 0, 0).getTime()).toBeGreaterThanOrEqual(end);
  });

  it('spans DST transition days fully', () => {
    // Spring-forward (23h) and fall-back (25h) in Europe/Berlin; time zones
    // without DST stay at 24h, so all three lengths are accepted.
    for (const [month, day] of [
      [2, 29],
      [9, 25],
    ] as const) {
      const { start, end } = dayRangeMs(new Date(2026, month, day));
      const hours = (end - start) / 3_600_000;
      expect([23, 24, 25]).toContain(hours);
      expect(toDayKey(end - 1)).toBe(toDayKey(start));
    }
  });
});

describe('monthRangeMs', () => {
  it('starts at the first millisecond of the month', () => {
    const { start } = monthRangeMs(2026, 10); // November
    expect(start).toBe(new Date(2026, 10, 1, 0, 0, 0, 0).getTime());
  });

  it('includes the last millisecond of the month and excludes the first of the next', () => {
    const { start, end } = monthRangeMs(2026, 10);
    expect(new Date(2026, 10, 30, 23, 59, 59, 999).getTime()).toBeLessThan(end);
    expect(new Date(2026, 10, 30, 23, 59, 59, 999).getTime()).toBeGreaterThanOrEqual(start);
    expect(new Date(2026, 11, 1, 0, 0, 0, 0).getTime()).toBeGreaterThanOrEqual(end);
  });

  it('excludes the last millisecond of the previous month', () => {
    const { start } = monthRangeMs(2026, 10);
    expect(new Date(2026, 9, 31, 23, 59, 59, 999).getTime()).toBeLessThan(start);
  });

  it('crosses the year boundary', () => {
    const { start, end } = monthRangeMs(2026, 11); // December
    expect(new Date(2026, 11, 31, 23, 59, 59, 999).getTime()).toBeLessThan(end);
    expect(new Date(2027, 0, 1, 0, 0, 0, 0).getTime()).toBeGreaterThanOrEqual(end);
    expect(new Date(2026, 11, 1, 0, 0, 0, 0).getTime()).toBe(start);
  });

  it('spans February 2028 including the leap day', () => {
    const { start, end } = monthRangeMs(2028, 1);
    // 29 days, ± one hour for time zones that switch DST in this window.
    const hours = (end - start) / 3_600_000;
    expect([29 * 24 - 1, 29 * 24, 29 * 24 + 1]).toContain(hours);
    expect(new Date(2028, 1, 29, 23, 59, 59, 999).getTime()).toBeLessThan(end);
    expect(new Date(2028, 2, 1, 0, 0, 0, 0).getTime()).toBeGreaterThanOrEqual(end);
  });

  it('spans the DST months of 2026 fully', () => {
    // March (spring forward) and October (fall back) in Europe/Berlin.
    for (const month of [2, 9]) {
      const { start, end } = monthRangeMs(2026, month);
      const hours = (end - start) / 3_600_000;
      const days = month === 2 ? 31 : 31;
      expect([days * 24 - 1, days * 24, days * 24 + 1]).toContain(hours);
    }
  });
});
