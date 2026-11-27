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
}

export interface Entry {
  id?: number;
  createdAt: number;
  type: EntryType;
  text: string;
  attachments: Attachment[];
}

export class BabyJournalDB extends Dexie {
  entries!: Table<Entry, number>;

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
  }
}

export const db = new BabyJournalDB();
