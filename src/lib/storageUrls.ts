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

/* ------------------------------------------------------------------ *
 * Fast path for on-screen thumbnails (used by SignedImg only).
 *
 * Why this exists: a grid of N photos used to cost N separate "make me a
 * link" requests, and every visit produced brand-new links, so the browser
 * could never reuse a photo it had already downloaded.
 *
 * What it does instead:
 *  1. Links asked for at about the same moment are requested from Supabase
 *     in ONE batch.
 *  2. A link is remembered for 50 minutes (it is valid for 60), so coming
 *     back to a screen reuses the exact same link and the browser shows the
 *     photo from its own cache instead of downloading it again.
 *  3. Everything is forgotten on sign-out.
 *
 * getDisplayUrl / getExportUrl above are deliberately NOT changed: the
 * Documents list and the Excel/Word exports keep their exact old behaviour.
 * ------------------------------------------------------------------ */

const CACHED_URL_LIFETIME_MS = 50 * 60 * 1000; // links are valid 60 min; reuse for 50
const BATCH_WINDOW_MS = 20; // gather links requested within this window into one call
const BATCH_CHUNK_SIZE = 50; // paths per Supabase request

type Waiter = (url: string | null) => void;

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string | null>>();
const pendingByBucket = new Map<StorageBucket, Map<string, Waiter[]>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Bumped on sign-out so links still being fetched for the previous person are never remembered.
let cacheGeneration = 0;

function cacheKey(bucket: StorageBucket, cleanPath: string) {
  return `${bucket}:${cleanPath}`;
}

/** Instant, synchronous lookup. Returns null if nothing usable is remembered. */
export function peekCachedDisplayUrl(
  bucket: StorageBucket,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const key = cacheKey(bucket, extractPathFromLegacyUrl(bucket, path));
  const hit = urlCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    urlCache.delete(key);
    return null;
  }
  return hit.url;
}

/** Forget one remembered link (used when a photo fails to load). */
export function invalidateCachedDisplayUrl(bucket: StorageBucket, path: string | null | undefined) {
  if (!path) return;
  urlCache.delete(cacheKey(bucket, extractPathFromLegacyUrl(bucket, path)));
}

/** Forget every remembered link (sign-out, or tests). */
export function clearCachedDisplayUrls() {
  urlCache.clear();
}

/**
 * Same result as getDisplayUrl, but remembered, de-duplicated and batched.
 * Never throws: resolves to null if a link could not be made.
 */
export function getCachedDisplayUrl(
  bucket: StorageBucket,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return Promise.resolve(null);
  const cleanPath = extractPathFromLegacyUrl(bucket, path);
  const key = cacheKey(bucket, cleanPath);

  const cached = peekCachedDisplayUrl(bucket, cleanPath);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(key);
  if (running) return running;

  const promise = new Promise<string | null>((resolve) => {
    let waiters = pendingByBucket.get(bucket);
    if (!waiters) {
      waiters = new Map();
      pendingByBucket.set(bucket, waiters);
    }
    const list = waiters.get(cleanPath) ?? [];
    list.push(resolve);
    waiters.set(cleanPath, list);
    if (!flushTimer) flushTimer = setTimeout(flushPendingBatches, BATCH_WINDOW_MS);
  }).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Quietly gets links ready ahead of time (costs one tiny request, downloads
 * no photos). Safe to call with a long list; duplicates are ignored.
 */
export function prefetchDisplayUrls(
  bucket: StorageBucket,
  paths: ReadonlyArray<string | null | undefined>,
) {
  for (const p of paths) {
    if (p) void getCachedDisplayUrl(bucket, p);
  }
}

function flushPendingBatches() {
  flushTimer = null;
  const batches = Array.from(pendingByBucket.entries());
  pendingByBucket.clear();
  for (const [bucket, waitersByPath] of batches) {
    const paths = Array.from(waitersByPath.keys());
    for (let i = 0; i < paths.length; i += BATCH_CHUNK_SIZE) {
      void resolveChunk(bucket, paths.slice(i, i + BATCH_CHUNK_SIZE), waitersByPath);
    }
  }
}

async function resolveChunk(
  bucket: StorageBucket,
  paths: string[],
  waitersByPath: Map<string, Waiter[]>,
) {
  const generation = cacheGeneration;
  const urlByPath = new Map<string, string>();
  let batchFailed = false;
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(paths, DISPLAY_URL_TTL_SECONDS);
    if (error || !data) throw error ?? new Error("empty response");
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) urlByPath.set(row.path, row.signedUrl);
    }
  } catch (err) {
    batchFailed = true;
    console.error(`Batch signing failed for ${bucket}; falling back to one-by-one`, err);
  }

  await Promise.all(
    paths.map(async (path) => {
      let url: string | null = urlByPath.get(path) ?? null;
      // Only if the whole batch call failed do we retry individually (old behaviour).
      if (!url && batchFailed) url = await signUrl(bucket, path, DISPLAY_URL_TTL_SECONDS);
      if (url && generation === cacheGeneration) {
        urlCache.set(cacheKey(bucket, path), {
          url,
          expiresAt: Date.now() + CACHED_URL_LIFETIME_MS,
        });
      }
      for (const resolve of waitersByPath.get(path) ?? []) resolve(url);
    }),
  );
}

// Never let one person's remembered links survive into the next sign-in.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      cacheGeneration += 1;
      urlCache.clear();
      inFlight.clear();
    }
  });
}
