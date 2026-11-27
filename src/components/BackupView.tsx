import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  exportBackup,
  BackupError,
  EXPORT_ERROR_MESSAGE,
  getLastExportDate,
  isShareCancelled,
  parseBackupFile,
  restoreBackup,
  type BackupFile,
} from '../lib/backup';
import { getStorageInfo, requestPersistentStorage, type StorageInfo } from '../lib/storage';

const dateTimeFormatter = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const mbFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const MB = 1024 * 1024;
const IMPORT_FAILED_MESSAGE = 'Import fehlgeschlagen – bitte erneut versuchen.';

interface BackupViewProps {
  /** Called by the back button to return to the calendar. */
  onBack: () => void;
}

interface Feedback {
  kind: 'success' | 'error';
  text: string;
}

function formatCount(count: number): string {
  return count === 1 ? '1 Eintrag' : `${count} Einträge`;
}

/**
 * Full-screen "Daten & Backup" view: last export, storage usage/persistence
 * plus manual export and import/restore. Import replaces all entries only
 * after an inline confirmation; nothing is touched while the file is invalid.
 */
export default function BackupView({ onBack }: BackupViewProps) {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [lastBackup, setLastBackup] = useState<Date | null>(() => getLastExportDate());
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);
  const [working, setWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getStorageInfo()
      .then((info) => {
        if (!cancelled) setStorageInfo(info);
      })
      .catch(() => {
        // Unsupported or unreadable: keep the storage section hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleExport() {
    if (working) return;
    setWorking(true);
    setFeedback(null);
    try {
      await exportBackup();
      setLastBackup(getLastExportDate());
      setFeedback({ kind: 'success', text: 'Backup erstellt.' });
    } catch (cause) {
      if (!isShareCancelled(cause)) {
        setFeedback({ kind: 'error', text: EXPORT_ERROR_MESSAGE });
      }
    } finally {
      setWorking(false);
    }
  }

  async function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    setFeedback(null);
    try {
      const backup = parseBackupFile(await file.text());
      setPendingImport(backup);
    } catch (cause) {
      setPendingImport(null);
      setFeedback({
        kind: 'error',
        text:
          cause instanceof BackupError ? cause.message : 'Diese Datei konnte nicht gelesen werden.',
      });
    }
  }

  async function confirmImport() {
    if (!pendingImport || working) return;
    setWorking(true);
    setFeedback(null);
    try {
      const count = await restoreBackup(pendingImport);
      setPendingImport(null);
      setFeedback({ kind: 'success', text: `${formatCount(count)} importiert.` });
    } catch {
      // The transaction rolled back, so the database is unchanged.
      setFeedback({ kind: 'error', text: IMPORT_FAILED_MESSAGE });
    } finally {
      setWorking(false);
    }
  }

  async function handleRequestPersistence() {
    if (working) return;
    setWorking(true);
    try {
      await requestPersistentStorage();
      setStorageInfo(await getStorageInfo());
    } catch {
      // Unsupported: the section keeps showing the request button.
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="backup-view">
      <nav className="day-nav" aria-label="Daten & Backup">
        <button type="button" className="back-button" onClick={onBack}>
          ‹ Zurück
        </button>
        <h2 className="day-title">Daten &amp; Backup</h2>
      </nav>

      <section className="backup-section">
        <h3>Letztes Backup</h3>
        <p>{lastBackup ? dateTimeFormatter.format(lastBackup) : 'noch kein Backup'}</p>
      </section>

      {storageInfo && (
        <section className="backup-section">
          <h3>Speicher</h3>
          {storageInfo.usageBytes !== undefined && storageInfo.quotaBytes !== undefined && (
            <p>
              Speicherverbrauch: {mbFormatter.format(storageInfo.usageBytes / MB)} von{' '}
              {mbFormatter.format(storageInfo.quotaBytes / MB)} MB
            </p>
          )}
          {storageInfo.persisted ? (
            <p>Speicher ist beständig ✓</p>
          ) : (
            <button type="button" onClick={handleRequestPersistence} disabled={working}>
              Beständigen Speicher anfordern
            </button>
          )}
        </section>
      )}

      <div className="backup-actions">
        <button type="button" onClick={handleExport} disabled={working}>
          Backup jetzt erstellen
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={working}>
          Backup importieren
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFilePicked}
          hidden
        />
      </div>

      {pendingImport && (
        <div className="delete-confirm">
          <p>
            Bestehende Einträge werden gelöscht und durch das Backup ersetzt (
            {formatCount(pendingImport.entries.length)}). Wirklich importieren?
          </p>
          <div className="day-actions">
            <button type="button" className="danger" onClick={confirmImport} disabled={working}>
              Ja, importieren
            </button>
            <button type="button" onClick={() => setPendingImport(null)} disabled={working}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <p
          className={`backup-message ${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
