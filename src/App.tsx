import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Entry } from './db';

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

export default function App() {
  const [text, setText] = useState('');
  const entries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().toArray(), []);

  async function addEntry(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    await db.entries.add({ createdAt: Date.now(), type: 'note', text: trimmed, attachments: [] });
    setText('');
  }

  return (
    <main className="app">
      <header className="header">
        <h1>🍼 Baby-Tagebuch</h1>
        <p className="date">{dateFormatter.format(new Date())}</p>
      </header>

      <form className="composer" onSubmit={addEntry}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Notiz für heute …"
          aria-label="Neue Notiz"
          maxLength={500}
        />
        <button type="submit" disabled={!text.trim()}>
          Hinzufügen
        </button>
      </form>

      <section aria-label="Einträge">
        {entries === undefined ? (
          <p className="empty">Lade …</p>
        ) : entries.length === 0 ? (
          <p className="empty">Noch keine Einträge – schreib die erste Notiz.</p>
        ) : (
          <ul className="entries">
            {entries.map((entry: Entry) => (
              <li key={entry.id} className="entry">
                <time>{timeFormatter.format(entry.createdAt)}</time>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
