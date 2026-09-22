/**
 * sentryReport.ts
 *
 * Sep 22 2026 — a deliberately minimal Sentry integration: one plain `fetch()`
 * call to Sentry's documented "store" ingest endpoint, no @sentry/* package.
 *
 * Why not the official SDK: the official Cloudflare Workers SDK (@sentry/cloudflare)
 * requires turning on the `nodejs_compat` (or `nodejs_als`) compatibility flag for
 * this Worker. That flag changes broader runtime behavior than just "does Sentry
 * work" and deserves its own dedicated testing session before going anywhere near
 * this app's production Worker — not something to add as a side effect of wanting
 * error alerts. The official @sentry/react package is a reasonable, lower-risk
 * option on the frontend alone, but using the same raw-fetch approach on both
 * sides keeps this consistent, keeps bundle size at effectively zero, and matches
 * this app's existing minimal-dependency style (see the Healthchecks.io ping in
 * backupCron.ts, same shape: a plain fetch, wrapped so it can never break the
 * real feature around it).
 *
 * This file works from BOTH the browser (Vite bundles it for the client) and the
 * Cloudflare Worker (server.ts). It never throws and never awaits its own network
 * call at the caller — errors reporting an error must never cause a second error.
 */

export type SentryReportParams = {
  message: string;
  stack?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

// Parses a standard Sentry DSN, e.g.
//   https://abc123@o000000.ingest.us.sentry.io/4500000000000000
// into what the raw store API needs. Returns null (silently) on anything
// that doesn't look like a real DSN, rather than throwing.
function parseDsn(dsn: string): { storeUrl: string; key: string } | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!key || !projectId) return null;
    return { storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`, key };
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget. Does nothing (no network call at all) if `dsn` is
 * undefined/empty — every call site stays fully functional with Sentry
 * never configured.
 */
export function reportToSentry(dsn: string | undefined, params: SentryReportParams): void {
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;

  try {
    void fetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=familyhubsg-raw-fetch/1.0`,
      },
      body: JSON.stringify({
        message: params.message,
        exception: params.stack
          ? {
              values: [
                {
                  type: "Error",
                  value: params.message,
                  stacktrace: { frames: [] },
                  raw_stacktrace: params.stack,
                },
              ],
            }
          : undefined,
        tags: params.tags,
        extra: params.extra,
        timestamp: Date.now() / 1000,
      }),
    }).catch(() => {
      // Deliberately ignored — see file header. A Sentry outage or a
      // misconfigured DSN must never affect the app or the caller.
    });
  } catch {
    // Same reasoning — e.g. fetch() itself throwing synchronously in an
    // unusual runtime.
  }
}
