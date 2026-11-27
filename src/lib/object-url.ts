import { useEffect, useState } from 'react';

/**
 * Creates an object URL for the given blob and revokes it on unmount or when
 * the blob changes. StrictMode-safe: the double-invoked effect creates the
 * URL again after revoking the first one, so the last returned URL stays valid.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return url;
}
