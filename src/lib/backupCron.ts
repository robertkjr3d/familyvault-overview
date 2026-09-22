import { createClient } from "@supabase/supabase-js";

// Small retry wrapper for the daily table-read loop below. This loop makes
// one request per table (plus extra pages for any table over 1,000 rows — see
// below) using the same client/credentials that fx-cron and trash-cleanup-cron
// also use successfully in the same invocation — so a one-off failure here
// (e.g. the PGRST303 "JWT issued at future" seen once, Aug 2026) looks like a
// transient timing blip rather than a real problem with the credentials
// themselves. This loop has far more exposure to that kind of blip than the
// other two crons' 1-3 calls each, so it's the one that actually needs a
// retry. Two retries, short fixed backoff — deliberately not fancier than
// that; if it's still failing after 3 attempts total, that's a real problem
// worth surfacing loudly (the caller aborts the whole run), not something to
// keep silently retrying around.
//
// Sep 20 2026 — PAGINATION + COMPLETENESS CHECK. Supabase's API returns at
// most 1,000 rows per request by default (documented: Supabase JS reference,
// "Fetch data") and reports SUCCESS when it cuts a bigger table short — no
// error, no warning. The old plain select("*") therefore would have silently
// dropped rows from any table over 1,000 rows, which is the worst failure
// mode for a disaster-recovery file. Now: ask for an exact row count with the
// very first request (same request as before, just with the count header) and
// compare it with what came back. If everything came back, done — identical
// to the old behavior. If not, re-read the table page by page in a fixed
// order, and finally verify rows collected === the count. Any mismatch is an
// error, and the caller aborts the whole run (same "no partial snapshot"
// rule as before).
const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // runaway guard — 200k rows in one table means something is wrong

// Column(s) to sort by when a table has to be paged. Paging without a fixed,
// unique order can skip or repeat rows between pages, so this matters. Almost
// every table has a unique `id` (the default). These don't, and the columns
// below are the ones the app's own upsert/lookup code treats as unique for
// that table (onConflict / .eq("token")) — evidence from the code, not guesses.
const ORDER_COLUMNS: Record<string, string[]> = {
  household_users: ["household_id", "user_id"],
  user_profiles: ["user_id"],
  estate_checklist: ["household_id", "item_id"],
  advisor_link_members: ["link_id", "member_id"],
  advisor_invites: ["token"],
};

type PageResult = { data: unknown[] | null; error: { message: string; code?: string } | null };

async function selectAllPages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  filter?: { column: string; value: string },
): Promise<PageResult> {
  // First request: exactly the old shape (no ordering, no range) + exact count.
  let first = admin.from(table).select("*", { count: "exact" });
  if (filter) first = first.eq(filter.column, filter.value);
  const { data: firstData, error: firstError, count } = await first;
  if (firstError) return { data: null, error: firstError };
  if (count === null || count === undefined) {
    return { data: null, error: { message: `No row count returned for "${table}" — cannot verify completeness.` } };
  }
  const firstRows = firstData ?? [];
  if (firstRows.length >= count) return { data: firstRows, error: null };

  // Truncated by the server's row cap → page through in a fixed order.
  const orderColumns = ORDER_COLUMNS[table] ?? ["id"];
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES && rows.length < count; page++) {
    let query = admin.from(table).select("*");
    if (filter) query = query.eq(filter.column, filter.value);
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) {
      const hint =
        error.code === "42703"
          ? ` This table has no column to sort by (${orderColumns.join(", ")}) — add it to ORDER_COLUMNS in backupCron.ts.`
          : "";
      return { data: null, error: { ...error, message: error.message + hint } };
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  if (rows.length !== count) {
    return {
      data: null,
      error: { message: `Read ${rows.length} rows from "${table}" but the database reports ${count} — refusing to write a partial copy.` },
    };
  }
  return { data: rows, error: null };
}

