import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DayPicker } from 'react-day-picker';
import { de } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import './calendar.css';
import { db } from '../db';
import { daysWithEntries, groupEntriesByDay } from '../lib/calendar-query';
import { monthRangeMs } from '../lib/dates';

const monthFormatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

interface CalendarViewProps {
  /** Displayed month; controlled so it survives a round-trip to the day view. */
  month: Date;
  onMonthChange: (month: Date) => void;
  /** The highlighted day (the one last tapped), or null. */
  selectedDay: Date | null;
  /** Called when the user taps a day; App opens the full-screen day view. */
  onDaySelect: (day: Date) => void;
}

/** Calendar screen: month grid with entry dots. Tapping a day opens the day view. */
export default function CalendarView({
  month,
  onMonthChange,
  selectedDay,
  onDaySelect,
}: CalendarViewProps) {
  const { start, end } = monthRangeMs(month.getFullYear(), month.getMonth());
  const monthEntries = useLiveQuery(
    () => db.entries.where('createdAt').between(start, end, true, false).toArray(),
    [start, end],
  );

  const entriesByDay = useMemo(() => groupEntriesByDay(monthEntries ?? []), [monthEntries]);
  const entryDays = useMemo(() => daysWithEntries(entriesByDay), [entriesByDay]);

  function shiftMonth(delta: number) {
    onMonthChange(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  }

  function goToToday() {
    onMonthChange(new Date());
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
      </div>

      <DayPicker
        mode="single"
        locale={de}
        month={month}
        onMonthChange={onMonthChange}
        selected={selectedDay ?? undefined}
        // Selection is purely the visual highlight, driven by the prop:
        // providing onSelect keeps DayPicker controlled, so its internal
        // single-mode toggle can never clear or drift the highlight.
        onSelect={() => {}}
        // Navigation fires on every tap — including a second tap on the
        // already-selected day, which must reopen the day view. (onSelect
        // would only see an `undefined` toggle-off there and drop the tap.)
        onDayClick={(day) => onDaySelect(day)}
        fixedWeeks
        showOutsideDays={false}
        hideNavigation
        modifiers={{ hasEntries: entryDays }}
        modifiersClassNames={{ hasEntries: 'has-entries' }}
      />

      <div className="calendar-footer">
        <button type="button" className="today-button" onClick={goToToday}>
          Heute
        </button>
      </div>
    </section>
  );
}
