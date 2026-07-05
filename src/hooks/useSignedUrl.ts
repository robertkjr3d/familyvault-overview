import { useEffect, useState } from "react";
import { getDisplayUrl, type StorageBucket } from "@/lib/storageUrls";

/**
 * Resolves a stored storage path into a short-lived, working display URL.
 * Re-fetches whenever the path changes. Returns null while loading or if
 * there's no path.
 */
export function useSignedUrl(bucket: StorageBucket, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    getDisplayUrl(bucket, path).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  return url;
}
