import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import type { Entry } from '../db';
import { toDayKey } from './dates';
import {
  BackupError,
  BACKUP_SCHEMA_VERSION,
  BANNER_HIDDEN_KEY,
  createBackupFile,
  dismissBackupBannerForToday,
  entriesFromBackup,
  exportBackup,
  getBackupBannerState,
  getLastExportDate,
  isShareCancelled,
  LAST_EXPORT_KEY,
  markBackupExported,
  parseBackupFile,
  restoreBackup,
  serializeEntries,
  type BackupCodec,
} from './backup';

beforeEach(async () => {
  await db.entries.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mockShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true });
}

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

describe('serializeEntries', () => {
  it('preserves ids, texts and the export shape', async () => {
    const createdAt = new Date(2026, 10, 27, 9, 0).getTime();
    const entry: Entry = { createdAt, type: 'note', text: 'Erster Tag', attachments: [] };
    entry.id = await db.entries.add(entry);
    const backup = await serializeEntries([entry]);
    expect(backup).toMatchObject({
      app: 'baby-journal',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: expect.any(String),
      entries: [{ id: entry.id, createdAt, type: 'note', text: 'Erster Tag', attachments: [] }],
    });
    expect(() => new Date(backup.exportedAt).toISOString()).not.toThrow();
  });

  it('encodes attachment blobs as base64 with their mime type', async () => {
    const payload = new Uint8Array([1, 2, 3, 254, 0, 127]);
    const entry: Entry = {
      createdAt: Date.now(),
      type: 'note',
      text: 'Mit Foto',
      attachments: [
        { kind: 'photo', createdAt: 12345, blob: new Blob([payload], { type: 'image/jpeg' }) },
      ],
    };
    entry.id = 7;
    const backup = await serializeEntries([entry]);
    expect(backup.entries[0]?.attachments).toHaveLength(1);
    const attachment = backup.entries[0]?.attachments[0]!;
    expect(attachment.kind).toBe('photo');
    expect(attachment.createdAt).toBe(12345);
    expect(attachment.mime).toBe('image/jpeg');
    const decoded = atob(attachment.dataBase64);
    expect([...decoded].map((char) => char.charCodeAt(0))).toEqual([...payload]);
  });

  it('rejects entries without an id (never persisted)', async () => {
    const entry: Entry = { createdAt: 1, type: 'note', text: 'x', attachments: [] };
    await expect(serializeEntries([entry])).rejects.toBeInstanceOf(BackupError);
  });

  it('lets tests swap the base64 codec', async () => {
    const codec: BackupCodec = {
      encode: () => 'YWJj',
      decode: () => new Uint8Array([97, 98, 99]).buffer,
    };
    const entry: Entry = {
      id: 1,
      createdAt: 1,
      type: 'note',
      text: 'x',
      attachments: [{ kind: 'photo', createdAt: 1, blob: new Blob(['x']) }],
    };
    const backup = await serializeEntries([entry], codec);
    expect(backup.entries[0]?.attachments[0]?.dataBase64).toBe('YWJj');
  });
});

