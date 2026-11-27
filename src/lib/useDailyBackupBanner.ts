import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import {
  dismissBackupBannerForToday,
  exportBackup,
  EXPORT_ERROR_MESSAGE,
  getBackupBannerState,
  isShareCancelled,
} from './backup';

export interface DailyBackupBanner {
  visible: boolean;
  exporting: boolean;
  error: string | null;
  exportNow: () => Promise<void>;
  dismiss: () => void;
}

/**
 * State of the daily export dialog on the calendar screen: "visible" follows
 * the stored daily markers (`getBackupBannerState`) whenever the entry count
 * changes; a successful export or a dismiss („Später“) hides it immediately
 * and persists the decision for the rest of the day. A failed export keeps
 * the dialog open with `error` set.
 */
export function useDailyBackupBanner(): DailyBackupBanner {
  const entryCount = useLiveQuery(() => db.entries.count(), [], 0);
  const [visible, setVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVisible(getBackupBannerState(entryCount > 0));
  }, [entryCount]);

  const exportNow = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      await exportBackup();
      setVisible(false);
    } catch (cause) {
      if (!isShareCancelled(cause)) setError(EXPORT_ERROR_MESSAGE);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const dismiss = useCallback(() => {
    dismissBackupBannerForToday();
    setVisible(false);
  }, []);

  return { visible, exporting, error, exportNow, dismiss };
}
