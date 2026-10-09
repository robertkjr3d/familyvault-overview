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
// Unknown/missing cron strings fall back to running the three nightly jobs, exactly the
// old behaviour, so a misconfigured trigger can never silently run nothing.

export const BACKUP_CRON = "0 20 * * *"; // 04:00 Singapore — unchanged time
export const HOUSEKEEPING_CRON = "10 20 * * *"; // FX rates + trash cleanup
// Oct 5 2026: photo/document backup to R2, every hour at :25. Its own trigger for
// the same reason as the backup above (its own budget of 50 outside requests).
// Cloudflare's free plan allows 5 triggers per account; this is the third.
export const FILE_BACKUP_CRON = "25 * * * *";

export type NightlyJob = "backup" | "fx" | "trash" | "files";

export function jobsForCron(cron: string | undefined | null): NightlyJob[] {
  if (cron === BACKUP_CRON) return ["backup"];
  if (cron === HOUSEKEEPING_CRON) return ["fx", "trash"];
  // The file backup is NOT part of the run-everything fallback below: piling it
  // onto the same invocation as the other jobs is exactly what blows the budget.
  if (cron === FILE_BACKUP_CRON) return ["files"];
  return ["fx", "trash", "backup"];
}
