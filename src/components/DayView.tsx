import { useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { dayRangeMs } from '../lib/dates';
import './day-view.css';
import Composer from './Composer';

const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

interface DayViewProps {
  /** The day this screen shows. */
  day: Date;
  /** Called by the back button to return to the calendar. */
  onBack: () => void;
}

/**
 * Full-screen view of a single day: shows its one entry for reading, editing
 * and deleting, or offers the composer when the day has none — for any day,
 * past, today or future.
 */
export default function DayView({ day, onBack }: DayViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  // Ref guard so a rapid second submit is rejected synchronously, before
  // any re-render could disable the button.
  const savingRef = useRef(false);

  const { start, end } = dayRangeMs(day);
  const entries = useLiveQuery(
    () => db.entries.where('createdAt').between(start, end, true, false).toArray(),
    [start, end],
  );

  const entry = entries?.[0];

  function startEditing() {
    setDraft(entry?.text ?? '');
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setDraft('');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!entry?.id || !trimmed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Only the text changes — createdAt anchors the entry to its day.
      await db.entries.update(entry.id, { text: trimmed });
      cancelEditing();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deleteEntry() {
    if (!entry?.id) return;
    await db.entries.delete(entry.id);
    setConfirmingDelete(false);
  }

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
      ) : entry ? (
        editing ? (
          <form className="day-edit" onSubmit={saveEdit}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Eintrag bearbeiten"
              maxLength={2000}
              rows={3}
              autoFocus
            />
            <div className="day-actions">
              <button type="submit" disabled={!draft.trim() || saving}>
                Speichern
              </button>
              <button type="button" onClick={cancelEditing}>
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <>
            <article className="day-reading">
              <time>{timeFormatter.format(entry.createdAt)}</time>
              <p>{entry.text}</p>
            </article>
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
                <button type="button" onClick={startEditing}>
                  Bearbeiten
                </button>
                <button type="button" className="danger" onClick={() => setConfirmingDelete(true)}>
                  Löschen
                </button>
              </div>
            )}
          </>
        )
      ) : (
        <Composer day={day} />
      )}
    </div>
  );
}
