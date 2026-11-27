/**
 * Persistent-storage helpers. All calls feature-detect the StorageManager API
 * so older Safari versions (before 17) degrade gracefully: the backup view
 * simply hides the affected information.
 */

export interface StorageInfo {
  persisted?: boolean;
}

/**
 * Fire-and-forget request for persistent (eviction-protected) storage.
 * Returns the browser's answer, or undefined when the API is unsupported.
 */
export function requestPersistentStorage(): Promise<boolean | undefined> {
  return Promise.resolve(navigator.storage?.persist?.());
}

/**
 * Reads the persistence status. Returns null when the StorageManager's
 * estimate API is unsupported (the whole storage section of the backup view
 * is then hidden); `persisted` stays undefined when `persisted()` itself is
 * unsupported.
 */
export async function getStorageInfo(): Promise<StorageInfo | null> {
  const storage = navigator.storage;
  if (!storage?.estimate) return null;
  const persisted = storage.persisted ? await storage.persisted() : undefined;
  return { persisted };
}
