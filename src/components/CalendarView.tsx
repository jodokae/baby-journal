import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DayPicker } from 'react-day-picker';
import { de } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { db } from '../db';
import { daysWithEntries, groupEntriesByDay } from '../lib/calendar-query';
import { monthRangeMs, toDayKey } from '../lib/dates';

const monthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const dayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** Calendar tab: month grid with entry dots and a read-only list of the selected day. */
export default function CalendarView() {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<Date | undefined>(() => new Date());

  const { start, end } = monthRangeMs(month.getFullYear(), month.getMonth());
  const monthEntries = useLiveQuery(
    () => db.entries.where('createdAt').between(start, end, true, false).toArray(),
    [start, end],
  );

  const entriesByDay = useMemo(() => groupEntriesByDay(monthEntries ?? []), [monthEntries]);
  const entryDays = useMemo(() => daysWithEntries(entriesByDay), [entriesByDay]);

  const selectedKey = selected ? toDayKey(selected.getTime()) : undefined;
  const selectedEntries = selectedKey ? (entriesByDay.get(selectedKey) ?? []) : [];

  function shiftMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  }

  function goToToday() {
    const now = new Date();
    setMonth(now);
    setSelected(now);
  }

  return (
    <section aria-label="Kalender" className="calendar">
      <div className="calendar-header">
        <button type="button" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <h2>{monthFormatter.format(month)}</h2>
        <button type="button" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}>
          ›
        </button>
        <button type="button" className="today-button" onClick={goToToday}>
          Heute
        </button>
      </div>

      <DayPicker
        mode="single"
        locale={de}
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={setSelected}
        fixedWeeks
        showOutsideDays={false}
        hideNavigation
        modifiers={{ hasEntries: entryDays }}
        modifiersClassNames={{ hasEntries: 'has-entries' }}
      />

      {selected && (
        <section aria-label="Einträge am ausgewählten Tag" className="day-entries">
          <h3>{dayFormatter.format(selected)}</h3>
          {selectedEntries.length === 0 ? (
            <p className="empty">Keine Einträge an diesem Tag.</p>
          ) : (
            <ul className="entries">
              {selectedEntries.map((entry) => (
                <li key={entry.id} className="entry">
                  <time>{timeFormatter.format(entry.createdAt)}</time>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
