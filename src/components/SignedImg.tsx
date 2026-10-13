import type { ImgHTMLAttributes } from "react";
import { useSignedUrlState } from "@/hooks/useSignedUrl";
import type { StorageBucket } from "@/lib/storageUrls";

interface SignedImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  bucket: StorageBucket;
  path: string | null | undefined;
}

/**
 * Drop-in replacement for <img src={photo_url}> now that storage paths are
 * private. Resolves the path to a short-lived signed URL (remembered and
 * batched, see lib/storageUrls.ts).
 *
 * - While the link is on its way it draws a same-sized grey block, so the
 *   page doesn't jump when the photo appears.
 * - Renders nothing if there's no path, or if a link couldn't be made.
 * - Photos load lazily (only when near the screen) and decode off the main
 *   thread. Callers can still override `loading` / `decoding`.
 * - If a remembered link has gone stale and the photo fails to load, it gets
 *   one fresh link automatically.
 */
export function SignedImg({
  bucket,
  path,
  className,
  onError,
  loading,
  decoding,
  ...imgProps
}: SignedImgProps) {
  const { url, pending, refresh } = useSignedUrlState(bucket, path);
  if (!path) return null;
  if (!url) {
    return pending ? (
      <span aria-hidden="true" className={`${className ?? ""} inline-block bg-muted`} />
    ) : null;
  }
  return (
    <img
      src={url}
      loading={loading ?? "lazy"}
      decoding={decoding ?? "async"}
      className={className}
      onError={(e) => {
        refresh();
        onError?.(e);
      }}
      {...imgProps}
    />
  );
}
