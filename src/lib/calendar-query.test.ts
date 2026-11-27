import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Entry } from '../db';
import { daysWithEntries, groupEntriesByDay } from './calendar-query';
import { monthRangeMs, toDayKey } from './dates';

function at(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month, day, hour, minute).getTime();
}

function entry(createdAt: number, text: string): Entry {
  return { createdAt, type: 'note', text, attachments: [] };
}

beforeEach(async () => {
  await db.entries.clear();
});

describe('groupEntriesByDay', () => {
  it('groups entries by their local day key', () => {
    const byDay = groupEntriesByDay([entry(at(2026, 10, 5), 'a'), entry(at(2026, 10, 6), 'b')]);
    expect([...byDay.keys()].sort()).toEqual(['2026-11-05', '2026-11-06']);
    expect(byDay.get('2026-11-05')?.map((e) => e.text)).toEqual(['a']);
  });

  it('sorts multiple entries per day chronologically regardless of input order', () => {
    const byDay = groupEntriesByDay([
      entry(at(2026, 10, 5, 20, 0), 'evening'),
      entry(at(2026, 10, 5, 7, 30), 'morning'),
      entry(at(2026, 10, 5, 12, 0), 'noon'),
    ]);
    expect(byDay.get('2026-11-05')?.map((e) => e.text)).toEqual(['morning', 'noon', 'evening']);
  });

  it('keeps the whole DST day together under one key', () => {
    // 2026-03-29, the spring-forward day in Europe/Berlin.
    const byDay = groupEntriesByDay([
      entry(at(2026, 2, 29, 0, 30), 'früh'),
      entry(at(2026, 2, 29, 23, 30), 'spät'),
    ]);
    expect([...byDay.keys()]).toEqual(['2026-03-29']);
    expect(byDay.get('2026-03-29')?.map((e) => e.text)).toEqual(['früh', 'spät']);
  });

  it('returns an empty map for no entries', () => {
    expect(groupEntriesByDay([]).size).toBe(0);
  });
});

describe('daysWithEntries', () => {
  it('builds one local-midnight Date per day with entries', () => {
    const byDay = groupEntriesByDay([
      entry(at(2026, 10, 5, 9, 0), 'a'),
      entry(at(2026, 10, 5, 18, 0), 'b'),
      entry(at(2026, 10, 20), 'c'),
    ]);
    const days = daysWithEntries(byDay);
    expect(days).toHaveLength(2);
    expect(days.map((d) => toDayKey(d.getTime())).sort()).toEqual(['2026-11-05', '2026-11-20']);
  });
});

describe('month range query over the createdAt index', () => {
  it('includes month-edge timestamps and excludes neighbours', async () => {
    await db.entries.bulkAdd([
      entry(at(2026, 9, 31, 23, 59), 'letzter Tag Vormonat – Sekunde 59.999'), // Oct 31 23:59
      entry(at(2026, 10, 1, 0, 0), 'erster Tag Monat'), // Nov 1 00:00
      entry(at(2026, 10, 30, 23, 59), 'letzter Tag Monat – Sekunde 59.999'), // Nov 30 23:59
      entry(at(2026, 11, 1, 0, 0), 'erster Tag Folgemonat'), // Dec 1 00:00
    ]);

    const { start, end } = monthRangeMs(2026, 10);
    const inMonth = await db.entries.where('createdAt').between(start, end, true, false).toArray();

    expect(inMonth.map((e) => e.text)).toEqual([
      'erster Tag Monat',
      'letzter Tag Monat – Sekunde 59.999',
    ]);
  });

  it('includes entries exactly at midnight of the first day of the month', async () => {
    await db.entries.bulkAdd([entry(at(2026, 10, 1, 0, 0), 'Mitternacht Monatsanfang')]);
    const { start, end } = monthRangeMs(2026, 10);
    const inMonth = await db.entries.where('createdAt').between(start, end, true, false).toArray();
    expect(inMonth).toHaveLength(1);
    expect(groupEntriesByDay(inMonth).get('2026-11-01')).toHaveLength(1);
  });

  it('keeps both sides of a DST month inside the range', async () => {
    await db.entries.bulkAdd([
      entry(at(2026, 2, 29, 0, 30), 'vor der Umstellung'),
      entry(at(2026, 2, 29, 23, 30), 'nach der Umstellung'),
    ]);
    const { start, end } = monthRangeMs(2026, 2);
    const inMonth = await db.entries.where('createdAt').between(start, end, true, false).toArray();
    expect(inMonth).toHaveLength(2);
    const byDay = groupEntriesByDay(inMonth);
    expect([...byDay.keys()]).toEqual(['2026-03-29']);
  });
});
