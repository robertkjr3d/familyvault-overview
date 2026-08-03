import { createClient } from "@supabase/supabase-js";

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
    const { data, error } = await admin.from(table).select("*");
    if (error) {
      // Abort the WHOLE day's backup rather than write a partial one — a
      // snapshot silently missing one table is worse than no snapshot at
      // all for a disaster-recovery tool, since nothing would flag the gap
      // until someone actually needed that table's data back.
      console.error(
        `[backup-cron] Failed to read table "${table}" — aborting this run rather than writing an incomplete snapshot.`,
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
