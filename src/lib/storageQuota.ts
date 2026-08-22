// Total-storage-per-household quota (separate from the per-FILE limits in
// uploadValidation.ts). "free" households share a single 10MB total budget
// across vault-docs + inventory-photos combined; "premium" households have
// no cap enforced here.
//
// households.storage_tier is deliberately a general-purpose flag, not a
// storage-specific one — this is meant to be the ONE place future premium
// features check ("free" | "premium"), not something that gets duplicated
// per feature. See useCurrentRole() for how it's exposed to components.
//
// households.storage_bytes_used is a running total maintained by the
// increment_household_storage() Postgres function (security definer, since
// households has no client-facing UPDATE policy) — call it with a positive
// delta after every successful upload and a negative delta after every
// successful delete/replace. See the migration this shipped with for the
// function definition and the one-time backfill of existing files.

import { humanSize } from "@/lib/uploadValidation";

export const FREE_TIER_TOTAL_STORAGE_BYTES = 10 * 1024 * 1024; // 10MB total, free tier

export type QuotaCheckResult = { ok: true } | { ok: false; message: string };

export function checkHouseholdQuota(opts: {
  tier: string | null | undefined;
  bytesUsed: number | null | undefined;
  incomingFileBytes: number;
}): QuotaCheckResult {
  if (opts.tier === "premium") return { ok: true };
  const used = opts.bytesUsed ?? 0;
  const projected = used + opts.incomingFileBytes;
  if (projected > FREE_TIER_TOTAL_STORAGE_BYTES) {
    const remaining = Math.max(0, FREE_TIER_TOTAL_STORAGE_BYTES - used);
    return {
      ok: false,
      message: `This would go over your household's free ${humanSize(FREE_TIER_TOTAL_STORAGE_BYTES)} total storage (about ${humanSize(remaining)} left). Delete something first, or upgrade for more room.`,
    };
  }
  return { ok: true };
}
