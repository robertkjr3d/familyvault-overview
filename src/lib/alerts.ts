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
};

export type AlertSourceData = {
  properties: any[];
  loans: any[];
  insurance: any[];
  investments: any[];
  savings: any[];
  inventoryItems: any[];
  reminders: any[];
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

  // Advance from the start date by whole intervals until we land on or after today.
  // Using setMonth repeatedly (rather than a division) avoids day-of-month drift
  // (e.g. Jan 31 + 1 month should not silently become Mar 3).
  let occurrence = new Date(start);
  let guard = 0;
  while (occurrence.getTime() < today.getTime() && guard < 1000) {
    occurrence = new Date(occurrence);
    occurrence.setMonth(occurrence.getMonth() + intervalMonths);
    guard++;
  }

  if (endDateStr && occurrence.getTime() > new Date(endDateStr).getTime()) return null;

  return occurrence.toISOString().slice(0, 10);
}

/**
 * Single source of truth for every date-based "upcoming/overdue" alert in the app.
 * Used by both the dashboard's 90-day view and the bell header's 30-day view —
 * any new alert source must only be added here, never duplicated.
 *
 * horizonDays: how far into the future to look (dashboard = 90, bell = 30)
 * today: injected so callers can use a consistent "now" (e.g. useToday())
 */
export function buildUpcomingItems(
  data: AlertSourceData,
  today: Date,
  horizonDays: number
): UpcomingItem[] {
  const horizon = addDays(today, horizonDays);
  const items: UpcomingItem[] = [];

  function daysUntil(dateStr: string) {
    const d = parseISO(dateStr);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function within(dateStr: string | null | undefined): boolean {
    if (!dateStr) return false;
    return isBefore(parseISO(dateStr), horizon);
  }

  for (const p of data.insurance) {
    const nextOccurrence = computeNextOccurrence(p.start_date, p.frequency, p.end_date, today);
    if (nextOccurrence && within(nextOccurrence)) {
      items.push({ date: nextOccurrence, label: p.name, amount: p.premium, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_next_due", daysLeft: daysUntil(nextOccurrence), icon: Shield, kind: "Insurance" });
    }
    if (within(p.end_date)) {
      items.push({ date: p.end_date, label: `${p.name} — policy ends`, amount: null, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_end", daysLeft: daysUntil(p.end_date), icon: Shield, kind: "Insurance" });
    }
  }

  for (const p of data.properties) {
    if (within(p.fixed_rate_end)) {
      items.push({ date: p.fixed_rate_end, label: `${p.name} — fixed rate ends`, amount: null, member_id: p.member_id, href: "/property", recordId: p.id, sourceType: "property_fixed_rate", daysLeft: daysUntil(p.fixed_rate_end), icon: Building2, kind: "Property" });
    }
  }

  for (const l of data.loans) {
    if (within(l.reprice_date)) {
      items.push({ date: l.reprice_date, label: `${l.bank} loan — reprice`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, sourceType: "loan_reprice", daysLeft: daysUntil(l.reprice_date), icon: Landmark, kind: "Loan" });
    }
    if (within(l.loan_end_date)) {
      items.push({ date: l.loan_end_date, label: `${l.bank} loan — fully repaid`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, sourceType: "loan_end", daysLeft: daysUntil(l.loan_end_date), icon: Landmark, kind: "Loan" });
    }
  }

  for (const inv of data.investments) {
    const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
    if (!isILP) continue;
    const nextOccurrence = computeNextOccurrence(inv.premium_start_date, inv.premium_frequency, inv.premium_end_date, today);
    if (nextOccurrence && within(nextOccurrence)) {
      items.push({ date: nextOccurrence, label: `${inv.name} — premium due`, amount: inv.premium_amount, member_id: inv.member_id, href: "/investments", recordId: inv.id, sourceType: "investment_premium_due", daysLeft: daysUntil(nextOccurrence), icon: TrendingUp, kind: "Invest" });
    }
    if (within(inv.premium_end_date)) {
      items.push({ date: inv.premium_end_date, label: `${inv.name} — premiums end`, amount: null, member_id: inv.member_id, href: "/investments", recordId: inv.id, sourceType: "investment_premium_end", daysLeft: daysUntil(inv.premium_end_date), icon: TrendingUp, kind: "Invest" });
    }
  }

  for (const s of data.savings) {
    if (within(s.maturity_date)) {
      items.push({ date: s.maturity_date, label: `${s.institution ?? "FD"} matures`, amount: s.balance, member_id: s.member_id, href: "/savings", recordId: s.id, sourceType: "savings_maturity", daysLeft: daysUntil(s.maturity_date), icon: PiggyBank, kind: "Savings" });
    }
  }

  for (const it of data.inventoryItems) {
    if (within(it.warranty_date)) {
      items.push({ date: it.warranty_date, label: `${it.name} — warranty/expiry`, amount: null, member_id: it.member_id, href: "/inventory", recordId: it.id, sourceType: "inventory_warranty", daysLeft: daysUntil(it.warranty_date), icon: Package, kind: "Inventory" });
    }
  }

  for (const r of data.reminders) {
    const dateStr = r.remind_at.slice(0, 10);
    if (within(dateStr)) {
      const href = reminderHref(r.entity_type);
      const recordId = r.entity_id ?? r.id;
      items.push({ date: dateStr, label: r.what ?? "Reminder", amount: null, member_id: null, href, recordId, sourceType: "reminder", daysLeft: daysUntil(dateStr), icon: Bell, kind: "Reminder" });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}
