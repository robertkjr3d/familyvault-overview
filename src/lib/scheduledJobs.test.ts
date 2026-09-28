import { describe, it, expect } from "vitest";
import { BACKUP_CRON, HOUSEKEEPING_CRON, jobsForCron } from "./scheduledJobs";

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
  it("uses two different trigger strings", () => {
    expect(BACKUP_CRON).not.toBe(HOUSEKEEPING_CRON);
  });
});
