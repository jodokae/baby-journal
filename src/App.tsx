import { useEffect, useState } from 'react';
import BackupView from './components/BackupView';
import CalendarView from './components/CalendarView';
import { ConfirmDialog } from './components/ConfirmDialog';
import DayView from './components/DayView';
import MicButton from './components/MicButton';
import './components/app-header.css';
import { dayKeyToNoon, toDayKey } from './lib/dates';
import { pruneHistory } from './lib/history';
import { useDailyBackupBanner } from './lib/useDailyBackupBanner';

/** Hint shown in the daily backup dialog while no export is running. */
const BACKUP_DUE_MESSAGE =
  'Dein Tagebuch liegt nur auf diesem Gerät – sichere es als Datei in der Dateien-App.';

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
 * The "Daten & Backup" view and the daily backup dialog are also calendar-level.
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
                className="icon-action header-action"
                aria-label="Daten & Backup"
                onClick={() => setBackupOpen(true)}
              >
                💾
              </button>
            </div>
          </header>
          {banner.visible && (
            <ConfirmDialog
              title="Backup fällig"
              /* An export error replaces the hint inside the open dialog. */
              message={banner.error ?? BACKUP_DUE_MESSAGE}
              confirmLabel={banner.exporting ? 'Exportiere …' : 'Export'}
              cancelLabel="Später"
              tone="primary"
              onConfirm={() => {
                // The hook no-ops while an export is running.
                void banner.exportNow();
              }}
              onCancel={banner.dismiss}
            />
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
