// Estimated premiums paid for an ILP / Endowment investment.
//
// WHAT THIS IS: a plain calculation done every time the Investments page is
// shown. Nothing is saved anywhere. It never changes `cost_basis` ("Amount
// invested", the figure the person types), so switching a policy back to Manual
// brings their own number straight back. `current_value` is never touched.
//
// RULES (agreed with the owner, 22 Nov 2026):
//  - Only when the policy's "Amount invested tracking" is set to Estimated.
//  - Counts scheduled payments from the premium start date (the first payment
//    falls ON the start date) up to and including today, and never beyond the
//    premium end date (a payment ON the end date counts).
//  - Month-end dates follow the same rule as the premium reminders in alerts.ts:
//    each payment date is worked out from the ORIGINAL start day, so a policy
//    starting on 31 Jan pays 31 Jan, 28 Feb, 31 Mar (not stuck on the 28th).
//  - Frequencies: monthly, quarterly, semi-annual, annual. A blank frequency
//    means annual, exactly as everywhere else in the app (the form says
//    "annual if left blank"). One-off or any unrecognised word cannot be
//    estimated.
//  - If it cannot be estimated (no amount, no start date, end before start, or
//    a frequency above that is not recurring) the person's typed Amount invested
//    is used instead and the card says so. It never silently becomes 0.
//
// WHY A NEW FILE: computeRecurringAlerts() in alerts.ts only returns the latest
// overdue date plus upcoming ones, and returns nothing once a schedule has
// ended, so it cannot be used to count past payments. The date stepping below
// is checked against it in premiumsPaid.test.ts so the two cannot drift apart.

export const INVESTED_TRACKING_MANUAL = "manual";
export const INVESTED_TRACKING_ESTIMATED = "estimated";

const FREQ_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  "semi-annual": 6,
  annual: 12,
};

// Same two groups the form shows the premium fields for (recordConfigs.ts) and
// that InvestmentRow treats as ILP / Endowment.
export function isPremiumPolicyGroup(groupName: string | null | undefined): boolean {
  return groupName === "ILP (Investment-Linked Policy)" || groupName === "Endowment";
}

// "YYYY-MM-DD" (optionally followed by a time) -> local calendar date at 00:00.
// Built from the written numbers, never through UTC, so the result is the same
// in every timezone.
function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  // Reject impossible dates such as 2025-02-31 (JS would roll them over).
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The date of payment number `k` (k = 0 is the start date).
function paymentDate(start: Date, intervalMonths: number, k: number): Date {
  const targetMonthIndex = start.getMonth() + k * intervalMonths;
  const result = new Date(start.getFullYear(), targetMonthIndex, 1);
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(start.getDate(), lastDayOfTargetMonth));
  return result;
}

// How many scheduled payments fall on or before today (and on or before the end
// date). Returns null when the schedule cannot be worked out.
export function countPremiumPayments(
  startDate: string | null | undefined,
  frequency: string | null | undefined,
  endDate: string | null | undefined,
  today: Date = new Date(),
): number | null {
  const start = parseDateOnly(startDate);
  if (!start) return null;

  const freq = (frequency || "annual").toLowerCase();
  const intervalMonths = FREQ_MONTHS[freq];
  if (!intervalMonths) return null; // one-off or unrecognised

  let end: Date | null = null;
  if (endDate) {
    end = parseDateOnly(endDate);
    if (!end) return null; // an end date was given but cannot be read: do not guess
    if (end.getTime() < start.getTime()) return null; // end before start: bad data
  }

  const todayStart = startOfDay(today);
  const lastDay = end && end.getTime() < todayStart.getTime() ? end : todayStart;

  let count = 0;
  // 12,000 payments = 1,000 years of monthly payments; only a safety stop.
  for (let k = 0; k < 12000; k++) {
    if (paymentDate(start, intervalMonths, k).getTime() > lastDay.getTime()) break;
    count++;
  }
  return count;
}

// The few fields of an investment this calculation reads.
export type InvestmentForEstimate = {
  group_name?: string | null;
  invested_tracking?: string | null;
  cost_basis?: number | null;
  premium_amount?: number | null;
  premium_start_date?: string | null;
  premium_frequency?: string | null;
  premium_end_date?: string | null;
};

export type InvestedAmount = {
  // The number to use as "Amount invested". In Manual mode this is the stored
  // value, returned EXACTLY as stored (null / undefined stay as they are), so
  // Manual mode behaves exactly as it did before this feature existed.
  amount: number | null | undefined;
  // 'manual'    - the person's typed figure
  // 'estimated' - worked out from premiums
  // 'fallback'  - Estimated was chosen but cannot be worked out, so the typed
  //               figure is used
  mode: "manual" | "estimated" | "fallback";
  payments?: number;
};

export function effectiveInvested(
  inv: InvestmentForEstimate | null | undefined,
  today: Date = new Date(),
): InvestedAmount {
  if (
    inv?.invested_tracking !== INVESTED_TRACKING_ESTIMATED ||
    !isPremiumPolicyGroup(inv?.group_name)
  ) {
    return { amount: inv?.cost_basis, mode: "manual" };
  }
  const premium = Number(inv.premium_amount);
  const payments = countPremiumPayments(
    inv.premium_start_date,
    inv.premium_frequency,
    inv.premium_end_date,
    today,
  );
  if (!Number.isFinite(premium) || premium <= 0 || payments == null) {
    return { amount: inv.cost_basis, mode: "fallback" };
  }
  // Rounded to cents so repeated additions never show 0.30000000000000004.
  return { amount: Math.round(premium * payments * 100) / 100, mode: "estimated", payments };
}
