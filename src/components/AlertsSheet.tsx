import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Building2, Shield, Landmark, TrendingUp, Heart, PiggyBank, Bell, ChevronRight, Gem } from "lucide-react";
import { MemberTag } from "./MemberTag";
import { addDays, parseISO } from "date-fns";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";

const SOURCES = [
  { table: "properties",         href: "/property",    kind: "Property",  icon: Building2,  title: (r: any) => r.name },
  { table: "loans",              href: "/loans",       kind: "Loan",      icon: Landmark,   title: (r: any) => `${r.bank} · ${r.purpose ?? ""}` },
  { table: "insurance_policies", href: "/insurance",   kind: "Insurance", icon: Shield,     title: (r: any) => r.name },
  { table: "investments",        href: "/investments", kind: "Invest",    icon: TrendingUp, title: (r: any) => r.name },
  { table: "health_conditions",  href: "/health",      kind: "Health",    icon: Heart,      title: (r: any) => r.name },
  { table: "other_assets",       href: "/other-assets", kind: "Asset",   icon: Gem,        title: (r: any) => r.name },
] as const;

type DueSoonItem = {
  label: string;
  date: string;
  sourceType: string;
  daysLeft: number;
  amount?: number | null;
  href: string;
  recordId: string;
  member_id?: string | null;
  icon: any;
  kind: string;
};

function reminderHref(entityType: string | null | undefined): string {
  switch (entityType) {
    case "loan":        return "/loans";
    case "property":    return "/property";
    case "insurance":   return "/insurance";
    case "savings":     return "/savings";
    case "investment":  return "/investments";
    case "health":      return "/health";
    case "inventory":   return "/inventory";
    case "other_assets":
    case "other_asset": return "/other-assets";
    default:            return "/";
  }
}

