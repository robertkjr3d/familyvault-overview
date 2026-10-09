import { describe, it, expect } from "vitest";
import { BACKUP_CRON, FILE_BACKUP_CRON, HOUSEKEEPING_CRON, jobsForCron } from "./scheduledJobs";

describe("jobsForCron", () => {
  it("gives the backup its own invocation (its own 50-request budget)", () => {
    expect(jobsForCron(BACKUP_CRON)).toEqual(["backup"]);
  });
  it("runs the two small jobs together on the housekeeping trigger, never the backup", () => {
    const jobs = jobsForCron(HOUSEKEEPING_CRON);
    expect(jobs).toEqual(["fx", "trash"]);
    expect(jobs).not.toContain("backup");
  });
  it("falls back to running everything for an unknown or missing cron string", () => {
    for (const c of ["5 5 * * *", "", undefined, null]) {
      expect(jobsForCron(c).sort()).toEqual(["backup", "fx", "trash"]);
    }
  });
  it("uses three different trigger strings", () => {
    expect(new Set([BACKUP_CRON, HOUSEKEEPING_CRON, FILE_BACKUP_CRON]).size).toBe(3);
  });
  it("gives the photo/document backup an invocation to itself, and keeps it out of the run-everything fallback", () => {
    expect(jobsForCron(FILE_BACKUP_CRON)).toEqual(["files"]);
    expect(jobsForCron("5 5 * * *")).not.toContain("files");
    expect(jobsForCron(BACKUP_CRON)).not.toContain("files");
    expect(jobsForCron(HOUSEKEEPING_CRON)).not.toContain("files");
  });
  it("the trigger is declared in wrangler.jsonc, or the job would never run", async () => {
    const { readFileSync } = await import("node:fs");
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    for (const cron of [BACKUP_CRON, HOUSEKEEPING_CRON, FILE_BACKUP_CRON]) {
      expect(wrangler).toContain(`"${cron}"`);
    }
  });
});
