// Database-size alarm (16 Nov 2026, finding F12).
//
// WHY THIS EXISTS: the free Supabase database is 500 MB. Nothing in the app limits how many rows or how
// much text one account can write, and six financial tables copy every change into the Audit Trail.
// A buggy loop or a hostile account could fill the database; the app would then stop working.
// This job is the early warning: once a night it asks the database how big it is and tells
// Healthchecks.io. Above the alert level (default 300 MB) Healthchecks emails the owner.
//
// It DETECTS, it does not prevent (the error-log limiter in the database prevents the cheapest
// route; see supabase/schema.sql, function limit_error_log_writes).
//
// Runs on the housekeeping trigger (10 20 * * *), first in line. It needs only 2 outside requests
// (one to the database, one ping) out of the 50 a free-plan invocation gets.
//
// Needs, in Cloudflare (Variables and Secrets):
//   HEALTHCHECKS_DBSIZE_PING_URL   the ping URL of a SEPARATE Healthchecks check (unset = no email alert,
//                                  the warning then only appears in the Worker logs)
//   DB_SIZE_ALERT_MB               optional, alert level in MB (default 300). Setting it to 1 is the test.
import { createClient } from "@supabase/supabase-js";

export const DEFAULT_ALERT_MB = 300;
export const FREE_PLAN_LIMIT_MB = 500;

export type DbSizeEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  HEALTHCHECKS_DBSIZE_PING_URL?: string;
  DB_SIZE_ALERT_MB?: string;
};

export type DbSizeResult = {
  ok: boolean;
  sizeMb: number | null;
  alertMb: number;
  message: string;
};

type Deps = {
  readSizeMb?: () => Promise<number>;
  fetchFn?: typeof fetch;
};

export function parseAlertMb(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_ALERT_MB;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERT_MB;
}

export function judgeDbSize(sizeMb: number, alertMb: number): { ok: boolean; message: string } {
  if (sizeMb >= alertMb) {
    return {
      ok: false,
      message:
        `WARNING: database is ${sizeMb} MB, at or over the alert level of ${alertMb} MB ` +
        `(free plan limit ${FREE_PLAN_LIMIT_MB} MB). Find out which table grew and tell Claude.`,
    };
  }
  return {
    ok: true,
    message: `Database is ${sizeMb} MB (alert at ${alertMb} MB, free plan limit ${FREE_PLAN_LIMIT_MB} MB).`,
  };
}

async function ping(
  url: string | undefined,
  suffix: "" | "/fail",
  detail: string,
  fetchFn: typeof fetch,
): Promise<void> {
  if (!url) return;
  try {
    await fetchFn(url + suffix, { method: "POST", body: detail.slice(0, 5000) });
  } catch {
    // A Healthchecks outage must never break the job.
  }
}

async function readSizeFromDatabase(env: DbSizeEnv): Promise<number> {
  const admin = createClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).rpc("get_database_size_mb");
  if (error) throw new Error(`database size lookup failed: ${error.message ?? String(error)}`);
  return Number(data);
}

// Never throws: like the other nightly jobs, a failure is reported (log + ping), not raised.
export async function runDbSizeCheck(env: DbSizeEnv, deps: Deps = {}): Promise<DbSizeResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const alertMb = parseAlertMb(env.DB_SIZE_ALERT_MB);
  const url = env.HEALTHCHECKS_DBSIZE_PING_URL;

  const fail = async (message: string): Promise<DbSizeResult> => {
    console.error(`[db-size] ${message}`);
    if (!url)
      console.error("[db-size] HEALTHCHECKS_DBSIZE_PING_URL is not set: no email alert was sent.");
    await ping(url, "/fail", message, fetchFn);
    return { ok: false, sizeMb: null, alertMb, message };
  };

  try {
    if (!deps.readSizeMb && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) {
      return await fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY: size check skipped.");
    }
    const sizeMb = await (deps.readSizeMb ?? (() => readSizeFromDatabase(env)))();
    if (!Number.isFinite(sizeMb) || sizeMb < 0) {
      return await fail(`The database returned an unusable size (${String(sizeMb)}).`);
    }
    const verdict = judgeDbSize(sizeMb, alertMb);
    if (verdict.ok) {
      console.log(`[db-size] ${verdict.message}`);
      await ping(url, "", verdict.message, fetchFn);
    } else {
      console.error(`[db-size] ${verdict.message}`);
      if (!url)
        console.error(
          "[db-size] HEALTHCHECKS_DBSIZE_PING_URL is not set: no email alert was sent.",
        );
      await ping(url, "/fail", verdict.message, fetchFn);
    }
    return { ok: verdict.ok, sizeMb, alertMb, message: verdict.message };
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
}
