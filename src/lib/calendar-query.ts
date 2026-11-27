import type { Entry } from '../db';
import { toDayKey } from './dates';

/** Entries grouped by local day key ('YYYY-MM-DD'); each day's list is chronological. */
export type EntriesByDay = Map<string, Entry[]>;

/** Groups entries by local day key and sorts every day chronologically. */
export function groupEntriesByDay(entries: Entry[]): EntriesByDay {
  const byDay: EntriesByDay = new Map();
  for (const entry of entries) {
    const key = toDayKey(entry.createdAt);
    const dayEntries = byDay.get(key);
    if (dayEntries) {
      dayEntries.push(entry);
    } else {
      byDay.set(key, [entry]);
    }
  }
  for (const dayEntries of byDay.values()) {
    dayEntries.sort((a, b) => a.createdAt - b.createdAt);
  }
  return byDay;
}

/** The days that have entries, as local-midnight Dates (for DayPicker modifiers). */
export function daysWithEntries(byDay: EntriesByDay): Date[] {
  return [...byDay.keys()].map((key) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  });
}
