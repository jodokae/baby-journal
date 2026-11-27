/**
 * Backup export/import as JSON, including attachments (blobs as base64).
 *
 * The format is versioned (`schemaVersion`): backups of other versions are
 * rejected cleanly instead of being applied half-way. All user-visible error
 * messages are German; the UI displays `BackupError#message` as-is.
 */
import { db } from '../db';
import type { Attachment, Entry, EntryType } from '../db';
import { toDayKey } from './dates';
import type Dexie from 'dexie';

/** Bump together with the entry shape in `BackupFile`. */
export const BACKUP_SCHEMA_VERSION = 2;

export const EXPORT_ERROR_MESSAGE = 'Export fehlgeschlagen – bitte erneut versuchen.';

/** Error with a ready-to-display German message. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Injectable base64 seam (real implementation uses btoa/atob; tests may stub it). */
export interface BackupCodec {
  encode: (bytes: ArrayBuffer) => string;
  decode: (base64: string) => ArrayBuffer;
}

export interface SerializedAttachment {
  kind: Attachment['kind'];
  createdAt: number;
  mime: string;
  dataBase64: string;
}

export interface SerializedEntry {
  id: number;
  createdAt: number;
  type: EntryType;
  text: string;
  attachments: SerializedAttachment[];
}

export interface BackupFile {
  app: 'baby-journal';
  schemaVersion: number;
  exportedAt: string;
  entries: SerializedEntry[];
}

export const defaultCodec: BackupCodec = {
  encode: (bytes) => arrayBufferToBase64(bytes),
  decode: (base64) => base64ToArrayBuffer(base64),
};

function arrayBufferToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const view = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return view.buffer;
}

async function serializeAttachment(
  attachment: Attachment,
  codec: BackupCodec,
): Promise<SerializedAttachment> {
  return {
    kind: attachment.kind,
    createdAt: attachment.createdAt,
    mime: attachment.blob.type,
    dataBase64: codec.encode(await attachment.blob.arrayBuffer()),
  };
}

/** Serializes entries (preserving their ids and attachments) into the backup format. */
export async function serializeEntries(
  entries: Entry[],
  codec: BackupCodec = defaultCodec,
): Promise<BackupFile> {
  const serialized = await Promise.all(
    entries.map(async (entry) => {
      // Entries without an id are never persisted, so this cannot happen with
      // table data; bail out instead of silently dropping the entry.
      if (entry.id === undefined) {
        throw new BackupError('Ein Eintrag ohne ID konnte nicht gesichert werden.');
      }
      return {
        id: entry.id,
        createdAt: entry.createdAt,
        type: entry.type,
        text: entry.text,
        attachments: await Promise.all(
          entry.attachments.map((attachment) => serializeAttachment(attachment, codec)),
        ),
      };
    }),
  );
  return {
    app: 'baby-journal' as const,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    entries: serialized,
  };
}

/** Reads all entries from the database and serializes them. */
export async function createBackupFile(codec: BackupCodec = defaultCodec): Promise<BackupFile> {
  return serializeEntries(await db.entries.toArray(), codec);
}

function backupFileName(nowMs: number): string {
  return `baby-journal-backup-${toDayKey(nowMs)}.json`;
}

/**
 * Builds the backup file and hands it to the user: via the iOS share sheet
 * („In Dateien sichern“) when the browser can share files, else as a download.
 * Must be called from a user-gesture handler. Sets `lastExportAt` on success.
 */
export async function exportBackup(nowMs = Date.now()): Promise<'shared' | 'downloaded'> {
  const backup = await createBackupFile();
  const file = new File([JSON.stringify(backup, null, 2)], backupFileName(nowMs), {
    type: 'application/json',
  });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    markBackupExported(nowMs);
    return 'shared';
  }
  triggerDownload(file);
  markBackupExported(nowMs);
  return 'downloaded';
}

function triggerDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** True when the user dismissed the share sheet (not a real failure). */
export function isShareCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/* --- Import / restore --- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BackupError(`Ungültiges Backup: Feld "${field}" fehlt oder ist beschädigt.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BackupError(`Ungültiges Backup: Feld "${field}" fehlt oder ist beschädigt.`);
  }
  return value;
}

function parseAttachment(raw: unknown): SerializedAttachment {
  if (!isRecord(raw)) {
    throw new BackupError('Ungültiges Backup: Anhang ist beschädigt.');
  }
  const kind = requireString(raw.kind, 'attachments.kind');
  if (kind !== 'photo' && kind !== 'video' && kind !== 'audio') {
    throw new BackupError(`Ungültiges Backup: unbekannter Anhangstyp "${kind}".`);
  }
  const mime = requireString(raw.mime, 'attachments.mime');
  const dataBase64 = requireString(raw.dataBase64, 'attachments.dataBase64');
  return {
    kind,
    createdAt: requireNumber(raw.createdAt, 'attachments.createdAt'),
    mime,
    dataBase64,
  };
}

function parseEntry(raw: unknown): SerializedEntry {
  if (!isRecord(raw)) {
    throw new BackupError('Ungültiges Backup: Eintrag ist beschädigt.');
  }
  const id = requireNumber(raw.id, 'id');
  if (!Number.isInteger(id)) {
    throw new BackupError('Ungültiges Backup: Eintrag hat keine ganzzahlige ID.');
  }
  const type = requireString(raw.type, 'type');
  // The entry model has no enum constraint; unknown future kinds come with a
  // schemaVersion bump, so current files only ever contain 'note'.
  return {
    id,
    createdAt: requireNumber(raw.createdAt, 'createdAt'),
    type: type as EntryType,
    text: requireString(raw.text, 'text'),
    attachments: requireArray(raw.attachments).map(parseAttachment),
  };
}

function requireArray(value: unknown, field = 'attachments'): unknown[] {
  if (!Array.isArray(value)) {
    throw new BackupError(`Ungültiges Backup: Feld "${field}" fehlt oder ist beschädigt.`);
  }
  return value;
}

/**
 * Parses and validates backup JSON. Unknown extra fields are tolerated (and
 * dropped); anything malformed throws a BackupError with a German message and
 * nothing is written to the database.
 */