async function selectAllWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  attempts = 3,
  filter?: { column: string; value: string },
): Promise<PageResult> {
  let lastError: PageResult["error"] = null;
  for (let i = 0; i < attempts; i++) {
    const result = await selectAllPages(admin, table, filter);
    if (!result.error) return result;
    lastError = result.error;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { data: null, error: lastError };
}

// Runs from the same daily Cloudflare Cron Trigger as the FX rate fetch and
// trash cleanup (see src/server.ts's `scheduled` export) — no new trigger
// slot used. Writes one JSON file per day to the `familyhub-backups` R2
// bucket (binding: BACKUPS_BUCKET), containing every row from every
// household-scoped table (plus the login-profile and advisor-sharing tables —
// see EXTRA_TABLES). This is the "disaster recovery" layer — for a
// bad SQL statement run directly in Supabase, or an accidental account/
// household deletion — as opposed to the Recycle Bin, which only catches
// in-app delete-button mistakes.
//
// DELIBERATELY DOES NOT TOUCH DOCUMENTS, PHOTOS, OR ANY UPLOADED FILE.
// This only reads database rows (via Supabase's Postgres API) — it never
// calls Supabase Storage. Storage/file backup is a separate, harder problem
// (much larger volumes, real cost implications) and was explicitly decided
// against for this feature — see the household's own file-size safeguards
// (compressImage in inventory.tsx) as the existing mitigation there instead.
//
// A 30-day object lifecycle rule on the bucket (configured in the Cloudflare
// dashboard, not in code) handles retention — no cleanup logic needed here.

const CORE_TABLES = [
  "households",
  "household_users",
  "household_invites",
  "members",
  "app_settings",
  "properties",
  "property_rate_schedule",
  "loans",
  "loan_rate_schedule",
  "insurance_policies",
  "investments",
  "savings_accounts",
  "other_assets",
  "credit_cards",
  "health_conditions",
  "inventory_folders",
  "inventory_items",
  "gobag_items",
  "record_documents",
  "record_history",
  "reminders",
  "dismissed_dashboard_items",
  "deleted_records",
];
// Sep 20 2026 — tables that hold real user data but were missing from the list
// above (found by comparing every .from("...") in the app's code against this
// list, not from memory). Kept in a separate list on purpose: some of them
// have NO household_id column (user_profiles is keyed by user_id;
// advisor_link_members by link_id), so the per-household test function below
// — which filters every table by household_id — must keep using CORE_TABLES
// only. Deliberately NOT included:
//   - audit_log: grows with every edit and has no purge; one big table could
//     push the whole snapshot over the size ceiling below and disable ALL
//     backups. Needs its own separate file if it's ever backed up.
//   - fx_rates: re-fetched daily by fx-cron, nothing user-entered.
//   - error_logs, inventory_locations (empty/obsolete), and the two
//     advisor_*_view views (computed from tables already backed up).
const EXTRA_TABLES = [
  "planned_cashflow_events",
  "estate_checklist",
  "travel_checklist_items",
  "user_profiles",
  "advisor_household_links",
  "advisor_link_members",
  "advisor_invites",
  "advisor_record_notes",
  "advisor_policy_charts",
];

const BACKUP_TABLES = [...CORE_TABLES, ...EXTRA_TABLES];

// Sanity ceiling, not a real expectation — this is JSON rows only (no
// files/images), so even at hundreds of households this should be a few MB
// at most. If a day's snapshot is ever anywhere near this, something is
// wrong (a runaway table, a bug duplicating rows) — abort and log rather
// than silently write an unexpectedly huge file to R2.
const MAX_BACKUP_BYTES = 20 * 1024 * 1024; // 20MB

type R2BucketLike = {
  put(key: string, value: string): Promise<unknown>;
};

type BackupEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  BACKUPS_BUCKET?: R2BucketLike;
  // Sep 22 2026 — optional on purpose: if this secret is never set, every ping
  // below is a silent no-op (see pingHealthcheck) and the backup behaves
  // exactly as before. A Healthchecks.io "check" URL, kept secret (it can
  // trigger a failure alert if leaked and spammed, nothing worse than that).
  HEALTHCHECKS_PING_URL?: string;
};

// Tells Healthchecks.io this run started/finished/failed, so a missed night
// (no ping at all) or a failed run (an explicit /fail ping) triggers an
// email. Wrapped so a Healthchecks outage or typo'd URL can NEVER break the
// actual backup — every call is fire-and-forget and swallows its own errors.
async function pingHealthcheck(env: BackupEnv, suffix: "" | "/start" | "/fail", detail?: string): Promise<void> {
  if (!env.HEALTHCHECKS_PING_URL) return;
  try {
    await fetch(env.HEALTHCHECKS_PING_URL + suffix, {
      method: detail ? "POST" : "GET",
      body: detail,
    });
  } catch {
    // Deliberately ignored — see comment above.
  }
}

