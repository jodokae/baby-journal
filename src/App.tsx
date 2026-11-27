import { useState } from 'react';
import BackupView from './components/BackupView';
import CalendarView from './components/CalendarView';
import DayView from './components/DayView';
import { useDailyBackupBanner } from './lib/useDailyBackupBanner';

/**
 * Two screens, a plain state swap: the calendar (default) and the full-screen
 * view of one day. Month and selected day live here so they survive going back.
 * The "Daten & Backup" view and the daily export banner are also calendar-level.
 */
export default function App() {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const banner = useDailyBackupBanner();

  return (
    <main className="app">
      {backupOpen ? (
        <BackupView onBack={() => setBackupOpen(false)} />
      ) : dayOpen && selectedDay ? (
        <DayView day={selectedDay} onBack={() => setDayOpen(false)} />
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
            }}
          />
        </>
      )}
    </main>
  );
}
