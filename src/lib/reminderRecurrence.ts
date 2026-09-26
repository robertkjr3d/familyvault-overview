import { formatDateOnly } from "./alerts";

// Recurring reminders (added Sep 26 2026). Deliberately a SEPARATE, much simpler
// mechanism from the GIRO/insurance-premium recurring system in alerts.ts
// (computeNextOccurrence/computeRecurringAlerts):
//
// - GIRO/premiums are fully DERIVED — every upcoming occurrence within the
//   dashboard's horizon is computed fresh from start_date/frequency each time,
//   nothing is ever written back to the row.
// - A recurring reminder instead ADVANCES IN PLACE, like Apple/Google Reminders:
//   the same row's own remind_at is updated to the next date the moment the
//   user marks it done. Only ONE future occurrence is ever visible at a time.
//
// This was a deliberate choice over copying the GIRO model outright: this app's
// dashboard "mark done" table (dismissed_dashboard_items) uniquely keys a
// reminder-sourced dismissal by the reminder's own id alone (not id+date) —
// see index.tsx's dismissItem. Showing several future occurrences of the same
// recurring reminder at once, GIRO-style, would make two different occurrences'
// dismissals collide and overwrite each other under that key. Advancing a single
// row in place sidesteps that entirely and needed zero changes to alerts.ts,
// AlertsSheet.tsx, the dashboard's dismiss logic, or any RLS policy.

export const RECURRENCE_OPTIONS: { value: "" | "weekly" | "monthly" | "yearly"; label: string }[] =
  [
    { value: "", label: "One-off" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
  ];

/** Short display label for a reminder's recurrence, e.g. for a "↻ Monthly" tag. */
export function recurrenceLabel(
  recurrence: string | null | undefined,
  endOfMonth: boolean | null | undefined,
): string {
  if (recurrence === "weekly") return "Weekly";
  if (recurrence === "monthly") return endOfMonth ? "Monthly (last day)" : "Monthly";
  if (recurrence === "yearly") return "Yearly";
  return "One-off";
}

/**
 * Given a recurring reminder's CURRENT remind_at, returns the date its "Done"
 * button should advance it to. Returns null for a one-off reminder (no
 * recurrence set) — callers should dismiss those the old way (dismissed = true)
 * instead of calling this.
 *
 * Always moves forward by AT LEAST one full interval from remind_at, even if
 * remind_at is already in the future (a reminder can be marked done early on
 * this app — RemindersList shows all of a record's reminders, not just due
 * ones) — this is why it does NOT reuse alerts.ts's computeNextOccurrence
 * directly: that function can return the SAME date unchanged when the start
 * date is already on/after today, which would make "Done" silently do
 * nothing for a not-yet-due recurring reminder. If several intervals have
 * been missed (the reminder was neglected), it keeps stepping forward until
 * landing on the next occurrence on or after today, so it never reappears
 * already overdue in the past — same rule computeNextOccurrence uses.
 *
 * Monthly/yearly re-derive each candidate from the ORIGINAL remind_at day each
 * step (not by compounding off the previous step), clamped to each target
 * month's real length — e.g. a remind_at of Jan 31 with monthly recurrence
 * correctly lands on Feb 28 then Mar 31, not Feb 28 then Mar 28. Mirrors the
 * same clamping rule as computeNextOccurrence, for the same reason.
 */
export function computeNextReminderDate(
  remindAt: string,
  recurrence: string | null | undefined,
  endOfMonth: boolean | null | undefined,
  today: Date,
): string | null {
  if (!remindAt) return null;
  const start = new Date(remindAt);
  if (isNaN(start.getTime())) return null;

  if (recurrence === "weekly") {
    let occurrence = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    let guard = 0;
    while (occurrence.getTime() < today.getTime() && guard < 1000) {
      occurrence = new Date(
        occurrence.getFullYear(),
        occurrence.getMonth(),
        occurrence.getDate() + 7,
      );
      guard++;
    }
    return formatDateOnly(occurrence);
  }

  if (recurrence === "monthly" || recurrence === "yearly") {
    const intervalMonths = recurrence === "yearly" ? 12 : 1;

    function occurrenceAt(monthsAdded: number): Date {
      if (endOfMonth) {
        // Last day of (start's month + monthsAdded) — day 0 of the month after rolls back one day.
        return new Date(start.getFullYear(), start.getMonth() + monthsAdded + 1, 0);
      }
      const targetMonthIndex = start.getMonth() + monthsAdded;
      const result = new Date(start.getFullYear(), targetMonthIndex, 1);
      const lastDayOfTargetMonth = new Date(
        result.getFullYear(),
        result.getMonth() + 1,
        0,
      ).getDate();
      result.setDate(Math.min(start.getDate(), lastDayOfTargetMonth));
      return result;
    }

    let monthsAdded = intervalMonths; // always at least one full interval forward
    let occurrence = occurrenceAt(monthsAdded);
    let guard = 0;
    while (occurrence.getTime() < today.getTime() && guard < 1000) {
      monthsAdded += intervalMonths;
      occurrence = occurrenceAt(monthsAdded);
      guard++;
    }
    return formatDateOnly(occurrence);
  }

  return null; // one-off, or unrecognised recurrence value
}
