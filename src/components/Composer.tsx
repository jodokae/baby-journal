import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { db } from '../db';
import { dayKeyToNoon, toDayKey } from '../lib/dates';

/**
 * Helpers handed to the `micSlot` render prop. `appendText` adds to the entry
 * (trimmed, single-space separated); `setText` replaces the whole entry text —
 * needed so dictation can swap its live transcript for the final transcription
 * without touching anything the user typed around it; `text` is the current
 * entry text.
 */
export interface MicSlotHelpers {
  appendText: (s: string) => void;
  setText: (s: string) => void;
  text: string;
}

interface ComposerProps {
  /** The day the entry belongs to. Today gets Date.now(), any other day (past or future) local noon. */
  day: Date;
  /** Optional slot between textarea and submit button, e.g. the dictation mic. */
  micSlot?: (helpers: MicSlotHelpers) => ReactNode;
}

/**
 * Multi-line input for a new journal entry on the given day. The day screen
 * only renders it when the day has no entry yet, which keeps the model at
 * one entry per day. iOS grows the textarea as the text wraps — no JS
 * auto-resize needed.
 */
export default function Composer({ day, micSlot }: ComposerProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Ref guard so a rapid second submit is rejected synchronously, before
  // any re-render could disable the button.
  const submittingRef = useRef(false);

  const appendText = (s: string) =>
    setText((current) => (current.trim() ? `${current.trimEnd()} ${s.trim()}` : s.trim()));

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const dayKey = toDayKey(day.getTime());
      const createdAt = dayKey === toDayKey(Date.now()) ? Date.now() : dayKeyToNoon(dayKey);
      await db.entries.add({ createdAt, type: 'note', text: trimmed, attachments: [] });
      setText('');
    } finally {
      // Guard must reset even when the add fails, or the composer locks up.
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="composer" onSubmit={addEntry}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Eintrag für diesen Tag …"
        aria-label="Neuer Eintrag"
        maxLength={2000}
        rows={3}
      />
      {micSlot?.({ appendText, setText, text })}
      <button type="submit" disabled={!text.trim() || submitting}>
        Hinzufügen
      </button>
    </form>
  );
}
