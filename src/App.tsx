import { useEffect, useState } from 'react';
import BackupView from './components/BackupView';
import CalendarView from './components/CalendarView';
import DayView from './components/DayView';
import MicButton from './components/MicButton';
import { dayKeyToNoon, toDayKey } from './lib/dates';
import { pruneHistory } from './lib/history';
import { useDailyBackupBanner } from './lib/useDailyBackupBanner';

/**
 * Session-scoped persistence of the open day: a page reload (dev-server dep
 * reload, service-worker autoUpdate, plain F5) must not kick the user out of
 * the day view they were in. Only the day selection is restored — the month
 * and the backup view stay session state. Cleared by the day view's back
 * button, so a reload of the calendar opens the calendar.
 */
const SELECTED_DAY_KEY = 'selectedDay';

function restoreSelectedDay(): Date | null {
  const key = sessionStorage.getItem(SELECTED_DAY_KEY);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return new Date(dayKeyToNoon(key));
}

/**
 * Two screens, a plain state swap: the calendar (default) and the full-screen
 * view of one day. Month and selected day live here so they survive going back.
 * The "Daten & Backup" view and the daily export banner are also calendar-level.
 */
export default function App() {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(restoreSelectedDay);
  // A stored day key implies the day view was open — restore both together.
  const [dayOpen, setDayOpen] = useState(() => restoreSelectedDay() !== null);
  const [backupOpen, setBackupOpen] = useState(false);
  const banner = useDailyBackupBanner();

  // Opportunistic housekeeping: drop undo-history rows older than 48 h once
  // per app open (listing history prunes again before it shows rows).
  useEffect(() => {
    void pruneHistory();
  }, []);

  return (
    <main className="app">
      {backupOpen ? (
        <BackupView onBack={() => setBackupOpen(false)} />
      ) : dayOpen && selectedDay ? (
        <DayView
          day={selectedDay}
          onBack={() => {
            setDayOpen(false);
            sessionStorage.removeItem(SELECTED_DAY_KEY);
          }}
          micSlot={(helpers) => <MicButton {...helpers} />}
        />
      ) : (
        <>
          <header className="header">
            <div className="header-row">
              <h1>🍼 Baby-Tagebuch</h1>
              <button
                type="button"
                className="icon-button"
                aria-label="Daten & Backup"
                onClick={() => setBackupOpen(true)}
              >
                💾
              </button>
            </div>
          </header>
          {banner.visible && (
            <div className="backup-banner" role="status">
              <div className="backup-banner-main">
                <p>Backup fällig – Einträge sichern</p>
                <div className="backup-banner-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={banner.exportNow}
                    disabled={banner.exporting}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className="dismiss"
                    aria-label="Später"
                    onClick={banner.dismiss}
                  >
                    ✕
                  </button>
                </div>
              </div>
              {banner.error && (
                <p className="backup-banner-error" role="alert">
                  {banner.error}
                </p>
              )}
            </div>
          )}
          <CalendarView
            month={month}
            onMonthChange={setMonth}
            selectedDay={selectedDay}
            onDaySelect={(day) => {
              setSelectedDay(day);
              setDayOpen(true);
              sessionStorage.setItem(SELECTED_DAY_KEY, toDayKey(day.getTime()));
            }}
          />
        </>
      )}
    </main>
  );
}
