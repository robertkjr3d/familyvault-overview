import { addDays, isBefore, parseISO } from "date-fns";
import { Building2, Shield, Landmark, TrendingUp, PiggyBank, Bell, Package } from "lucide-react";

export type UpcomingItem = {
  date: string;
  label: string;
  amount?: number | null;
  member_id?: string | null;
  href: string;
  recordId: string;
  sourceType: string;
  daysLeft: number;
  icon: any;
  kind: string;
  /** True once this occurrence's date has passed without being dismissed — only ever
   * set for non-GIRO recurring premiums. GIRO items never go overdue (see isGiro on
   * the source record) since the bank pays automatically; they simply roll forward. */
  overdue?: boolean;
  /** Mirrors the source record's is_giro flag, so the UI can show a [GIRO] tag. */
  isGiro?: boolean;
  /** Only set when sourceType === "reminder" — the reminder row's own id, distinct from
   * recordId (which is the entity_id it's attached to). Needed so a permanent delete can
   * target the exact reminder row, since an entity can have multiple reminders. */
  reminderId?: string;
};

export type AlertSourceData = {
  properties: any[];
  loans: any[];
  insurance: any[];
  investments: any[];
  savings: any[];
  inventoryItems: any[];
  reminders: any[];
  otherAssets?: any[];
};

export function reminderHref(entityType: string | null | undefined): string {
  switch (entityType) {
    case "loan": return "/loans";
    case "property": return "/property";
    case "insurance": return "/insurance";
    case "savings": return "/savings";
    case "investment": return "/investments";
    case "health": return "/health";
    case "inventory": return "/inventory";
    case "other_assets":
    case "other_asset": return "/other-assets";
    default: return "/";
  }
}

const FREQ_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  "semi-annual": 6,
  annual: 12,
};

/**
 * Formats a Date's LOCAL calendar date as YYYY-MM-DD.
 *
 * REAL PRODUCTION BUG (found Aug 17, 2026): every occurrence date in this file is
 * built with `new Date(year, month, day)` — a local-timezone constructor — but was
 * then serialized with `occurrence.toISOString().slice(0, 10)`, which converts
 * through UTC. Those two agree only when the code happens to run in UTC. This
 * function is called from the browser (household dashboard — runs in the user's
 * own timezone, e.g. Asia/Singapore, UTC+8) AND from a Cloudflare Workers server
 * function (the advisor dashboard — runs in UTC). For the exact same premium, SGT
 * local midnight converts to the PREVIOUS UTC calendar day, while UTC local
 * midnight doesn't shift at all — so the same occurrence produced two different
 * date strings depending on which side computed it. Concretely reproduced:
 * new Date(2026,6,17) → toISOString().slice(0,10) gives "2026-07-17" when the
 * process runs in TZ=UTC but "2026-07-16" when it runs in TZ=Asia/Singapore.
 * This silently broke dismissal-key matching between the household's own
 * dashboard (client-computed date) and the FA dashboard (server-computed date)
 * for the same alert. Fix: never round-trip through UTC for a date-only value —
 * read back the same local y/m/d components the Date was built from, so the
 * string is identical no matter which timezone the runtime executes in.
 */
function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Given a recurring premium/payment's start date and frequency, find the next
 * occurrence on or after `today` — entirely derived, no manually-maintained
 * "next due date" field to go stale. Used for both Insurance premiums and
 * ILP/Endowment premiums, which share the same start/frequency/end shape.
 *
 * Returns null if frequency is "one-off"/unrecognised, if startDate is missing,
 * or if the recurring schedule has already ended (endDate in the past).
 */
