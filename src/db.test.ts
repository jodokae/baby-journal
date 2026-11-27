import Dexie from 'dexie';
import { beforeEach, expect, it } from 'vitest';
import { clearAllEntries, db, ENTRY_STORES } from './db';

beforeEach(async () => {
  await db.entries.clear();
  await db.entryHistory.clear();
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

// Accepted tradeoff: this test re-declares the version chain instead of using
// BabyJournalDB, because the database name must be parameterized for isolation
// and touching the critical db.ts constructor for a test hook was deliberately
// avoided. The duplication fails loudly if the chain semantics change, but it
// would not track a pure rename — acceptable for a schema-critical file.
it('opening the app at v3 after v2 keeps entries intact and adds an empty entryHistory', async () => {
  const name = 'baby-journal-v3-upgrade-test';
  await Dexie.delete(name);

  // Seed one entry under v2, exactly as a pre-v3 device would have it.
  const v2 = new Dexie(name);
  v2.version(1).stores({ entries: ENTRY_STORES });
  v2.version(2).stores({ entries: ENTRY_STORES }).upgrade(clearAllEntries);
  await v2.open();
  await v2.table('entries').add({
    createdAt: Date.now(),
    type: 'note',
    text: 'v2-Eintrag',
    attachments: [],
  });
  v2.close();

  // Reopen with the app's version chain: no migration needed, entries survive.
  const v3 = new Dexie(name);
  v3.version(1).stores({ entries: ENTRY_STORES });
  v3.version(2).stores({ entries: ENTRY_STORES }).upgrade(clearAllEntries);
  v3.version(3).stores({ entries: ENTRY_STORES, entryHistory: '++id, entryId, at' });
  await v3.open();
  expect(await v3.table('entries').count()).toBe(1);
  const entry = await v3.table('entries').get(1);
  expect(entry?.text).toBe('v2-Eintrag');
  expect(await v3.table('entryHistory').count()).toBe(0);
  v3.close();
  await Dexie.delete(name);
});
