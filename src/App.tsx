import { useState } from 'react';
import CalendarView from './components/CalendarView';
import DayView from './components/DayView';

const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Two screens, a plain state swap: the calendar (default) and the full-screen
 * view of one day. Month and selected day live here so they survive going back.
 */
export default function App() {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayOpen, setDayOpen] = useState(false);

  return (
    <main className="app">
      {dayOpen && selectedDay ? (
        <DayView day={selectedDay} onBack={() => setDayOpen(false)} />
      ) : (
        <>
          <header className="header">
            <h1>🍼 Baby-Tagebuch</h1>
            <p className="date">{dateFormatter.format(new Date())}</p>
          </header>
          <CalendarView
            month={month}
            onMonthChange={setMonth}
            selectedDay={selectedDay}
            onDaySelect={(day) => {
              setSelectedDay(day);
              setDayOpen(true);
            }}
          />
        </>
      )}
    </main>
  );
}