export function computeNextOccurrence(
  startDateStr: string | null | undefined,
  frequency: string | null | undefined,
  endDateStr: string | null | undefined,
  today: Date
): string | null {
  if (!startDateStr) return null;
  const freq = (frequency || "annual").toLowerCase();
  const intervalMonths = FREQ_MONTHS[freq];
  if (!intervalMonths) return null; // one-off, or unrecognised — no recurring "next due"

  if (endDateStr && new Date(endDateStr).getTime() < today.getTime()) return null;

  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return null;

  // Advance from the start date by whole intervals until landing on or after
  // today. Each step re-derives from the ORIGINAL start day (not the previous
  // step's result) and clamps to the target month's actual length — e.g. a
  // start date of Jan 31 with a monthly frequency correctly lands on Feb 28,
  // not Mar 3. Re-deriving from the original day each time (rather than
  // compounding off a previously-clamped date) also avoids the clamp
  // permanently "losing" the 31st in later months (Mar 31 stays 31, it isn't
  // dragged down to 28 just because Feb had to clamp).
  function addMonthsFromStart(monthsToAdd: number): Date {
    const targetMonthIndex = start.getMonth() + monthsToAdd;
    const result = new Date(start.getFullYear(), targetMonthIndex, 1);
    const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(start.getDate(), lastDayOfTargetMonth));
    return result;
  }

  let monthsAdded = 0;
  let occurrence = new Date(start);
  let guard = 0;
  while (occurrence.getTime() < today.getTime() && guard < 1000) {
    monthsAdded += intervalMonths;
    occurrence = addMonthsFromStart(monthsAdded);
    guard++;
  }

  if (endDateStr && occurrence.getTime() > new Date(endDateStr).getTime()) return null;

  return formatDateOnly(occurrence);
}

export type RecurringOccurrence = { date: string; overdue: boolean };

/**
 * Like computeNextOccurrence, but for the "due soon" alert list specifically:
 * - Returns EVERY occurrence within the horizon window, not just the nearest one —
 *   a monthly premium can have several distinct upcoming dates within a 90-day window.
 * - For non-GIRO items, also returns the single most recently missed occurrence
 *   (if any) flagged as overdue — it does NOT silently jump forward past a missed
 *   payment the way computeNextOccurrence does. Only the latest missed occurrence is
 *   ever returned (not one per missed cycle), so a policy neglected for years still
 *   shows exactly one "overdue" line, not a pile of historical ones.
 * - GIRO items (isGiro: true) never appear as overdue — a missed occurrence is
 *   silently skipped, matching computeNextOccurrence's original behaviour, since the
 *   bank pays automatically and there is nothing for the user to act on.
 *
 * computeNextOccurrence itself is left untouched — it's still used for the informational
 * "Renew by" date shown elsewhere, which intentionally always shows the next upcoming
 * date regardless of overdue state.
 */
export function computeRecurringAlerts(
  startDateStr: string | null | undefined,
  frequency: string | null | undefined,
  endDateStr: string | null | undefined,
  today: Date,
  horizonDays: number,
  isGiro: boolean
): RecurringOccurrence[] {
  if (!startDateStr) return [];
  const freq = (frequency || "annual").toLowerCase();
  const intervalMonths = FREQ_MONTHS[freq];
  if (!intervalMonths) return []; // one-off, or unrecognised — no recurring alerts

  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return [];

  const end = endDateStr ? new Date(endDateStr) : null;
  // Same guard as computeNextOccurrence: a schedule that has already fully ended has
  // nothing left to alert about, overdue or otherwise.
  if (end && end.getTime() < today.getTime()) return [];

  const horizonEnd = addDays(today, horizonDays);

  // Identical clamping logic to computeNextOccurrence's addMonthsFromStart — re-derives
  // from the ORIGINAL start day each time so Jan 31 -> Feb 28 -> Mar 31 (not stuck at 28).
  function addMonthsFromStart(monthsToAdd: number): Date {
    const targetMonthIndex = start.getMonth() + monthsToAdd;
    const result = new Date(start.getFullYear(), targetMonthIndex, 1);
    const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(start.getDate(), lastDayOfTargetMonth));
    return result;
  }

  const results: RecurringOccurrence[] = [];
  let mostRecentPast: Date | null = null;

  let monthsAdded = 0;
  let occurrence = new Date(start);
  let guard = 0;
  while (guard < 2000) {
    if (end && occurrence.getTime() > end.getTime()) break;
    if (occurrence.getTime() > horizonEnd.getTime()) break;

    if (occurrence.getTime() >= today.getTime()) {
      results.push({ date: formatDateOnly(occurrence), overdue: false });
    } else if (!isGiro && monthsAdded > 0) {
      // monthsAdded > 0 excludes the very first occurrence (the record's own start_date)
      // from ever being flagged overdue — that date is when the policy/premium began,
      // presumably already handled at setup, not a missed recurring payment. Only later
      // occurrences (start_date + 1 interval or more) represent a genuine missed cycle.
      mostRecentPast = occurrence; // keep overwriting — we only want the LATEST one
    }

    monthsAdded += intervalMonths;
    occurrence = addMonthsFromStart(monthsAdded);
    guard++;
  }

  if (mostRecentPast) {
    results.unshift({ date: formatDateOnly(mostRecentPast), overdue: true });
  }

  return results;
}

