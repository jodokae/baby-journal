/**
 * Date helpers for day keys and month ranges.
 *
 * Everything works in the device-local time zone, matching how entries are
 * created (Date.now()) and displayed (Intl formatters with de-DE).
 */

/** Returns 'YYYY-MM-DD' for an epoch timestamp in device-local time. */
export function toDayKey(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Returns the epoch timestamp of local noon on the day given by a day key
 * ('YYYY-MM-DD'). Noon keeps the day key unambiguous across DST transitions:
 * no civil time on that date is 12 hours away from it.
 */
export function dayKeyToNoon(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12).getTime();
}

/**
 * Returns the epoch range of a local day: `start` is the first millisecond
 * of the day (inclusive), `end` is the first millisecond of the next day
 * (exclusive). DST transitions are handled by Date's day overflow.
 */
export function dayRangeMs(date: Date): { start: number; end: number } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    start: new Date(year, month, day).getTime(),
    end: new Date(year, month, day + 1).getTime(),
  };
}

/**
 * Returns the epoch range of a local month: `start` is the first millisecond
 * of the month (inclusive), `end` is the first millisecond of the next month
 * (exclusive). `month` is 0-based, like Date#getMonth.
 */
export function monthRangeMs(year: number, month: number): { start: number; end: number } {
  return {
    start: new Date(year, month, 1).getTime(),
    end: new Date(year, month + 1, 1).getTime(),
  };
}
