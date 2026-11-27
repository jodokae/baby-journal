import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Entry } from './db';
import Composer from './components/Composer';

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

type Tab = 'journal' | 'calendar';

export default function App() {
  const [tab, setTab] = useState<Tab>('journal');
  const entries = useLiveQuery(() => db.entries.orderBy('createdAt').reverse().toArray(), []);

  return (
    <main className="app">
      <header className="header">
        <h1>🍼 Baby-Tagebuch</h1>
        <p className="date">{dateFormatter.format(new Date())}</p>
      </header>

      <nav className="tabs" role="tablist" aria-label="Bereiche">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'journal'}
          className="tab"
          onClick={() => setTab('journal')}
        >
          Journal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'calendar'}
          className="tab"
          onClick={() => setTab('calendar')}
        >
          Kalender
        </button>
      </nav>

      {tab === 'journal' ? (
        <>
          <Composer />
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
        </>
      ) : null}
    </main>
  );
}