export type AlertCategoryDays = {
  mortgage_days?: number | null;
  insurance_days?: number | null;
  fd_days?: number | null;
  warranty_days?: number | null;
};

/**
 * Single source of truth for every date-based "upcoming/overdue" alert in the app.
 * Used by both the dashboard's 90-day view and the bell header's 30-day view —
 * any new alert source must only be added here, never duplicated.
 *
 * horizonDays: how far into the future to look (dashboard = 90, bell = 30)
 * today: injected so callers can use a consistent "now" (e.g. useToday())
 * categoryDays: optional, household-configurable lead time per category
 *   (Settings → Alerts & Reminders). Each category's effective window is
 *   capped at min(horizonDays, categoryDays.x) — a category setting can only
 *   narrow the view's existing horizon, never widen it (e.g. setting
 *   "Insurance renewal alert" to 120 days still won't surface in the bell's
 *   30-day view; that view is intentionally short-range by design). Omit
 *   entirely for the old single-horizon behaviour.
 */
export function buildUpcomingItems(
  data: AlertSourceData,
  today: Date,
  horizonDays: number,
  categoryDays?: AlertCategoryDays
): UpcomingItem[] {
  function daysUntil(dateStr: string) {
    const d = parseISO(dateStr);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function within(dateStr: string | null | undefined, days: number = horizonDays): boolean {
    if (!dateStr) return false;
    return isBefore(parseISO(dateStr), addDays(today, days));
  }

  function categoryHorizon(override: number | null | undefined): number {
    if (override == null) return horizonDays;
    return Math.min(horizonDays, override);
  }

  const insuranceHorizon = categoryHorizon(categoryDays?.insurance_days);
  const mortgageHorizon = categoryHorizon(categoryDays?.mortgage_days);
  const fdHorizon = categoryHorizon(categoryDays?.fd_days);
  const warrantyHorizon = categoryHorizon(categoryDays?.warranty_days);

  const items: UpcomingItem[] = [];

  for (const p of data.insurance) {
    const occurrences = computeRecurringAlerts(p.start_date, p.frequency, p.end_date, today, insuranceHorizon, !!p.is_giro);
    for (const occ of occurrences) {
      items.push({
        date: occ.date,
        label: occ.overdue ? `${p.name} — premium overdue` : `${p.name} — premium due`,
        amount: p.premium,
        member_id: p.member_id,
        href: "/insurance",
        recordId: p.id,
        sourceType: "insurance_next_due",
        daysLeft: daysUntil(occ.date),
        icon: Shield,
        kind: "Insurance",
        overdue: occ.overdue,
        isGiro: !!p.is_giro,
      });
    }
    if (within(p.end_date, insuranceHorizon)) {
      items.push({ date: p.end_date, label: `${p.name} — policy ends`, amount: null, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_end", daysLeft: daysUntil(p.end_date), icon: Shield, kind: "Insurance" });
    }
  }

  for (const p of data.properties) {
    if (within(p.fixed_rate_end, mortgageHorizon)) {
      items.push({ date: p.fixed_rate_end, label: `${p.name} — fixed rate ends`, amount: null, member_id: p.member_id, href: "/property", recordId: p.id, sourceType: "property_fixed_rate", daysLeft: daysUntil(p.fixed_rate_end), icon: Building2, kind: "Property" });
    }
  }

  for (const l of data.loans) {
    if (within(l.reprice_date, mortgageHorizon)) {
      items.push({ date: l.reprice_date, label: `${l.bank} loan — reprice`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, sourceType: "loan_reprice", daysLeft: daysUntil(l.reprice_date), icon: Landmark, kind: "Loan" });
    }
    if (within(l.loan_end_date, mortgageHorizon)) {
      items.push({ date: l.loan_end_date, label: `${l.bank} loan — fully repaid`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, sourceType: "loan_end", daysLeft: daysUntil(l.loan_end_date), icon: Landmark, kind: "Loan" });
    }
  }

  for (const inv of data.investments) {
    const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
    if (!isILP) continue;
    const occurrences = computeRecurringAlerts(inv.premium_start_date, inv.premium_frequency, inv.premium_end_date, today, horizonDays, !!inv.is_giro);
    for (const occ of occurrences) {
      items.push({
        date: occ.date,
        label: occ.overdue ? `${inv.name} — premium overdue` : `${inv.name} — premium due`,
        amount: inv.premium_amount,
        member_id: inv.member_id,
        href: "/investments",
        recordId: inv.id,
        sourceType: "investment_premium_due",
        daysLeft: daysUntil(occ.date),
        icon: TrendingUp,
        kind: "Invest",
        overdue: occ.overdue,
        isGiro: !!inv.is_giro,
      });
    }
    if (within(inv.premium_end_date)) {
      items.push({ date: inv.premium_end_date, label: `${inv.name} — premiums end`, amount: null, member_id: inv.member_id, href: "/investments", recordId: inv.id, sourceType: "investment_premium_end", daysLeft: daysUntil(inv.premium_end_date), icon: TrendingUp, kind: "Invest" });
    }
  }

  for (const s of data.savings) {
    if (within(s.maturity_date, fdHorizon)) {
      items.push({ date: s.maturity_date, label: `${s.institution ?? "FD"} matures`, amount: s.balance, member_id: s.member_id, href: "/savings", recordId: s.id, sourceType: "savings_maturity", daysLeft: daysUntil(s.maturity_date), icon: PiggyBank, kind: "Savings" });
    }
  }

  for (const it of data.inventoryItems) {
    if (within(it.warranty_date, warrantyHorizon)) {
      items.push({ date: it.warranty_date, label: `${it.name} — warranty/expiry`, amount: null, member_id: it.member_id, href: "/inventory", recordId: it.id, sourceType: "inventory_warranty", daysLeft: daysUntil(it.warranty_date), icon: Package, kind: "Inventory" });
    }
  }

  // Map entity_type values to the already-loaded data arrays so we can look up
  // the entity's display name and member without an extra DB query.
  const entityLookup: Record<string, any[]> = {
    property:   data.properties,
    loan:       data.loans,
    insurance:  data.insurance,
    investment: data.investments,
    savings:    data.savings,
    inventory:  data.inventoryItems,
    other_asset: data.otherAssets ?? [],
    other_assets: data.otherAssets ?? [],
  };

  for (const r of data.reminders) {
    const dateStr = r.remind_at.slice(0, 10);
    if (within(dateStr)) {
      const href = reminderHref(r.entity_type);
      const recordId = r.entity_id ?? r.id;

      // Resolve the entity this reminder belongs to (may be null for health/other_assets
      // which are not in AlertSourceData).
      const list = entityLookup[r.entity_type ?? ""] ?? [];
      const entity = r.entity_id ? list.find((e: any) => e.id === r.entity_id) : null;
      const entityName: string | null = entity
        ? (entity.name || entity.bank || entity.institution || null)
        : null;
      const entityMemberId: string | null = entity?.member_id ?? null;

      // Show "Policy Name — what you typed" so the card is immediately identifiable.
      const label = entityName
        ? `${entityName} — ${r.what ?? "Reminder"}`
        : (r.what ?? "Reminder");

      items.push({ date: dateStr, label, amount: null, member_id: entityMemberId, href, recordId, sourceType: "reminder", daysLeft: daysUntil(dateStr), icon: Bell, kind: "Reminder", reminderId: r.id });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}
