// Decides which nightly jobs a given Cloudflare Cron Trigger should run.
//
// WHY THIS EXISTS (Sep 28 2026): Cloudflare's free plan lets ONE Worker
// invocation make at most 50 outside requests ("subrequests"). The nightly
// backup alone needs about 35 (one read per table, plus the start/finish
// pings and the write to R2). Running the FX-rate fetch and the trash
// cleanup in the SAME invocation used up the rest, and the backup died with
// "Too many subrequests" (it could not even send its own failure ping).
// Each Cron Trigger is its own invocation with its own budget of 50, so the
// backup now gets a trigger to itself and the two small jobs share another.
//
// Unknown/missing cron strings fall back to running everything, exactly the
// old behaviour, so a misconfigured trigger can never silently run nothing.

export const BACKUP_CRON = "0 20 * * *"; // 04:00 Singapore — unchanged time
export const HOUSEKEEPING_CRON = "10 20 * * *"; // FX rates + trash cleanup

export type NightlyJob = "backup" | "fx" | "trash";

export function jobsForCron(cron: string | undefined | null): NightlyJob[] {
  if (cron === BACKUP_CRON) return ["backup"];
  if (cron === HOUSEKEEPING_CRON) return ["fx", "trash"];
  return ["fx", "trash", "backup"];
}
