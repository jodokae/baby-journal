import Dexie, { type Table } from 'dexie';

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
      entries: '++id, createdAt, type',
    });
  }
}

export const db = new BabyJournalDB();
