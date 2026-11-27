import { useState, type FormEvent, type ReactNode } from 'react';
import { db } from '../db';

interface ComposerProps {
  /** Optional element rendered at the start of the composer row (e.g. an event-type picker). */
  leftSlot?: ReactNode;
  /** Optional element rendered between input and submit button (e.g. a microphone button). */
  micSlot?: ReactNode;
}

/** Input row for a new journal entry. Self-contained; slots extend it without changing the default UI. */
export default function Composer({ leftSlot, micSlot }: ComposerProps) {
  const [text, setText] = useState('');

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    await db.entries.add({ createdAt: Date.now(), type: 'note', text: trimmed, attachments: [] });
    setText('');
  }

  return (
    <form className="composer" onSubmit={addEntry}>
      {leftSlot}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Notiz für heute …"
        aria-label="Neue Notiz"
        maxLength={500}
      />
      {micSlot}
      <button type="submit" disabled={!text.trim()}>
        Hinzufügen
      </button>
    </form>
  );
}
