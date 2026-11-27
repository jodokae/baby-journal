import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Entry } from '../db';
import { dayKeyToNoon, dayRangeMs, toDayKey } from '../lib/dates';
import { snapshotBeforeOverwrite } from '../lib/history';
import './day-editor.css';

const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Debounce window after the last change before the text is persisted. */
const AUTOSAVE_DELAY_MS = 1000;

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
    const trimmed = value.trim();
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

  /** One code path for every text change: user typing and dictation alike. */
  function updateText(value: string) {
    setTextState(value);
    scheduleSave(value);
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

  return (
    <div className="day-editor">
      <textarea
        value={text}
        onChange={(e) => updateText(e.target.value)}
        placeholder="Eintrag für diesen Tag …"
        aria-label="Eintrag für diesen Tag"
        maxLength={2000}
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
            className="danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={entry === undefined}
          >
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}
