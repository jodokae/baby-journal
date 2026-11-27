import Dexie from 'dexie';
import { beforeEach, expect, it } from 'vitest';
import { clearAllEntries, db, ENTRY_STORES } from './db';

beforeEach(async () => {
  await db.entries.clear();
});

it('speichert und liest Einträge mit Anhängen', async () => {
  const blob = new Blob(['fake-image-data'], { type: 'image/png' });
  const id = await db.entries.add({
    createdAt: Date.now(),
    type: 'note',
    text: 'Erster Eintrag',
    attachments: [{ kind: 'photo', blob, createdAt: Date.now() }],
  });

  const entry = await db.entries.get(id);
  expect(entry?.text).toBe('Erster Eintrag');
  expect(entry?.attachments).toHaveLength(1);
  expect(entry?.attachments[0].kind).toBe('photo');
});

it('opening v2 after v1 clears all entries (one-time wipe)', async () => {
  const name = 'baby-journal-upgrade-test';
  await Dexie.delete(name);

  // Seed entries under v1, exactly as a pre-v2 device would have them.
  const v1 = new Dexie(name);
  v1.version(1).stores({ entries: ENTRY_STORES });
  await v1.open();
  await v1.table('entries').bulkAdd([
    { createdAt: Date.now(), type: 'note', text: 'alt 1', attachments: [] },
    { createdAt: Date.now(), type: 'note', text: 'alt 2', attachments: [] },
  ]);
  expect(await v1.table('entries').count()).toBe(2);
  v1.close();

  // Reopen with the app's version chain: the v2 upgrade wipes everything.
  const v2 = new Dexie(name);
  v2.version(1).stores({ entries: ENTRY_STORES });
  v2.version(2).stores({ entries: ENTRY_STORES }).upgrade(clearAllEntries);
  await v2.open();
  expect(await v2.table('entries').count()).toBe(0);
  v2.close();
  await Dexie.delete(name);
});
