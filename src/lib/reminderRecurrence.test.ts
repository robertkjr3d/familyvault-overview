import { describe, it, expect } from "vitest";
import { computeNextReminderDate, recurrenceLabel } from "./reminderRecurrence";

describe("computeNextReminderDate", () => {
  const today = new Date(2026, 5, 18); // 18 Jun 2026

  it("returns null for a one-off reminder (no recurrence set)", () => {
    expect(computeNextReminderDate("2026-06-01", null, false, today)).toBeNull();
    expect(computeNextReminderDate("2026-06-01", "", false, today)).toBeNull();
  });

  it("returns null when remind_at is missing or invalid", () => {
    expect(computeNextReminderDate("", "weekly", false, today)).toBeNull();
    expect(computeNextReminderDate("not-a-date", "monthly", false, today)).toBeNull();
  });

  it("returns the anchor date itself, unchanged, when it's still in the future (GIRO-style — no forced advance)", () => {
    expect(computeNextReminderDate("2026-07-05", "weekly", false, today)).toBe("2026-07-05");
    expect(computeNextReminderDate("2026-07-05", "monthly", false, today)).toBe("2026-07-05");
    expect(computeNextReminderDate("2026-07-05", "yearly", false, today)).toBe("2026-07-05");
  });

  it("monthly + end of month never returns the anchor's own day unchanged — it always resolves to that month's last day, even when the anchor is still in the future", () => {
    expect(computeNextReminderDate("2026-07-05", "monthly", true, today)).toBe("2026-07-31");
  });

  it("returns the anchor date itself when it falls exactly on today", () => {
    expect(computeNextReminderDate("2026-06-18", "weekly", false, today)).toBe("2026-06-18");
  });

  it("weekly: steps forward exactly 7 days at a time once the anchor is overdue", () => {
    expect(computeNextReminderDate("2026-06-15", "weekly", false, today)).toBe("2026-06-22");
  });

  it("weekly: neglected for months still lands on the nearest on/after today, not a pile of past ones", () => {
    expect(computeNextReminderDate("2026-05-01", "weekly", false, today)).toBe("2026-06-19");
  });

  it("monthly: clamps Jan 31 to Feb 28 in a non-leap year, then correctly back to Mar 31 (re-derives from the original day, doesn't compound)", () => {
    expect(computeNextReminderDate("2026-01-31", "monthly", false, new Date(2026, 1, 1))).toBe(
      "2026-02-28",
    );
    expect(computeNextReminderDate("2026-01-31", "monthly", false, new Date(2026, 2, 1))).toBe(
      "2026-03-31",
    );
  });

  it("monthly + end of month: always lands on the last day of whichever month is next, regardless of the anchor's own day", () => {
    expect(computeNextReminderDate("2026-06-05", "monthly", true, new Date(2026, 6, 1))).toBe(
      "2026-07-31",
    );
  });

  it("monthly + end of month: Jan 31 end-of-month anchor correctly lands on Feb 28, then Mar 31", () => {
    expect(computeNextReminderDate("2026-01-31", "monthly", true, new Date(2026, 1, 1))).toBe(
      "2026-02-28",
    );
    expect(computeNextReminderDate("2026-01-31", "monthly", true, new Date(2026, 2, 1))).toBe(
      "2026-03-31",
    );
  });

  it("yearly: clamps Feb 29 (leap year) to Feb 28 the following year", () => {
    expect(computeNextReminderDate("2024-02-29", "yearly", false, new Date(2025, 1, 1))).toBe(
      "2025-02-28",
    );
  });

  it("yearly: neglected for several years still jumps straight to the next occurrence on/after today, not a pile of past ones", () => {
    // today is 18 Jun 2026 — 5 Jun 2026 is already in the past relative to today, so it skips to 2027.
    expect(computeNextReminderDate("2020-06-05", "yearly", false, today)).toBe("2027-06-05");
  });

  it("returns null for an unrecognised recurrence value", () => {
    expect(computeNextReminderDate("2026-06-05", "daily", false, today)).toBeNull();
  });
});

describe("recurrenceLabel", () => {
  it("labels one-off, weekly, monthly, monthly end-of-month, and yearly correctly", () => {
    expect(recurrenceLabel(null, false)).toBe("One-off");
    expect(recurrenceLabel("weekly", false)).toBe("Weekly");
    expect(recurrenceLabel("monthly", false)).toBe("Monthly");
    expect(recurrenceLabel("monthly", true)).toBe("Monthly (last day)");
    expect(recurrenceLabel("yearly", false)).toBe("Yearly");
  });
});