describe('export / import round-trip', () => {
  it('survives serialize → JSON → parse → Blob reconstruction with bytes intact', async () => {
    // In-memory entries for the serialization half: fake-indexeddb's
    // structuredClone cannot copy jsdom blobs, so blob fidelity is only
    // verifiable before anything passes through the fake database.
    const payload = new Uint8Array([9, 8, 7, 6]);
    const now = Date.now();
    const entries: Entry[] = [
      {
        id: 11,
        createdAt: now - 1000,
        type: 'note',
        text: 'älterer Eintrag',
        attachments: [
          { kind: 'photo', createdAt: now, blob: new Blob([payload], { type: 'image/png' }) },
        ],
      },
      { id: 12, createdAt: now, type: 'note', text: 'neuerer Eintrag', attachments: [] },
    ];

    const backup = await serializeEntries(entries);
    const json = JSON.stringify(backup);

    // The reconstruction keeps blob bytes, mime type and ids.
    const rebuilt = entriesFromBackup(parseBackupFile(json));
    expect(rebuilt.map((entry) => entry.id)).toEqual([11, 12]);
    const withPhoto = rebuilt.find((entry) => entry.attachments.length === 1);
    expect(withPhoto?.text).toBe('älterer Eintrag');
    const blob = withPhoto?.attachments[0]?.blob as Blob;
    expect(blob.type).toBe('image/png');
    expect(sameBytes(await bytesOf(blob), payload)).toBe(true);

    // Restoring replaces the database content; strings, ids and attachment
    // kinds survive the fake-indexeddb round-trip (blob bytes were verified
    // above, before the db round-trip).
    await db.entries.bulkAdd([{ id: 1, createdAt: 1, type: 'note', text: 'Alt', attachments: [] }]);
    await expect(restoreBackup(parseBackupFile(json))).resolves.toBe(2);
    const restored = await db.entries.toArray();
    expect(new Set(restored.map((entry) => entry.id))).toEqual(new Set([11, 12]));
    expect(restored.map((entry) => entry.text)).toContain('neuerer Eintrag');
    expect(restored.find((entry) => entry.attachments.length === 1)?.attachments[0]?.kind).toBe(
      'photo',
    );
  });
});

describe('parseBackupFile', () => {
  const validEntry = {
    id: 3,
    createdAt: 100,
    type: 'note',
    text: 'geparst',
    attachments: [{ kind: 'photo', createdAt: 1, mime: 'image/png', dataBase64: 'aGVsbG8=' }],
  };
  const validJson = JSON.stringify({
    app: 'baby-journal',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-11-27T09:00:00.000Z',
    entries: [validEntry],
  });

  it('accepts a well-formed backup and keeps known fields', () => {
    const parsed = parseBackupFile(validJson);
    expect(parsed.entries).toEqual([validEntry]);
    expect(parsed.exportedAt).toBe('2026-11-27T09:00:00.000Z');
  });

  it('rejects invalid JSON with a German message', () => {
    expect(() => parseBackupFile('{nope')).toThrow(BackupError);
    expect(() => parseBackupFile('{nope')).toThrow(/gültiges JSON/);
  });

  it('rejects files from other apps', () => {
    const json = JSON.stringify({ app: 'other', schemaVersion: 2, entries: [] });
    expect(() => parseBackupFile(json)).toThrow(/kein Baby-Tagebuch-Backup/);
  });

  it('rejects other schema versions', () => {
    const json = JSON.stringify({ app: 'baby-journal', schemaVersion: 99, entries: [] });
    expect(() => parseBackupFile(json)).toThrow(/Format 99 wird nicht unterstützt/);
  });

  it('rejects entries with missing required fields', () => {
    for (const partial of [
      { ...validEntry, id: undefined },
      { ...validEntry, createdAt: 'nope' },
      { ...validEntry, type: 5 },
      { ...validEntry, text: null },
      { ...validEntry, attachments: undefined },
      { ...validEntry, attachments: [{ kind: 'photo', mime: '', dataBase64: '' }] },
    ]) {
      const json = JSON.stringify({
        app: 'baby-journal',
        schemaVersion: BACKUP_SCHEMA_VERSION,
        entries: [partial],
      });
      expect(() => parseBackupFile(json), JSON.stringify(partial)).toThrow(BackupError);
    }
  });

  it('rejects unknown attachment kinds and duplicate ids', () => {
    const badKind = JSON.stringify({
      app: 'baby-journal',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      entries: [{ ...validEntry, attachments: [{ ...validEntry.attachments[0], kind: 'pdf' }] }],
    });
    expect(() => parseBackupFile(badKind)).toThrow(/unbekannter Anhangstyp/);

    const duplicate = JSON.stringify({
      app: 'baby-journal',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      entries: [validEntry, validEntry],
    });
    expect(() => parseBackupFile(duplicate)).toThrow(/doppelte Eintrags-IDs/);
  });

  it('tolerates unknown fields and a missing exportedAt', () => {
    const json = JSON.stringify({
      app: 'baby-journal',
      schemaVersion: BACKUP_SCHEMA_VERSION,
      futureField: true,
      entries: [{ ...validEntry, futureEntryField: 42 }],
    });
    const parsed = parseBackupFile(json);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.text).toBe('geparst');
    expect(parsed.entries[0]).not.toHaveProperty('futureEntryField');
    expect(parsed.exportedAt).toBe('');
  });
});

