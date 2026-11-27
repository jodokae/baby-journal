import Dexie, { type Table, type Transaction } from 'dexie';

/** Index specification of the entries table (unchanged since v1). */
export const ENTRY_STORES = '++id, createdAt, type';

/** v2 upgrade: wipes all entries exactly once per device. */
export function clearAllEntries(tx: Transaction): Promise<void> {
  return tx.table('entries').clear();
}

/** Art des Eintrags – spätere Versionen erweitern dies um Füttern/Schlaf/Wickeln etc. */
export type EntryType = 'note';

export interface Attachment {
  kind: 'photo' | 'video' | 'audio';
  blob: Blob;
  createdAt: number;
  // Type-only extension for photo attachments (non-indexed record properties —
  // Dexie stores them without any schema change or version bump).
  /** Re-encoded ~256 px JPEG thumbnail; absent when re-encoding failed. */
  thumb?: Blob;
  /** MIME type of `blob` ('image/jpeg' for re-encoded copies). */
  mime?: string;
  /** Pixel dimensions of `blob`. */
  width?: number;
  height?: number;
}

export interface Entry {
  id?: number;
  createdAt: number;
  type: EntryType;
  text: string;
  attachments: Attachment[];
}

/** Snapshot of a removed attachment, stored in the entry history (v3). */
export interface HistoryAttachment {
  kind: Attachment['kind'];
  blob: Blob;
  /** Kept so a restored photo renders its real tile, not a placeholder.
   *  Type-only field of a non-indexed record: no schema or version change. */
  thumb?: Blob;
  mime?: string;
  width?: number;
  height?: number;
}

/** One row of the entryHistory table: a text snapshot or a stashed attachment. */
export interface EntryHistoryRow {
  id?: number;
  /** The entry this snapshot belongs to. */
  entryId: number;
  /** When the snapshot was taken (epoch ms). */
  at: number;
  kind: 'text' | 'attachment';
  /** The previous text, for kind 'text'. */
  text?: string;
  /** The stashed attachment, for kind 'attachment'. */
  attachment?: HistoryAttachment;
}

export class BabyJournalDB extends Dexie {
  entries!: Table<Entry, number>;
  /** Text snapshots and stashed attachments for the 48 h undo history (v3). */
  entryHistory!: Table<EntryHistoryRow, number>;

  constructor() {
    super('baby-journal');
    // SCHEMA-REGEL: Bestehende Versionen nach dem ersten Deploy nie mehr ändern!
    // Änderungen immer als neue db.version(n+1) mit upgrade() ergänzen, siehe AGENTS.md.
    this.version(1).stores({
      entries: ENTRY_STORES,
    });
    // v2: one-time data wipe — the user chose to start fresh with the
    // one-entry-per-day model (device-only data, no backup, confirmed 2026-11-27).
    this.version(2).stores({ entries: ENTRY_STORES }).upgrade(clearAllEntries);
    // v3: 48h undo history — text snapshots before overwrites + stashed removed
    // attachments. New, empty table; no data migration.
    this.version(3).stores({
      entries: ENTRY_STORES,
      entryHistory: '++id, entryId, at',
    });
  }
}

export const db = new BabyJournalDB();
