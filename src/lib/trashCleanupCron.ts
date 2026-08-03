import { createClient } from "@supabase/supabase-js";

// Runs from the same daily Cloudflare Cron Trigger as the FX rate fetch
// (see src/server.ts's `scheduled` export) — deliberately not a separate
// trigger, since Cloudflare's free plan caps how many a single Worker can
// register. Purges Recycle Bin entries older than 30 days (see
// src/lib/mutations.ts and the Recycle Bin section in
// src/routes/settings.tsx) — including their documents, which were
// deliberately left untouched until this exact moment (see
// purgeDocumentsFor in mutations.ts for why).
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

  const { data: expired, error: fetchError } = await admin
    .from("deleted_records")
    .select("id, entity_type, record_id")
    .lt("deleted_at", cutoff);

  if (fetchError) {
    console.error("[trash-cron] Failed to look up expired Recycle Bin entries.", fetchError);
    return;
  }
  if (!expired || expired.length === 0) {
    console.log("[trash-cron] Nothing to purge.");
    return;
  }

  // Documents were deliberately never deleted at the original delete-time
  // (see purgeDocumentsFor in mutations.ts for why) — this is where that
  // deferred cleanup actually happens, mirroring the same logic for the
  // admin/server-side client used here.
  for (const row of expired as any[]) {
    if (!row.entity_type) continue;
    const { data: docs } = await admin
      .from("record_documents")
      .select("path, bucket")
      .eq("entity_type", row.entity_type)
      .eq("entity_id", row.record_id);
    const storagePaths = (docs ?? [])
      .filter((d: any) => d.bucket !== "external")
      .map((d: any) => d.path as string);
    if (storagePaths.length > 0) {
      await admin.storage.from("vault-docs").remove(storagePaths);
    }
    await admin
      .from("record_documents")
      .delete()
      .eq("entity_type", row.entity_type)
      .eq("entity_id", row.record_id);
  }

  const { error } = await admin.from("deleted_records").delete().lt("deleted_at", cutoff);

  if (error) {
    console.error("[trash-cron] Failed to purge old Recycle Bin entries.", error);
    return;
  }

  console.log(
    `[trash-cron] Purged ${expired.length} Recycle Bin entries (and their documents) older than ${RETENTION_DAYS} days.`,
  );
}