describe('exportBackup', () => {
  it('shares the file and marks the export when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    mockShare(
      share,
      vi.fn(() => true),
    );
    await db.entries.add({
      createdAt: Date.now(),
      type: 'note',
      text: 'sichern',
      attachments: [],
    });

    await expect(exportBackup()).resolves.toBe('shared');

    expect(share).toHaveBeenCalledOnce();
    const shared = share.mock.calls[0]?.[0] as { files: File[] };
    expect(shared.files).toHaveLength(1);
    expect(shared.files[0]?.name).toMatch(/^baby-journal-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const sharedBackup = JSON.parse((await shared.files[0]?.text()) ?? '{}');
    const expected = await createBackupFile();
    // exportedAt differs between the two serializations; compare the payload.
    expect({ ...sharedBackup, exportedAt: null }).toEqual({ ...expected, exportedAt: null });
    expect(getLastExportDate()).not.toBeNull();
  });

  it('falls back to a download link when sharing is unsupported', async () => {
    mockShare(undefined, undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:created');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    await expect(exportBackup()).resolves.toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(File);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:created');
    expect(getLastExportDate()).not.toBeNull();
  });

  it('throws on a failed share without marking the export', async () => {
    mockShare(
      vi.fn().mockRejectedValue(new Error('nope')),
      vi.fn(() => true),
    );
    await expect(exportBackup()).rejects.toThrow('nope');
    expect(getLastExportDate()).toBeNull();
  });
});

describe('isShareCancelled', () => {
  it('recognizes the user dismissing the share sheet', () => {
    expect(isShareCancelled(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isShareCancelled(new Error('anything'))).toBe(false);
    expect(isShareCancelled(undefined)).toBe(false);
  });
});

describe('daily banner state', () => {
  const now = new Date(2026, 10, 27, 9, 0).getTime();
  const yesterday = new Date(2026, 10, 26, 9, 0).getTime();
  const tomorrow = new Date(2026, 10, 28, 9, 0).getTime();

  it('shows with an entry and nothing stored yet', () => {
    expect(getBackupBannerState(true, now)).toBe(true);
  });

  it('stays hidden without entries', () => {
    expect(getBackupBannerState(false, now)).toBe(false);
  });

  it('hides on the day of an export and reappears the next day', () => {
    markBackupExported(now);
    expect(getBackupBannerState(true, now)).toBe(false);
    expect(getBackupBannerState(true, tomorrow)).toBe(true);
  });

  it('hides after dismissing for today and reappears the next day', () => {
    dismissBackupBannerForToday(now);
    expect(getBackupBannerState(true, now)).toBe(false);
    expect(getBackupBannerState(true, tomorrow)).toBe(true);
  });

  it('stays hidden when dismissed today even after an export yesterday', () => {
    markBackupExported(yesterday);
    dismissBackupBannerForToday(now);
    expect(getBackupBannerState(true, now)).toBe(false);
  });

  it('treats a corrupted lastExportAt as "never exported"', () => {
    localStorage.setItem(LAST_EXPORT_KEY, 'not-a-date');
    expect(getLastExportDate()).toBeNull();
    expect(getBackupBannerState(true, now)).toBe(true);
  });

  it('stores the export marker as ISO and the dismissal as a day key', () => {
    markBackupExported(now);
    expect(Date.parse(localStorage.getItem(LAST_EXPORT_KEY) ?? '')).toBe(now);
    dismissBackupBannerForToday(now);
    expect(localStorage.getItem(BANNER_HIDDEN_KEY)).toBe(toDayKey(now));
  });
});
