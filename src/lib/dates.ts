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