export function parseBackupFile(json: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new BackupError('Die Datei enthält kein gültiges JSON.');
  }
  if (!isRecord(data) || data.app !== 'baby-journal') {
    throw new BackupError('Diese Datei ist kein Baby-Tagebuch-Backup.');
  }
  const schemaVersion = requireNumber(data.schemaVersion, 'schemaVersion');
  if (schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupError(
      `Backup-Format ${schemaVersion} wird nicht unterstützt (erwartet: ${BACKUP_SCHEMA_VERSION}).`,
    );
  }
  const entries = requireArray(data.entries, 'entries').map(parseEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new BackupError('Ungültiges Backup: doppelte Eintrags-IDs.');
  }
  return {
    app: 'baby-journal',
    schemaVersion,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    entries,
  };
}

/**
 * Rebuilds Entry objects (attachments as fresh Blobs) from a validated backup.
 * Pure — no database access, so tests can verify blob fidelity directly.
 */
export function entriesFromBackup(backup: BackupFile, codec: BackupCodec = defaultCodec): Entry[] {
  return backup.entries.map((entry) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    type: entry.type,
    text: entry.text,
    attachments: entry.attachments.map((attachment) => ({
      kind: attachment.kind,
      createdAt: attachment.createdAt,
      blob: new Blob([codec.decode(attachment.dataBase64)], { type: attachment.mime }),
    })),
  }));
}

/**
 * Optional table with 48h undo snapshots, added by a later schema version.
 * Referenced only dynamically (never typed, never created here) so this
 * module stays compatible with today's v1/v2 schema.
 */
export const ENTRY_HISTORY_TABLE = 'entryHistory';

/**
 * Replaces the whole `entries` table with `entries` in a single transaction.
 * When the optional entry-history table exists in the current schema, it is
 * cleared in the same transaction — otherwise old snapshot rows would become
 * orphaned garbage after a restore. Looked up dynamically via `tables`, so
 * schemas without it (v1/v2) simply skip the clear.
 */
export async function replaceEntries(target: Dexie, entries: Entry[]): Promise<void> {
  const historyTable = target.tables.find((table) => table.name === ENTRY_HISTORY_TABLE);
  const tables = historyTable ? [target.table('entries'), historyTable] : [target.table('entries')];
  await target.transaction('rw', tables, async (tx) => {
    await target.table('entries').clear();
    await target.table('entries').bulkAdd(entries);
    if (historyTable) await tx.table(ENTRY_HISTORY_TABLE).clear();
  });
}

/**
 * Replaces all entries with the backup's entries (attachments as blobs) in a
 * single transaction, preserving the original ids and clearing any existing
 * entry history. Returns the entry count.
 */
export async function restoreBackup(
  backup: BackupFile,
  codec: BackupCodec = defaultCodec,
): Promise<number> {
  const entries = entriesFromBackup(backup, codec);
  await replaceEntries(db, entries);
  return entries.length;
}

/* --- Daily export banner state (localStorage) --- */

export const LAST_EXPORT_KEY = 'lastExportAt';
export const BANNER_HIDDEN_KEY = 'bannerHiddenOn';

/** The last (successful) export time, or null when never exported / corrupted. */
export function getLastExportDate(): Date | null {
  const raw = localStorage.getItem(LAST_EXPORT_KEY);
  if (raw === null) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Marks "exported now" so the daily banner stays hidden for the rest of the day. */
export function markBackupExported(nowMs = Date.now()): void {
  localStorage.setItem(LAST_EXPORT_KEY, new Date(nowMs).toISOString());
}

/** Hides the banner for today only („Später“). */
export function dismissBackupBannerForToday(nowMs = Date.now()): void {
  localStorage.setItem(BANNER_HIDDEN_KEY, toDayKey(nowMs));
}

/**
 * Whether the daily export banner should show on the calendar screen:
 * at least one entry, not exported today, and not dismissed today.
 * Both markers live in localStorage, so the banner persists across app starts
 * within the day.
 */
export function getBackupBannerState(hasEntries: boolean, nowMs = Date.now()): boolean {
  if (!hasEntries) return false;
  const today = toDayKey(nowMs);
  if (localStorage.getItem(BANNER_HIDDEN_KEY) === today) return false;
  const lastExport = getLastExportDate();
  if (lastExport && toDayKey(lastExport.getTime()) === today) return false;
  return true;
}
