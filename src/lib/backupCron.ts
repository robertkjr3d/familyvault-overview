import { createClient } from "@supabase/supabase-js";

// Small retry wrapper for the daily table-read loop below. This loop makes
// 22 sequential requests using the same client/credentials that fx-cron and
// trash-cleanup-cron also use successfully in the same invocation — so a
// one-off failure here (e.g. the PGRST303 "JWT issued at future" seen once,
// Aug 2026) looks like a transient timing blip rather than a real problem
// with the credentials themselves. This loop has 22x the exposure to that
// kind of blip compared to the other two crons' 1-3 calls each, so it's the
// one that actually needs a retry, not a signal something is wrong with the
// approach. Two retries, short fixed backoff — deliberately not fancier
// than that; if it's still failing after 3 attempts total, that's a real
// problem worth surfacing loudly (the caller aborts the whole run), not
// something to keep silently retrying around.
async function selectAllWithRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  table: string,
  attempts = 3,
  filter?: { column: string; value: string },
): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  let lastError: { message: string } | null = null;
  for (let i = 0; i < attempts; i++) {
    let query = admin.from(table).select("*");
    if (filter) query = query.eq(filter.column, filter.value);
    const { data, error } = await query;
    if (!error) return { data, error: null };
    lastError = error;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { data: null, error: lastError };
}

// Runs from the same daily Cloudflare Cron Trigger as the FX rate fetch and
// trash cleanup (see src/server.ts's `scheduled` export) — no new trigger
// slot used. Writes one JSON file per day to the `familyhub-backups` R2
// bucket (binding: BACKUPS_BUCKET), containing every row from every
// household-scoped table. This is the "disaster recovery" layer — for a
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

const BACKUP_TABLES = [
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
};

export async function runDailyBackup(env: BackupEnv): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUPS_BUCKET } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[backup-cron] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping backup.",
    );
    return;
  }
  if (!BACKUPS_BUCKET) {
    console.error("[backup-cron] Missing BACKUPS_BUCKET binding — skipping backup.");
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const snapshot: Record<string, unknown> = {};
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
      return;
    }
    snapshot[table] = data ?? [];
  }

  const payload = JSON.stringify({ generated_at: new Date().toISOString(), tables: snapshot });
  const byteSize = new TextEncoder().encode(payload).length;

  if (byteSize > MAX_BACKUP_BYTES) {
    console.error(
      `[backup-cron] Snapshot is ${byteSize} bytes — over the ${MAX_BACKUP_BYTES}-byte sanity ceiling. Not writing it. Investigate before raising this limit.`,
    );
    return;
  }

  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `backups/${dateKey}.json`;

  try {
    await BACKUPS_BUCKET.put(key, payload);
    console.log(`[backup-cron] Wrote ${key} (${byteSize} bytes, ${BACKUP_TABLES.length} tables).`);
  } catch (error) {
    console.error("[backup-cron] Failed to write backup to R2.", error);
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
  for (const table of BACKUP_TABLES) {
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
