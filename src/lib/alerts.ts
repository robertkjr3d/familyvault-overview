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
    if (within(p.next_due_date)) {
      items.push({ date: p.next_due_date, label: p.name, amount: p.premium, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_next_due", daysLeft: daysUntil(p.next_due_date), icon: Shield, kind: "Insurance" });
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
    if (isILP && within(inv.premium_end_date)) {
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
