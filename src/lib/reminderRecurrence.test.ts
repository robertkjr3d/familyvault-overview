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

  it("weekly: steps forward exactly 7 days when already overdue", () => {
    expect(computeNextReminderDate("2026-06-15", "weekly", false, today)).toBe("2026-06-22");
  });

  it("weekly: keeps stepping 7 days at a time past several missed weeks, landing on/after today", () => {
    // Last occurrence was 2026-05-01 — many weeks ago.
    expect(computeNextReminderDate("2026-05-01", "weekly", false, today)).toBe("2026-06-19");
  });

  it("weekly: still advances a full 7 days even when remind_at is already in the future (marked done early)", () => {
    expect(computeNextReminderDate("2026-07-01", "weekly", false, today)).toBe("2026-07-08");
  });

  it("monthly: advances one month, same day of month", () => {
    expect(computeNextReminderDate("2026-06-05", "monthly", false, today)).toBe("2026-07-05");
  });

  it("monthly: clamps Jan 31 to Feb 28 in a non-leap year, then back to Mar 31 (re-derives from the original day, doesn't compound)", () => {
    const jan31 = "2026-01-31";
    const afterJan = computeNextReminderDate(jan31, "monthly", false, new Date(2026, 0, 31));
    expect(afterJan).toBe("2026-02-28"); // 2026 is not a leap year
    const afterFeb = computeNextReminderDate(jan31, "monthly", false, new Date(2026, 2, 1));
    expect(afterFeb).toBe("2026-03-31"); // not dragged down to the 28th
  });

  it("monthly: still advances a full month even when remind_at is already in the future", () => {
    expect(computeNextReminderDate("2026-07-05", "monthly", false, today)).toBe("2026-08-05");
  });

  it("monthly + end of month: always lands on the last day of the month, regardless of the original day", () => {
    expect(computeNextReminderDate("2026-06-05", "monthly", true, today)).toBe("2026-07-31");
  });

  it("monthly + end of month: Jan 31 end-of-month reminder correctly lands on Feb 28, then Mar 31", () => {
    const afterJan = computeNextReminderDate("2026-01-31", "monthly", true, new Date(2026, 0, 31));
    expect(afterJan).toBe("2026-02-28");
    const afterFeb = computeNextReminderDate("2026-01-31", "monthly", true, new Date(2026, 2, 1));
    expect(afterFeb).toBe("2026-03-31");
  });

  it("yearly: advances one year, same month and day", () => {
    expect(computeNextReminderDate("2026-06-05", "yearly", false, today)).toBe("2027-06-05");
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
