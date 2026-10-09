import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { runFxRateFetch } from "./lib/fxRateCron";
import { runTrashCleanup } from "./lib/trashCleanupCron";
import { runDailyBackup } from "./lib/backupCron";
import { runFileBackup, type R2BucketForFiles } from "./lib/fileBackupCron";
import { reportToSentry, stripUrlSecrets } from "./lib/sentryReport";
import { jobsForCron } from "./lib/scheduledJobs";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  sentryDsn?: string,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const captured = consumeLastCapturedError();
  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  reportToSentry(sentryDsn, {
    message: captured instanceof Error ? captured.message : `h3 swallowed SSR error: ${body}`,
    stack: captured instanceof Error ? captured.stack : undefined,
    tags: { source: "h3-swallowed-ssr-error" },
  });
  return brandedErrorResponse();
}

// Sep 22 2026 -- pulls SENTRY_DSN out of the Worker's env without widening the
// `unknown` type above (fetch()'s env is typed unknown deliberately, since it's
// passed straight through to TanStack's own handler). No-op (undefined) if the
// secret was never set in Cloudflare -- see sentryReport.ts.
function sentryDsnFrom(env: unknown): string | undefined {
  if (env && typeof env === "object" && "SENTRY_DSN" in env) {
    const value = (env as { SENTRY_DSN?: unknown }).SENTRY_DSN;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, sentryDsnFrom(env));
    } catch (error) {
      console.error(error);
      reportToSentry(sentryDsnFrom(env), {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        tags: { source: "server-fetch-catch" },
        extra: { url: stripUrlSecrets(request.url) },
      });
      return brandedErrorResponse();
    }
  },
  // Fired by the Cron Trigger declared in wrangler.jsonc. Cloudflare passes
  // the same env bindings/secrets here as it does to fetch(), so this reuses
  // the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY already configured for
  // the Worker — no new Cloudflare-side config needed.
  async scheduled(
    event: { cron?: string },
    env: {
      SUPABASE_URL?: string;
      SUPABASE_SERVICE_ROLE_KEY?: string;
      BACKUPS_BUCKET?: R2BucketForFiles & { put(key: string, value: string): Promise<unknown> };
      // Sep 22 2026 — optional Healthchecks.io ping URL for the nightly backup
      // (see backupCron.ts). Left undefined = pings are silently skipped.
      HEALTHCHECKS_PING_URL?: string;
      // Oct 5 2026 — separate Healthchecks check for the hourly photo/document
      // backup (see fileBackupCron.ts). Same rule: unset = pings skipped.
      HEALTHCHECKS_FILES_PING_URL?: string;
    },
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    // Each job catches its own errors internally and never throws. Which jobs
    // run depends on which Cron Trigger fired (see src/lib/scheduledJobs.ts):
    // the backup gets an invocation to itself so it has its own budget of 50
    // outside requests on Cloudflare's free plan (Sep 28 2026 fix — it was
    // failing with "Too many subrequests" when sharing one with the others).
    const jobs = jobsForCron(event?.cron);
    if (jobs.includes("fx")) ctx.waitUntil(runFxRateFetch(env));
    if (jobs.includes("trash")) ctx.waitUntil(runTrashCleanup(env));
    if (jobs.includes("backup")) ctx.waitUntil(runDailyBackup(env));
    if (jobs.includes("files")) ctx.waitUntil(runFileBackup(env));
  },
};
