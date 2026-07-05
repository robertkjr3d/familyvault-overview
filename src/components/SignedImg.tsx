import type { ImgHTMLAttributes } from "react";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import type { StorageBucket } from "@/lib/storageUrls";

interface SignedImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  bucket: StorageBucket;
  path: string | null | undefined;
}

/**
 * Drop-in replacement for <img src={photo_url}> now that storage paths are
 * private. Resolves the path to a short-lived signed URL and renders
 * nothing while that's in flight (renders nothing at all if there's no path).
 */
export function SignedImg({ bucket, path, ...imgProps }: SignedImgProps) {
  const url = useSignedUrl(bucket, path);
  if (!url) return null;
  return <img src={url} {...imgProps} />;
}
