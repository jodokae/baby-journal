/**
 * Persistent-storage helpers. All calls feature-detect the StorageManager API
 * so older Safari versions (before 17) degrade gracefully: the backup view
 * simply hides the affected information.
 */

export interface StorageInfo {
  usageBytes?: number;
  quotaBytes?: number;
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
 * Reads usage/quota and persistence status. Returns null when
 * `navigator.storage.estimate` is unsupported (the whole storage section of
 * the backup view is then hidden).
 */
export async function getStorageInfo(): Promise<StorageInfo | null> {
  const storage = navigator.storage;
  if (!storage?.estimate) return null;
  const estimate = await storage.estimate();
  const persisted = storage.persisted ? await storage.persisted() : undefined;
  return {
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    persisted,
  };
}
