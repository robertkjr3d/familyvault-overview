import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCachedDisplayUrl,
  invalidateCachedDisplayUrl,
  peekCachedDisplayUrl,
  type StorageBucket,
} from "@/lib/storageUrls";

/**
 * Resolves a stored storage path into a short-lived, working display URL.
 *
 * - If the link is already remembered, it is available on the very first
 *   render (no blank flash, no waiting).
 * - Otherwise it is fetched together with any other photos asked for at the
 *   same moment (one request, not one per photo).
 * - `pending` is true only while a link is genuinely on its way, so callers
 *   can show a placeholder; it is false if there's no path or signing failed.
 * - `refresh()` throws away a remembered link and gets a new one. It runs at
 *   most once per path, so a photo that really is gone can't cause a loop.
 */
export function useSignedUrlState(bucket: StorageBucket, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(() => peekCachedDisplayUrl(bucket, path));
  const [pending, setPending] = useState<boolean>(
    () => !!path && !peekCachedDisplayUrl(bucket, path),
  );
  const refreshedForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      setPending(false);
      return;
    }
    const cached = peekCachedDisplayUrl(bucket, path);
    if (cached) {
      setUrl(cached);
      setPending(false);
      return;
    }
    setPending(true);
    getCachedDisplayUrl(bucket, path).then((signed) => {
      if (cancelled) return;
      setUrl(signed);
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  const refresh = useCallback(() => {
    if (!path || refreshedForRef.current === `${bucket}:${path}`) return;
    refreshedForRef.current = `${bucket}:${path}`;
    invalidateCachedDisplayUrl(bucket, path);
    getCachedDisplayUrl(bucket, path).then((signed) => {
      if (signed) setUrl(signed);
    });
  }, [bucket, path]);

  return { url, pending, refresh };
}

/** Backwards-compatible: just the URL (null while loading or if there's no path). */
export function useSignedUrl(bucket: StorageBucket, path: string | null | undefined) {
  return useSignedUrlState(bucket, path).url;
}