async function fetchDueSoonItems(today: Date, householdId: string): Promise<DueSoonItem[]> {
  const horizonStr = addDays(today, 30).toISOString().slice(0, 10);
  const items: DueSoonItem[] = [];

  function daysUntil(dateStr: string) {
    return Math.ceil((parseISO(dateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const [insurance, properties, loans, savings, reminders, dismissed] = await Promise.all([
    supabase.from("insurance_policies").select("*").eq("household_id", householdId).lte("next_due_date", horizonStr).then((r) => r.data ?? []),
    supabase.from("properties").select("*").eq("household_id", householdId).lte("fixed_rate_end", horizonStr).then((r) => r.data ?? []),
    supabase.from("loans").select("*").eq("household_id", householdId).lte("reprice_date", horizonStr).then((r) => r.data ?? []),
    supabase.from("savings_accounts").select("*").eq("household_id", householdId).lte("maturity_date", horizonStr).then((r) => r.data ?? []),
    supabase.from("reminders").select("*").eq("household_id", householdId).eq("dismissed", false).lte("remind_at", horizonStr).then((r) => r.data ?? []),
    supabase.from("dismissed_dashboard_items").select("record_id, source_type, dismissed_date").eq("household_id", householdId).then((r) => r.data ?? []),
  ]);

  const dismissedKeys = new Set(
    dismissed.map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`)
  );

  for (const p of insurance) {
    if (p.next_due_date && !dismissedKeys.has(`insurance_next_due::${p.id}::${p.next_due_date}`)) {
      items.push({ label: p.name, date: p.next_due_date, sourceType: "insurance_next_due", daysLeft: daysUntil(p.next_due_date), amount: p.premium, href: "/insurance", recordId: p.id, member_id: p.member_id, icon: Shield, kind: "Insurance" });
    }
    if (p.end_date && p.end_date <= horizonStr && !dismissedKeys.has(`insurance_end::${p.id}::${p.end_date}`)) {
      items.push({ label: `${p.name} — policy ends`, date: p.end_date, sourceType: "insurance_end", daysLeft: daysUntil(p.end_date), amount: null, href: "/insurance", recordId: p.id, member_id: p.member_id, icon: Shield, kind: "Insurance" });
    }
  }
  for (const p of properties) {
    if (p.fixed_rate_end && !dismissedKeys.has(`property_fixed_rate::${p.id}::${p.fixed_rate_end}`)) {
      items.push({ label: `${p.name} — fixed rate ends`, date: p.fixed_rate_end, sourceType: "property_fixed_rate", daysLeft: daysUntil(p.fixed_rate_end), amount: null, href: "/property", recordId: p.id, member_id: p.member_id, icon: Building2, kind: "Property" });
    }
  }
  for (const l of loans) {
    if (l.reprice_date && !dismissedKeys.has(`loan_reprice::${l.id}::${l.reprice_date}`)) {
      items.push({ label: `${l.bank} loan — reprice`, date: l.reprice_date, sourceType: "loan_reprice", daysLeft: daysUntil(l.reprice_date), amount: null, href: "/loans", recordId: l.id, member_id: l.member_id, icon: Landmark, kind: "Loan" });
    }
  }
  for (const s of savings) {
    if (s.maturity_date && !dismissedKeys.has(`savings_maturity::${s.id}::${s.maturity_date}`)) {
      items.push({ label: `${s.institution} FD matures`, date: s.maturity_date, sourceType: "savings_maturity", daysLeft: daysUntil(s.maturity_date), amount: s.balance, href: "/savings", recordId: s.id, member_id: s.member_id, icon: PiggyBank, kind: "Savings" });
    }
  }
  for (const r of reminders) {
    const dateStr = r.remind_at.slice(0, 10);
    const href = reminderHref(r.entity_type);
    const recordId = r.entity_id ?? r.id;
    if (!dismissedKeys.has(`reminder::${recordId}::${dateStr}`)) {
      items.push({ label: r.what ?? "Reminder", date: dateStr, sourceType: "reminder", daysLeft: daysUntil(dateStr), amount: null, href, recordId, member_id: null, icon: Bell, kind: "Reminder" });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export function AlertsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const today = new Date();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);

  const { data } = useQuery({
    queryKey: ["alerts-all", activeHouseholdId],
    enabled: open && !!activeHouseholdId,
    queryFn: async () => {
      const [statusResults, dueSoon] = await Promise.all([
        Promise.all(
          SOURCES.map(async (s) => {
            const { data } = await supabase
              .from(s.table as any)
              .select("*")
              .eq("household_id", activeHouseholdId!)
              .in("status", ["urgent", "review"]);
            return (data ?? []).map((row: any) => ({ row, src: s }));
          }),
        ),
        fetchDueSoonItems(today, activeHouseholdId!),
      ]);
      const allStatus = statusResults.flat();
      return { allStatus, dueSoon };
    },
  });

  const allStatus = data?.allStatus ?? [];
  const dueSoon = data?.dueSoon ?? [];
  const urgent = allStatus.filter((x) => x.row.status === "urgent");
  const review = allStatus.filter((x) => x.row.status === "review");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Alerts</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {dueSoon.length === 0 && urgent.length === 0 && review.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing to action right now ✓</p>
          )}
          {dueSoon.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                🗓 Due Soon <span className="text-foreground">({dueSoon.length})</span>
              </h3>
              <ul className="space-y-2">
                {dueSoon.map((item, i) => {
                  const Icon = item.icon;
                  const isOverdue = item.daysLeft < 0;
                  const isUrgent = item.daysLeft <= 7;
                  return (
                    <li key={i}>
                      <Link
                        to={item.href as any}
                        hash={`record-${item.recordId}`}
                        onClick={() => onOpenChange(false)}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50"
                      >
                        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase text-muted-foreground">{item.kind}</span>
                            <span className="truncate text-sm font-semibold">{item.label}</span>
                            <MemberTag memberId={item.member_id} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span className={`font-bold ${isOverdue ? "text-urgent" : isUrgent ? "text-urgent" : "text-primary"}`}>
                              {isOverdue ? `${Math.abs(item.daysLeft)}d overdue` : isUrgent ? `${item.daysLeft}d left` : fmtDate(item.date)}
                            </span>
                            {item.amount != null && <span className="text-muted-foreground">{fmtMoney(item.amount)}</span>}
                          </div>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                          View <ChevronRight className="h-3 w-3" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <Group title="🔴 Urgent" items={urgent} empty="No urgent items." onNav={() => onOpenChange(false)} />
          <Group title="🟡 Review Needed" items={review} empty="Nothing to review." onNav={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Group({ title, items, empty, onNav }: { title: string; items: any[]; empty: string; onNav: () => void }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title} <span className="text-foreground">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map(({ row, src }, i) => {
            const Icon = src.icon;
            return (
              <li key={i}>
                <Link
                  to={src.href as any}
                  hash={`record-${row.id}`}
                  onClick={onNav}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50"
                >
                  <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{src.kind}</span>
                      <span className="truncate text-sm font-semibold">{src.title(row)}</span>
                      <MemberTag memberId={row.member_id} />
                    </div>
                    {(row.action_note || row.action || row.strategy) && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {row.action_note || row.action || row.strategy}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                    View <ChevronRight className="h-3 w-3" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function useAlertsSheet() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}
