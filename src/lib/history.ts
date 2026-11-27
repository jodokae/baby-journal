import { db, type EntryHistoryRow, type HistoryAttachment } from '../db';

/** History rows older than this are deleted. */
export const HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;

/** At most this many history rows are kept per entry (the newest ones). */
export const HISTORY_MAX_ROWS_PER_ENTRY = 50;

/** At most one automatic text snapshot per entry per this interval. */
const SNAPSHOT_THROTTLE_MS = 60_000;

/** A change that shrinks the text below this fraction counts as a radical shrink. */
const RADICAL_SHRINK_FACTOR = 0.5;

/** Only previous texts longer than this can shrink "radically". */
const RADICAL_SHRINK_MIN_PREVIOUS_CHARS = 40;

/** Time of the newest text snapshot for an entry (0 when there is none). */
async function lastTextSnapshotAt(entryId: number): Promise<number> {
  const rows = await db.entryHistory.where('entryId').equals(entryId).toArray();
  let last = 0;
  for (const row of rows) {
    if (row.kind === 'text' && row.at > last) last = row.at;
  }
  return last;
}

/** Adds one text snapshot row, timestamped now. */
async function addTextSnapshot(entryId: number, text: string): Promise<void> {
  await db.entryHistory.add({ entryId, at: Date.now(), kind: 'text', text });
}

/**
 * Stores a text snapshot BEFORE an update replaces the entry's text.
 *
 * Throttled to at most one snapshot per 60 s per entry — except when the
 * change is a radical shrink (new text below 50 % of the previous length and
 * the previous text longer than 40 characters, e.g. select-all + delete),
 * which is captured immediately. Identical text is not an overwrite and never
 * snapshots.
 */
export async function snapshotBeforeOverwrite(
  entryId: number,
  previousText: string,
  newText?: string,
): Promise<void> {
  if (newText !== undefined && newText === previousText) return;
  const radicalShrink =
    newText !== undefined &&
    previousText.length > RADICAL_SHRINK_MIN_PREVIOUS_CHARS &&
    newText.length < previousText.length * RADICAL_SHRINK_FACTOR;
  if (!radicalShrink && Date.now() - (await lastTextSnapshotAt(entryId)) < SNAPSHOT_THROTTLE_MS) {
    return;
  }
  await addTextSnapshot(entryId, previousText);
}

/**
 * Stores a text snapshot unconditionally, bypassing the throttle. The restore
 * flow uses it so that restoring a snapshot is itself undoable: the current
 * text is preserved first.
 */
export async function snapshotText(entryId: number, text: string): Promise<void> {
  await addTextSnapshot(entryId, text);
}

/**
 * Stashes a removed attachment so it can be offered for restore later. The
 * wiring into attachment removal comes with the photos-integration job; this
 * is exposed now and not called anywhere yet.
 */
export async function stashRemovedAttachment(
  entryId: number,
  attachment: HistoryAttachment,
): Promise<number> {
  return db.entryHistory.add({ entryId, at: Date.now(), kind: 'attachment', attachment });
}

/** Delete rows that are past the 48 h retention window. */
async function pruneExpired(): Promise<void> {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  await db.entryHistory.where('at').below(cutoff).delete();
}

/** Cap the number of rows per entry, keeping the newest ones. Iterates per
 * entry (keys-only queries) instead of loading the whole table — history rows
 * can carry attachment blobs once the stash is wired into removal. */
async function pruneOverflow(): Promise<void> {
  const entryIds = await db.entryHistory.orderBy('entryId').uniqueKeys();
  for (const entryId of entryIds) {
    const count = await db.entryHistory.where('entryId').equals(entryId).count();
    const overflow = count - HISTORY_MAX_ROWS_PER_ENTRY;
    if (overflow > 0) {
      // Primary-key order within the index is oldest first, so the deleted
      // rows are the oldest ones and the newest 50 are kept.
      const staleIds = await db.entryHistory
        .where('entryId')
        .equals(entryId)
        .limit(overflow)
        .primaryKeys();
      await db.entryHistory.bulkDelete(staleIds);
    }
  }
}

/** Deletes history rows older than 48 h and caps each entry at 50 rows. */
export async function pruneHistory(): Promise<void> {
  await pruneExpired();
  await pruneOverflow();
}

/** Rows for one entry, newest first, with stale and overflowing rows pruned.
 * Not usable inside a dexie liveQuery querier (writes are forbidden there) —
 * the Verlauf panel filters by retention instead and prunes on mount. */
export async function listHistory(entryId: number): Promise<EntryHistoryRow[]> {
  await pruneHistory();
  return db.entryHistory.where('entryId').equals(entryId).reverse().toArray();
}
