import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Attachment, type Entry, type EntryHistoryRow } from '../db';
import { dayKeyToNoon, dayRangeMs, toDayKey } from '../lib/dates';
import {
  HISTORY_RETENTION_MS,
  pruneHistory,
  snapshotBeforeOverwrite,
  snapshotText,
} from '../lib/history';
import { ingestImages, type IngestError } from '../lib/ingest';
import { SUPPORTED_ACCEPT } from '../lib/media';
import { AttachmentStrip } from './AttachmentStrip';
import { Lightbox } from './Lightbox';
import './day-editor.css';

const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Debounce window after the last change before the text is persisted. */
const AUTOSAVE_DELAY_MS = 1000;

/** Same cap as the textarea's maxLength — enforced in code for programmatic text. */
const MAX_TEXT_LENGTH = 2000;

interface DayViewProps {
  /** The day this screen shows. */
  day: Date;
  /** Called by the back button to return to the calendar. */
  onBack: () => void;
  /**
   * Dictation slot (contract with the parallel voice job): a render prop
   * placed between the textarea and the action row. Its helpers are wired to
   * the editor's text state — `appendText` appends transcript text,
   * `setText` replaces it (the final Whisper transcription replaces the live
   * dictated text), and both behave exactly like a user edit: they update
   * the state and reschedule the debounced auto-save. `text` passes the
   * current editor content, e.g. so the mic button can manage its live text.
   */
  micSlot?: (helpers: {
    appendText: (s: string) => void;
    setText: (s: string) => void;
    text: string;
  }) => ReactNode;
}

/**
 * Full-screen editor for a single day: ONE always-editable textarea, no
 * view/edit toggle — the text auto-saves about a second after the last
 * change, for any day, past, today or future.
 */
export default function DayView({ day, onBack, micSlot }: DayViewProps) {
  const { start, end } = dayRangeMs(day);
  const entries = useLiveQuery(
    () => db.entries.where('createdAt').between(start, end, true, false).toArray(),
    [start, end],
  );
  const entry = entries?.[0];

  return (
    <div className="day-view">
      <nav className="day-nav" aria-label="Tagesansicht">
        <button type="button" className="back-button" onClick={onBack}>
          ‹ Zurück
        </button>
        <h2 className="day-title">{dayFormatter.format(day)}</h2>
      </nav>

      {entries === undefined ? (
        <p className="empty">Lade …</p>
      ) : (
        // Keyed by the day so a day switch always starts from fresh editor state.
        <DayEditor key={toDayKey(day.getTime())} day={day} entry={entry} micSlot={micSlot} />
      )}
    </div>
  );
}

interface DayEditorProps {
  day: Date;
  entry: Entry | undefined;
  micSlot?: DayViewProps['micSlot'];
}

/**
 * The always-editable editor itself. Every write for the day runs through
 * one serialized chain — saves never overlap, an empty day can therefore
 * never receive two entries, and leaving the screen flushes pending text.
 */
