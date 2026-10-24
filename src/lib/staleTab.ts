/**
 * staleTab.ts
 *
 * Oct 25 2026. After a deploy, a browser tab that was opened BEFORE the deploy
 * still points at the old file names. Opening a page in that tab can fail with
 * "Importing a module script failed" (Safari) or "Failed to fetch dynamically
 * imported module" (Chrome). The only cure is to load the new version, so we
 * reload once automatically.
 *
 * Safety rules:
 *   - Reload at most once per minute (sessionStorage), so a real outage can
 *     never cause a reload loop; the normal error screen shows instead.
 *   - Only used for the file-loading failure Vite reports ("vite:preloadError"),
 *     never for ordinary errors.
 *
 * Also here: browser-extension noise (MetaMask etc.) that is not our bug and
 * should not reach Sentry.
 */

const STALE_PATTERNS = [
  /importing a module script failed/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
];

export function isStaleChunkError(message: string): boolean {
  return STALE_PATTERNS.some((p) => p.test(message));
}

const EXTENSION_PATTERNS = [/metamask/i, /(chrome|moz|safari-web)-extension:\/\//i];

export function isExtensionNoise(message: string, stack?: string): boolean {
  const text = `${message}\n${stack ?? ""}`;
  return EXTENSION_PATTERNS.some((p) => p.test(text));
}

const KEY = "fh-stale-reload-at";
const MIN_GAP_MS = 60_000;

/** Returns true if a reload was started, false if skipped (already reloaded recently). */
export function reloadOnceForNewVersion(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  reload: () => void,
  now: number = Date.now(),
): boolean {
  if (!storage) return false; // no way to remember: skip, never risk a loop
  try {
    const last = Number(storage.getItem(KEY) ?? 0);
    if (last && now - last < MIN_GAP_MS) return false;
    storage.setItem(KEY, String(now));
  } catch {
    // Storage blocked (private mode): do not risk a loop, skip the reload.
    return false;
  }
  reload();
  return true;
}

let _installed = false;

export function setupStaleTabReload(): void {
  if (typeof window === "undefined" || _installed) return;
  _installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    const message = payload instanceof Error ? payload.message : String(payload ?? "");
    if (message && !isStaleChunkError(message)) return; // unknown cause: let it surface
    if (reloadOnceForNewVersion(window.sessionStorage, () => window.location.reload())) {
      event.preventDefault(); // handled: we are reloading
    }
  });
}
