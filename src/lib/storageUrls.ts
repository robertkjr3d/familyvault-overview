import { supabase } from "@/integrations/supabase/client";

/**
 * Storage buckets are private. A stored "photo_url" / "url" column now holds
 * the raw storage PATH (e.g. "<household_id>/items/169...-photo.jpg"), not a
 * resolved URL. Call these helpers to turn a path into a working link.
 *
 * - Display links (used inside the app: thumbnails, lightbox, view/download
 *   buttons) are short-lived and re-generated every time the page renders.
 *   If one ever leaked (screenshot, browser cache) it stops working quickly.
 * - Export links (baked into downloaded Excel/Word files) need to keep
 *   working long after the person leaves the app, so they get a long expiry.
 *
 * Both still require the caller to be logged in and a member of the
 * household that owns the file — the SELECT policy on storage.objects
 * enforces that. Nobody outside the household can ever generate a working
 * link for either case.
 */

const DISPLAY_URL_TTL_SECONDS = 60 * 60; // 1 hour
const EXPORT_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

export type StorageBucket = "vault-docs" | "inventory-photos";

async function signUrl(
  bucket: StorageBucket,
  path: string | null | undefined,
  ttlSeconds: number,
): Promise<string | null> {
  if (!path) return null;
  // Defensive: if an old row still has a full URL stored (pre-migration),
  // pull just the path back out so signing doesn't fail.
  const cleanPath = extractPathFromLegacyUrl(bucket, path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(cleanPath, ttlSeconds);
  if (error || !data) {
    console.error(`Failed to create signed URL for ${bucket}/${cleanPath}`, error);
    return null;
  }
  return data.signedUrl;
}

export function getDisplayUrl(bucket: StorageBucket, path: string | null | undefined) {
  return signUrl(bucket, path, DISPLAY_URL_TTL_SECONDS);
}

export function getExportUrl(bucket: StorageBucket, path: string | null | undefined) {
  return signUrl(bucket, path, EXPORT_URL_TTL_SECONDS);
}

/**
 * Handles rows written before the private-storage migration, which still
 * contain a full "https://.../object/public/<bucket>/<path>" URL instead of
 * a bare path. Safe to remove once the one-time data migration SQL has run
 * and been confirmed.
 */
function extractPathFromLegacyUrl(bucket: StorageBucket, value: string): string {
  const marker = `/object/public/${bucket}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return value; // already a plain path
  return value.slice(idx + marker.length);
}
