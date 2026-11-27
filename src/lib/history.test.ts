import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '../db';
import {
  HISTORY_MAX_ROWS_PER_ENTRY,
  HISTORY_RETENTION_MS,
  listHistory,
  pruneHistory,
  snapshotBeforeOverwrite,
  snapshotText,
  stashRemovedAttachment,
} from './history';

const HOUR_MS = 60 * 60 * 1000;

// Fake only the clock: Dexie/fake-indexeddb need real timers to progress,
// while every time-dependent assertion here goes through Date.now().
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T12:00:00'));
});

afterEach(async () => {
  vi.useRealTimers();
  await db.entries.clear();
  await db.entryHistory.clear();
});

async function seedEntry(text = 'Eintrag'): Promise<number> {
  const id = await db.entries.add({ createdAt: Date.now(), type: 'note', text, attachments: [] });
  return id;
}

it('takes a text snapshot before an overwrite', async () => {
  const id = await seedEntry();
  await snapshotBeforeOverwrite(id, 'Alter Text', 'Neuer Text');

  const rows = await db.entryHistory.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ entryId: id, kind: 'text', text: 'Alter Text' });
  expect(rows[0].at).toBe(Date.now());
});

it('throttles text snapshots to one per 60 s per entry', async () => {
  const id = await seedEntry();
  await snapshotBeforeOverwrite(id, 'Erste Fassung', 'Zweite');
  expect(await db.entryHistory.count()).toBe(1);

  vi.advanceTimersByTime(30_000);
  await snapshotBeforeOverwrite(id, 'Zweite', 'Dritte');
  expect(await db.entryHistory.count()).toBe(1); // still within the throttle window

  vi.advanceTimersByTime(31_000); // > 60 s after the first snapshot
  await snapshotBeforeOverwrite(id, 'Dritte', 'Vierte');
  expect(await db.entryHistory.count()).toBe(2);
});

it('snapshots immediately on a radical shrink, ignoring the throttle', async () => {
  const id = await seedEntry();
  await snapshotBeforeOverwrite(id, 'a'.repeat(60), 'b'.repeat(20)); // 20 < 50 % of 60
  expect(await db.entryHistory.count()).toBe(1);

  vi.advanceTimersByTime(10_000);
  await snapshotBeforeOverwrite(id, 'b'.repeat(19), 'c'.repeat(18)); // no radical shrink → throttled
  expect(await db.entryHistory.count()).toBe(1);

  vi.advanceTimersByTime(10_000);
  await snapshotBeforeOverwrite(id, 'c'.repeat(45), 'd'); // select-all + delete
  expect(await db.entryHistory.count()).toBe(2);
  expect((await listHistory(id))[0]).toMatchObject({ kind: 'text', text: 'c'.repeat(45) });
});

it('does not snapshot when the new text is identical', async () => {
  const id = await seedEntry();
  await snapshotBeforeOverwrite(id, 'gleich', 'gleich');
  expect(await db.entryHistory.count()).toBe(0);
});

it('does not share the throttle between entries', async () => {
  const first = await seedEntry();
  const second = await seedEntry('Anderer Eintrag');
  await snapshotBeforeOverwrite(first, 'eins', 'zwei');
  await snapshotBeforeOverwrite(second, 'eins', 'zwei');
  expect(await db.entryHistory.count()).toBe(2);
});

it('snapshotText bypasses the throttle (restore stays undoable)', async () => {
  const id = await seedEntry();
  await snapshotText(id, 'Vor der Wiederherstellung');
  await snapshotText(id, 'Direkt danach');
  expect(await db.entryHistory.count()).toBe(2);
});

it('stashes removed attachments as attachment rows', async () => {
  const id = await seedEntry();
  const rowId = await stashRemovedAttachment(id, {
    kind: 'photo',
    blob: new Blob(['fake-image'], { type: 'image/png' }),
    mime: 'image/png',
    width: 2048,
    height: 1536,
  });

  const row = await db.entryHistory.get(rowId);
  expect(row).toMatchObject({ entryId: id, kind: 'attachment' });
  expect(row?.attachment?.kind).toBe('photo');
  expect(row?.attachment?.mime).toBe('image/png');
});

it('listHistory returns the rows of one entry newest first and prunes first', async () => {
  const id = await seedEntry();
  const other = await seedEntry('Anderer Eintrag');
  await db.entryHistory.bulkAdd([
    { entryId: id, at: Date.now() - 49 * HOUR_MS, kind: 'text', text: 'zu alt' },
    { entryId: id, at: Date.now() - 2 * HOUR_MS, kind: 'text', text: 'mittel' },
    { entryId: other, at: Date.now() - HOUR_MS, kind: 'text', text: 'fremd' },
  ]);
  await snapshotText(id, 'aktuell');

  const rows = await listHistory(id);
  expect(rows.map((row) => row.text)).toEqual(['aktuell', 'mittel']); // 'zu alt' pruned (> 48 h)
});

it('pruneHistory keeps the row exactly at the 48 h boundary and deletes older ones', async () => {
  const id = await seedEntry();
  await db.entryHistory.bulkAdd([
    { entryId: id, at: Date.now() - HISTORY_RETENTION_MS - 1, kind: 'text', text: 'zu alt' },
    { entryId: id, at: Date.now() - HISTORY_RETENTION_MS, kind: 'text', text: 'an der Grenze' },
    { entryId: id, at: Date.now() - 1000, kind: 'text', text: 'frisch' },
  ]);

  await pruneHistory();
  const texts = (await db.entryHistory.where('entryId').equals(id).toArray()).map((r) => r.text);
  expect(texts).toEqual(['an der Grenze', 'frisch']);
});

it('pruneHistory keeps at most 50 rows per entry and leaves other entries alone', async () => {
  const id = await seedEntry();
  const other = await seedEntry('Anderer Eintrag');
  for (let i = 0; i < 55; i++) {
    vi.advanceTimersByTime(1000);
    await db.entryHistory.add({ entryId: id, at: Date.now(), kind: 'text', text: `t${i}` });
  }
  await db.entryHistory.add({ entryId: other, at: Date.now(), kind: 'text', text: 't0' });

  await pruneHistory();
  const rows = await db.entryHistory.where('entryId').equals(id).toArray();
  expect(rows).toHaveLength(HISTORY_MAX_ROWS_PER_ENTRY);
  expect(rows[0].text).toBe('t5'); // the 5 oldest are gone
  expect(rows[HISTORY_MAX_ROWS_PER_ENTRY - 1].text).toBe('t54');
  expect(await db.entryHistory.where('entryId').equals(other).count()).toBe(1);
});