export async function runDailyBackup(env: BackupEnv): Promise<void> {
  await pingHealthcheck(env, "/start");
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUPS_BUCKET } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[backup-cron] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping backup.",
    );
    await pingHealthcheck(env, "/fail", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  if (!BACKUPS_BUCKET) {
    console.error("[backup-cron] Missing BACKUPS_BUCKET binding — skipping backup.");
    await pingHealthcheck(env, "/fail", "Missing BACKUPS_BUCKET binding");
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const snapshot: Record<string, unknown> = {};
  const rowCounts: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const { data, error } = await selectAllWithRetry(admin, table);
    if (error) {
      // Abort the WHOLE day's backup rather than write a partial one — a
      // snapshot silently missing one table is worse than no snapshot at
      // all for a disaster-recovery tool, since nothing would flag the gap
      // until someone actually needed that table's data back.
      console.error(
        `[backup-cron] Failed to read table "${table}" after retries — aborting this run rather than writing an incomplete snapshot.`,
        error,
      );
      await pingHealthcheck(env, "/fail", `Failed to read table "${table}": ${error.message ?? error}`);
      return;
    }
    snapshot[table] = data ?? [];
    rowCounts[table] = (data ?? []).length;
  }

  // row_counts: makes it a 10-second job to compare a backup against the live
  // database (SELECT count(*) per table) before trusting it for a restore.
  const payload = JSON.stringify({ generated_at: new Date().toISOString(), row_counts: rowCounts, tables: snapshot });
  const byteSize = new TextEncoder().encode(payload).length;

  if (byteSize > MAX_BACKUP_BYTES) {
    console.error(
      `[backup-cron] Snapshot is ${byteSize} bytes — over the ${MAX_BACKUP_BYTES}-byte sanity ceiling. Not writing it. Investigate before raising this limit.`,
    );
    await pingHealthcheck(env, "/fail", `Snapshot is ${byteSize} bytes, over the ${MAX_BACKUP_BYTES}-byte ceiling`);
    return;
  }

  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `backups/${dateKey}.json`;

  try {
    await BACKUPS_BUCKET.put(key, payload);
    console.log(`[backup-cron] Wrote ${key} (${byteSize} bytes, ${BACKUP_TABLES.length} tables).`);
    // Success ping LAST, after the write genuinely succeeded — a ping here
    // means "there really is a backup file for today," not just "the code
    // reached this line."
    await pingHealthcheck(env, "", `Wrote ${key}, ${byteSize} bytes, ${BACKUP_TABLES.length} tables`);
  } catch (error) {
    console.error("[backup-cron] Failed to write backup to R2.", error);
    await pingHealthcheck(env, "/fail", `Failed to write backup to R2: ${(error as Error)?.message ?? error}`);
  }
}

// Bug fix / feature (Aug 29, 2026): a safe way to verify the backup
// mechanism actually works end-to-end, scoped to ONE household (a test
// account), without touching the real daily backups/ path at all — writes
// to a completely separate test-backups/ prefix so it can never collide
// with or overwrite the real disaster-recovery file above.
//
// Every table's filter column below was verified against real evidence
// this session, not assumed: households itself is keyed by its own `id`
// (confirmed via its migration); every other table's household_id column
// was confirmed via the live generated types.ts, except deleted_records,
// which isn't in that generated file (created via a raw SQL statement, not
// a checked-in migration — worth fixing separately) but is confirmed to
// have household_id via an actual `.eq("household_id", householdId)` call
// already live in settings.tsx's own recycle-bin-clearing code.
export async function runTestBackupForHousehold(
  env: BackupEnv,
  householdId: string,
): Promise<{ ok: boolean; key?: string; byteSize?: number; error?: string }> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUPS_BUCKET } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." };
  }
  if (!BACKUPS_BUCKET) {
    return { ok: false, error: "Missing BACKUPS_BUCKET binding." };
  }
  if (!householdId) {
    return { ok: false, error: "No householdId given." };
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const snapshot: Record<string, unknown> = {};
  // CORE_TABLES, not BACKUP_TABLES: every table here is filtered by
  // household_id, which EXTRA_TABLES don't all have (see comment on EXTRA_TABLES).
  for (const table of CORE_TABLES) {
    const filterColumn = table === "households" ? "id" : "household_id";
    // Correction on re-review: this used to call admin.from(table).select("*")
    // directly, un-retried — a real gap against runDailyBackup's own
    // established pattern just above, which exists specifically because of
    // an observed real transient failure (PGRST303). Reusing the same
    // selectAllWithRetry wrapper here instead of a weaker duplicate.
    const { data, error } = await selectAllWithRetry(admin, table, 3, { column: filterColumn, value: householdId });
    if (error) {
      return { ok: false, error: `Failed reading "${table}": ${error.message}` };
    }
    snapshot[table] = data ?? [];
  }

  const payload = JSON.stringify({ generated_at: new Date().toISOString(), household_id: householdId, tables: snapshot });
  const byteSize = new TextEncoder().encode(payload).length;
  // Same sanity ceiling as runDailyBackup above, missed on the first pass —
  // a single household should never come close to this, but there's no
  // reason to skip a check that already exists and costs nothing to reuse.
  if (byteSize > MAX_BACKUP_BYTES) {
    return { ok: false, error: `Snapshot is ${byteSize} bytes — over the ${MAX_BACKUP_BYTES}-byte sanity ceiling. Not writing it.` };
  }
  const key = `test-backups/${householdId}-${Date.now()}.json`;

  try {
    await BACKUPS_BUCKET.put(key, payload);
    return { ok: true, key, byteSize };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
