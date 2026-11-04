import { computeNextOccurrence, formatDateOnly } from "./alerts";

// Recurring reminders (added Sep 26 2026, redesigned same day after real-world use).
//
// FIRST design tried was "advance in place": marking a recurring reminder done
// updated its own remind_at forward to the next date. Replaced because it left
// no way to actually delete a recurring reminder you no longer want — "Done"
// was the only button, and it never removed the row, just kept moving it.
//
// This version instead mirrors the GIRO-tagged insurance/investment premiums in
// alerts.ts exactly: remind_at is a fixed ANCHOR date (like a premium's
// start_date) that's never rewritten. The dashboard/entity page always shows
// the nearest computed occurrence on/after today — same as computeNextOccurrence
// — and it never goes "overdue"; a missed cycle just quietly rolls to the next
// one, nothing for the user to act on. Marking "Done" on a reminder's own
// record page (RemindersList.tsx) now always means "delete this reminder
// entirely" — the ONLY way to remove one, recurring or not, matching how a
// one-off reminder already worked. Dismissing a single occurrence from the
// Dashboard's "X" (unchanged code, index.tsx's dismissItem) still just
// suppresses that one date — since only one occurrence is ever shown at a
// time for a reminder, next cycle's date won't match the old dismissal's key
// and reappears on its own, with no schema change needed for this to work
// correctly.

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
 * Given a recurring reminder's fixed anchor date (remind_at, never rewritten),
 * returns the nearest occurrence ON OR AFTER today — GIRO-style: if the anchor
 * itself is still in the future, returns it unchanged; if it's already passed,
 * steps forward in whole intervals (skipping any number of missed cycles)
 * until landing on/after today. Never returns a date in the past — a recurring
 * reminder is never "overdue", the same rule computeRecurringAlerts uses for a
 * GIRO-tagged premium (see alerts.ts).
 *
 * Reuses alerts.ts's own computeNextOccurrence for the "monthly, same day of
 * month" and "yearly" cases — that function already has exactly this
 * on-or-after-today, re-derive-from-the-original-day-each-step behaviour, so
 * there's no reason to duplicate it. Only "weekly" (not a supported frequency
 * there) and "monthly + end of month" (no such option there) get their own
 * small loops below.
 *
 * Returns null for a one-off reminder (no recurrence set) — callers should
 * just use remind_at directly in that case, exactly as before recurring
 * reminders existed.
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
    let occurrence = new Date(start);
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

  if (recurrence === "monthly" && endOfMonth) {
    let monthsAdded = 0;
    // Last day of (start's month + monthsAdded) — day 0 of the month after rolls back one day.
    let occurrence = new Date(start.getFullYear(), start.getMonth() + monthsAdded + 1, 0);
    let guard = 0;
    while (occurrence.getTime() < today.getTime() && guard < 1000) {
      monthsAdded += 1;
      occurrence = new Date(start.getFullYear(), start.getMonth() + monthsAdded + 1, 0);
      guard++;
    }
    return formatDateOnly(occurrence);
  }

  if (recurrence === "monthly") {
    return computeNextOccurrence(remindAt, "monthly", null, today);
  }

  if (recurrence === "yearly") {
    return computeNextOccurrence(remindAt, "annual", null, today);
  }

  return null; // one-off, or unrecognised recurrence value
}

/** Calendar date (YYYY-MM-DD, local) of a stored reminder moment — the exact inverse of how
 * ReminderButton saves it (`new Date(`${date}T12:00:00`)`), so the edit form shows the same
 * day the user originally picked. Returns "" if the value is missing or invalid. */
export function reminderDateInputValue(remindAt: string | null | undefined): string {
  if (!remindAt) return "";
  const d = new Date(remindAt);
  return isNaN(d.getTime()) ? "" : formatDateOnly(d);
}

export type ReminderEditForm = {
  what: string;
  date: string; // YYYY-MM-DD
  recurrence: string; // "" = one-off
  endOfMonth: boolean;
};

/**
 * Builds the database patch for editing a reminder. Only the four user-editable columns can
 * ever appear in it (never entity_type / entity_id / household_id / dismissed). `remind_at` is
 * included ONLY if the user actually picked a different date, so a text-only edit never
 * rewrites the stored moment. Returns null when nothing changed.
 */
export function buildReminderEditPatch(
  original: {
    what: string | null;
    remind_at: string | null;
    recurrence: string | null;
    recurrence_end_of_month: boolean | null;
  },
  form: ReminderEditForm,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const what = form.what.trim();
  if (what !== (original.what ?? "")) patch.what = what;
  if (form.date && form.date !== reminderDateInputValue(original.remind_at)) {
    patch.remind_at = new Date(`${form.date}T12:00:00`).toISOString();
  }
  const recurrence = form.recurrence || null;
  if (recurrence !== (original.recurrence ?? null)) patch.recurrence = recurrence;
  const endOfMonth = form.recurrence === "monthly" ? form.endOfMonth : false;
  if (endOfMonth !== !!original.recurrence_end_of_month) patch.recurrence_end_of_month = endOfMonth;
  return Object.keys(patch).length ? patch : null;
}
