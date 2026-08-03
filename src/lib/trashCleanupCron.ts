import { createClient } from "@supabase/supabase-js";

// Runs from the same daily Cloudflare Cron Trigger as the FX rate fetch
// (see src/server.ts's `scheduled` export) — deliberately not a separate
// trigger, since Cloudflare's free plan caps how many a single Worker can
// register. Purges Recycle Bin entries (see src/lib/mutations.ts and the
// Recycle Bin section in src/routes/settings.tsx) older than 30 days.
//
// Same untyped-client rationale as fxRateCron.ts: deleted_records isn't in
// the generated types.ts, and this file only ever touches this one table.
//
// Failure handling: on any error this just logs and returns — a missed
// cleanup run just means old trash entries linger a bit longer, never a
// reason to fail the whole scheduled invocation (the FX fetch alongside
// this must still get its chance to run even if this part fails).

const RETENTION_DAYS = 30;

type TrashCleanupEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export async function runTrashCleanup(env: TrashCleanupEnv): Promise<void> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[trash-cron] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping cleanup.",
    );
    return;
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("deleted_records")
    .delete()
    .lt("deleted_at", cutoff)
    .select("id");

  if (error) {
    console.error("[trash-cron] Failed to purge old Recycle Bin entries.", error);
    return;
  }

  console.log(
    `[trash-cron] Purged ${data?.length ?? 0} Recycle Bin entries older than ${RETENTION_DAYS} days.`,
  );
}