function DayEditor({ day, entry, micSlot }: DayEditorProps) {
  // Initialized once from the loaded entry (or empty); afterwards the state
  // is only changed by edits — never echoed back from the database.
  const [text, setTextState] = useState(() => entry?.text ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Photo ingestion: true while ingestImages (plus the follow-up write) runs.
  const [ingesting, setIngesting] = useState(false);
  // Per-file errors of the LAST ingest only — not global state. The next
  // ingest replaces them (an error-free ingest clears the list).
  const [ingestErrors, setIngestErrors] = useState<IngestError[]>([]);
  // Index of the photo shown in the lightbox, resolved against the CURRENT
  // attachments on every render (`attachments[index] ?? null`): when the
  // array changed underneath, an out-of-range index closes the lightbox
  // instead of showing the wrong photo.
  const [openPhotoIndex, setOpenPhotoIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Rows of undo history for this entry within the retention window; 0 while
  // the query has not delivered yet (and for days without an entry).
  const historyCount = useLiveQuery(async () => {
    if (entry?.id === undefined) return 0;
    return db.entryHistory
      .where('entryId')
      .equals(entry.id)
      .filter((row) => row.at >= Date.now() - HISTORY_RETENTION_MS)
      .count();
  }, [entry?.id]);

  // Latest text outside the render cycle: the debounced save, the unmount
  // flush and the dictation helpers read it synchronously.
  const textRef = useRef(text);
  // Serializes every write for this day (saves, deletes, restores).
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const debounceRef = useRef<number | null>(null);

  function enqueueWrite(write: () => Promise<void>) {
    const run = writeChainRef.current.then(write).catch((error) => {
      console.error('Tageseintrag konnte nicht gespeichert werden', error);
    });
    writeChainRef.current = run;
    return run;
  }

  async function persistText(value: string) {
    // Last line of defense for the length cap: typed input is capped by the
    // DOM, programmatic text (dictation) is clamped here as well.
    const trimmed = value.trim().slice(0, MAX_TEXT_LENGTH);
    const { start, end } = dayRangeMs(day);
    // Fresh read instead of the possibly stale liveQuery value: a previous
    // save in the chain may have created the entry in the meantime.
    const existing = await db.entries.where('createdAt').between(start, end, true, false).first();
    if (existing) {
      // An entry exists and stays: whitespace-only text never deletes or
      // rewrites it (user decision: an empty entry remains), and identical
      // text is a no-op.
      if (!trimmed || trimmed === existing.text || existing.id === undefined) return;
      // Undo history: capture the previous text before it is overwritten.
      await snapshotBeforeOverwrite(existing.id, existing.text, trimmed);
      // Only the text changes — createdAt anchors the entry to its day.
      await db.entries.update(existing.id, { text: trimmed });
    } else if (trimmed) {
      // Create the day's one entry. Today keeps Date.now(), any other day
      // (past or future) is anchored at local noon.
      const dayKey = toDayKey(day.getTime());
      const createdAt = dayKey === toDayKey(Date.now()) ? Date.now() : dayKeyToNoon(dayKey);
      await db.entries.add({ createdAt, type: 'note', text: trimmed, attachments: [] });
    }
  }

  function scheduleSave(value: string) {
    textRef.current = value;
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void enqueueWrite(() => persistText(textRef.current));
    }, AUTOSAVE_DELAY_MS);
  }

  function cancelPendingSave() {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  /**
   * One code path for every text change: user typing and dictation alike.
   * Clamped to the same cap as the textarea's DOM maxlength, which only
   * covers typed input — programmatic text (appends and setText replacing a
   * transcript) must not diverge from what persistText will store.
   */
  function updateText(value: string) {
    const clamped = value.slice(0, MAX_TEXT_LENGTH);
    setTextState(clamped);
    scheduleSave(clamped);
  }

  /** Dictation helper: appends transcript text to the current content. */
  function appendText(appended: string) {
    updateText(textRef.current + appended);
  }

  // Flush on unmount (back button): nothing typed is lost even when the
  // debounce has not fired yet. Fire-and-forget — the write chain serializes
  // it behind any save still in flight.
  useEffect(() => {
    return () => {
      cancelPendingSave();
      void enqueueWrite(() => persistText(textRef.current));
    };
    // Captures this instance's refs and `day`, all stable for a mounted
    // editor; reading the latest text goes through textRef.
  }, []);

  function deleteEntry() {
    if (entry?.id === undefined) return;
    // Drop the stale text immediately: a pending auto-save must not
    // re-create the deleted entry.
    cancelPendingSave();
    textRef.current = '';
    setTextState('');
    setConfirmingDelete(false);
    const id = entry.id;
    // Serialized behind any in-flight save, so nothing writes to a deleted entry.
    void enqueueWrite(() => db.entries.delete(id));
  }

  /**
   * Appends ingested photos to the day's entry — creating it when the day has
   * none (empty text is fine; a photo-only entry shows textarea + tiles).
   * Runs through the serialized write chain with a fresh read, exactly like
   * persistText: it can never race a pending save into a second entry.
   */
  function appendPhotos(photos: Attachment[]): Promise<void> {
    if (photos.length === 0) return Promise.resolve();
    const { start, end } = dayRangeMs(day);
    return enqueueWrite(async () => {
      const existing = await db.entries.where('createdAt').between(start, end, true, false).first();
      if (existing && existing.id !== undefined) {
        await db.entries.update(existing.id, {
          attachments: [...(existing.attachments ?? []), ...photos],
        });
      } else {
        // Same createdAt mapping as the text path: today keeps Date.now(),
        // any other day (past or future) is anchored at local noon.
        const dayKey = toDayKey(day.getTime());
        const createdAt = dayKey === toDayKey(Date.now()) ? Date.now() : dayKeyToNoon(dayKey);
        await db.entries.add({ createdAt, type: 'note', text: '', attachments: photos });
      }
    });
  }

  /** Ingests the picked files, reports per-file errors and stores the photos. */
  async function handleFilesPicked(files: File[]): Promise<void> {
    if (ingesting || files.length === 0) return;
    setIngesting(true);
    try {
      const result = await ingestImages(files);
      setIngestErrors(result.errors);
      await appendPhotos(result.photos);
    } finally {
      setIngesting(false);
    }
  }

  /**
   * Restores a text snapshot: replaces the editor content with the snapshot
   * text — after snapshotting the entry's stored text, so restoring is itself
   * undoable. Serialized through the write chain like every other write.
   */
  function restoreTextRow(row: EntryHistoryRow) {
    if (entry?.id === undefined) return;
    const restored = row.text ?? '';
    setHistoryOpen(false);
    if (restored === textRef.current.trim()) return; // editor stays as it is
    cancelPendingSave();
    textRef.current = restored;
    setTextState(restored);
    const id = entry.id;
    void enqueueWrite(async () => {
      // Snapshot the STORED text, not the editor text: the two can diverge
      // (e.g. the editor was cleared to whitespace, which never rewrites the
      // entry). Skipping the snapshot here would destroy the stored text
      // without any history row to undo the restore with.
      const stored = (await db.entries.get(id))?.text ?? '';
      if (stored && stored !== restored) await snapshotText(id, stored);
      await db.entries.update(id, { text: restored });
    });
  }

  return (
    <div className="day-editor">
      <textarea
        value={text}
        onChange={(e) => updateText(e.target.value)}
        placeholder="Eintrag für diesen Tag …"
        aria-label="Eintrag für diesen Tag"
        maxLength={MAX_TEXT_LENGTH}
        rows={3}
        autoFocus
      />
      {/*
        Dictation slot — the contract is documented on DayViewProps.micSlot:
        rendered between the textarea and the action row; appendText appends
        the transcript, setText replaces the live dictated text with the final
        transcription, both reschedule the auto-save like a user edit.
      */}
      {micSlot?.({ appendText, setText: updateText, text })}
      {/*
        Current attachments of the entry (read-only while ingesting: pending
        files only surface through the status line below until the write
        lands and the liveQuery refreshes the strip).
      */}
      <AttachmentStrip attachments={entry?.attachments ?? []} onOpen={setOpenPhotoIndex} />
      {ingesting && (
        <p className="ingest-status" role="status">
          Fotos werden verarbeitet …
        </p>
      )}
      {ingestErrors.length > 0 && (
        <ul className="ingest-errors" role="alert">
          {ingestErrors.map((error) => (
            <li key={error.fileName}>
              {error.fileName}: {error.message}
            </li>
          ))}
        </ul>
      )}
      {confirmingDelete ? (
        <div className="delete-confirm">
          <p>Wirklich löschen?</p>
          <div className="day-actions">
            <button type="button" className="danger" onClick={deleteEntry}>
              Ja, löschen
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <div className="day-actions">
          <button
            type="button"
            aria-label="Foto hinzufügen"
            title="Foto hinzufügen"
            disabled={ingesting}
            onClick={() => fileInputRef.current?.click()}
          >
            <span aria-hidden="true">📎</span>
          </button>
          {historyCount ? (
            <button type="button" onClick={() => setHistoryOpen(true)}>
              Verlauf
            </button>
          ) : null}
          <button
            type="button"
            className="danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={entry === undefined}
          >
            Löschen
          </button>
        </div>
      )}
      {historyOpen && entry?.id !== undefined && (
        <HistoryPanel
          entryId={entry.id}
          onClose={() => setHistoryOpen(false)}
          onRestore={restoreTextRow}
        />
      )}
      {/*
        Hidden picker: opened by the 📎 button above. The value is reset
        immediately after reading the files so re-picking the same file
        fires another change event.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          event.target.value = '';
          void handleFilesPicked(picked);
        }}
      />
      {/*
        Full-screen view of the tapped photo, resolved against the CURRENT
        attachments (see openPhotoIndex): a removed photo closes the lightbox
        instead of showing the wrong one.
      */}
      <Lightbox
        attachment={
          openPhotoIndex === null ? null : ((entry?.attachments ?? [])[openPhotoIndex] ?? null)
        }
        onClose={() => setOpenPhotoIndex(null)}
      />
    </div>
  );
}

const historyTimestampFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function attachmentLabel(kind: string | undefined): string {
  return kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'Foto';
}

/** First ~80 characters of a snapshot for the history list. */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

interface HistoryPanelProps {
  entryId: number;
  onClose: () => void;
  onRestore: (row: EntryHistoryRow) => void;
}

/**
 * Inline Verlauf panel: the entry's text snapshots (tap to restore) and
 * stashed attachments (informational until the photos integration wires
 * their restore).
 */
function HistoryPanel({ entryId, onClose, onRestore }: HistoryPanelProps) {
  // Pure read: dexie forbids readwrite transactions inside a liveQuery
  // querier, so stale rows are filtered here and physically pruned below.
  const rows = useLiveQuery(async () => {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    return db.entryHistory
      .where('entryId')
      .equals(entryId)
      .filter((row) => row.at >= cutoff)
      .reverse()
      .toArray();
  }, [entryId]);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Prune on mount ("before listing"), outside the querier context.
  useEffect(() => {
    void pruneHistory();
  }, []);

  // Minimal focus handling: start keyboard focus on the close button.
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <section className="history-panel" aria-label="Verlauf">
      <div className="history-head">
        <h3>Verlauf</h3>
        <button
          type="button"
          ref={closeButtonRef}
          className="history-close"
          onClick={onClose}
          aria-label="Verlauf schließen"
        >
          Schließen
        </button>
      </div>
      {rows === undefined ? (
        <p className="history-empty">Lade …</p>
      ) : rows.length === 0 ? (
        <p className="history-empty">Keine gespeicherten früheren Versionen.</p>
      ) : (
        <ul className="history-list">
          {rows.map((row) =>
            row.kind === 'text' ? (
              <li key={row.id}>
                <button
                  type="button"
                  className="history-row"
                  aria-label={`Version vom ${historyTimestampFormatter.format(row.at)} wiederherstellen`}
                  onClick={() => onRestore(row)}
                >
                  <time dateTime={new Date(row.at).toISOString()}>
                    {historyTimestampFormatter.format(row.at)}
                  </time>
                  <span className="history-preview">{preview(row.text ?? '')}</span>
                </button>
              </li>
            ) : (
              <li key={row.id}>
                <div className="history-row history-attachment">
                  <time dateTime={new Date(row.at).toISOString()}>
                    {historyTimestampFormatter.format(row.at)}
                  </time>
                  <span className="history-preview">
                    Anhang ({attachmentLabel(row.attachment?.kind)})
                  </span>
                  <span className="history-note">Wiederherstellen folgt</span>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
