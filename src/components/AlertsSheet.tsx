import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Building2, Shield, Landmark, TrendingUp, Heart, ChevronRight, Gem, Wallet, Package } from "lucide-react";
import { MemberTag } from "./MemberTag";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { buildUpcomingItems } from "@/lib/alerts";
import type { UpcomingItem } from "@/lib/alerts";
import {
  useProperties,
  useLoans,
  useInsurancePolicies,
  useInvestments,
  useSavingsAccounts,
  useHealthConditions,
  useOtherAssets,
  useInventoryItems,
} from "@/lib/householdRecordQueries";

const SOURCES = [
  { table: "properties",         key: "properties",     href: "/property",     kind: "Property",  icon: Building2,  title: (r: any) => r.name },
  { table: "loans",              key: "loans",           href: "/loans",        kind: "Loan",      icon: Landmark,   title: (r: any) => `${r.bank} · ${r.purpose ?? ""}` },
  { table: "insurance_policies", key: "insurance",       href: "/insurance",    kind: "Insurance", icon: Shield,     title: (r: any) => r.name },
  { table: "investments",        key: "investments",     href: "/investments",  kind: "Invest",    icon: TrendingUp, title: (r: any) => r.name },
  { table: "health_conditions",  key: "health",          href: "/health",       kind: "Health",    icon: Heart,      title: (r: any) => r.name },
  { table: "other_assets",       key: "other_assets",    href: "/other-assets", kind: "Asset",     icon: Gem,        title: (r: any) => r.name },
  { table: "savings_accounts",   key: "savings",         href: "/savings",      kind: "Savings",   icon: Wallet,     title: (r: any) => r.institution },
  { table: "inventory_items",    key: "inventory_items", href: "/inventory",    kind: "Item",      icon: Package,    title: (r: any) => r.name },
] as const;

const BELL_HORIZON_DAYS = 30;

export function AlertsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const today = new Date();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const setMemberFilter = useAppStore((s) => s.setMemberFilter);
  const gate = open && !!activeHouseholdId;

  // Shared per-table data — uses the same query keys AppHeader/dashboard
  // use, so once those are migrated too, opening the bell will reuse
  // whatever's already cached instead of re-fetching from scratch.
  const propertiesQ = useProperties(activeHouseholdId, gate);
  const loansQ = useLoans(activeHouseholdId, gate);
  const insuranceQ = useInsurancePolicies(activeHouseholdId, gate);
  const investmentsQ = useInvestments(activeHouseholdId, gate);
  const savingsQ = useSavingsAccounts(activeHouseholdId, gate);
  const healthQ = useHealthConditions(activeHouseholdId, gate);
  const otherAssetsQ = useOtherAssets(activeHouseholdId, gate);
  const inventoryQ = useInventoryItems(activeHouseholdId, gate);

  const tableQueries = [propertiesQ, loansQ, insuranceQ, investmentsQ, savingsQ, healthQ, otherAssetsQ, inventoryQ];
  const tablesLoaded = tableQueries.every((q) => q.data !== undefined);

  // Reminders / dismissed-items / due-soon thresholds aren't part of the
  // shared per-table layer yet (kept as their own scoped query for now).
  const { data: extras } = useQuery({
    queryKey: ["alerts-extras", activeHouseholdId],
    enabled: gate,
    queryFn: async () => {
      const [reminders, dismissed, settings] = await Promise.all([
        supabase.from("reminders").select("*").eq("household_id", activeHouseholdId!).eq("dismissed", false).then((r) => r.data ?? []),
        supabase.from("dismissed_dashboard_items").select("record_id, source_type, dismissed_date").eq("household_id", activeHouseholdId!).then((r) => r.data ?? []),
        supabase.from("app_settings").select("mortgage_days, insurance_days, fd_days, warranty_days").eq("household_id", activeHouseholdId!).maybeSingle().then((r) => r.data),
      ]);
      return { reminders, dismissed, settings };
    },
  });

  const dataByKey: Record<string, any[]> = {
    properties: propertiesQ.data ?? [],
    loans: loansQ.data ?? [],
    insurance: insuranceQ.data ?? [],
    investments: investmentsQ.data ?? [],
    savings: savingsQ.data ?? [],
    health: healthQ.data ?? [],
    other_assets: otherAssetsQ.data ?? [],
    inventory_items: inventoryQ.data ?? [],
  };

  const allStatus = tablesLoaded
    ? SOURCES.flatMap((s) =>
        dataByKey[s.key]
          .filter((row: any) => row.status === "urgent" || row.status === "review")
          .map((row: any) => ({ row, src: s })),
      )
    : [];

  const dismissedKeys = new Set(
    (extras?.dismissed ?? []).map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`),
  );

  const dueSoon: UpcomingItem[] =
    tablesLoaded && extras
      ? buildUpcomingItems(
          {
            properties: dataByKey.properties,
            loans: dataByKey.loans,
            insurance: dataByKey.insurance,
            investments: dataByKey.investments,
            savings: dataByKey.savings,
            inventoryItems: dataByKey.inventory_items,
            reminders: extras.reminders,
            otherAssets: dataByKey.other_assets,
            healthConditions: dataByKey.health,
          },
          today,
          BELL_HORIZON_DAYS,
          {
            mortgage_days: extras.settings?.mortgage_days,
            insurance_days: extras.settings?.insurance_days,
            fd_days: extras.settings?.fd_days,
            warranty_days: extras.settings?.warranty_days,
          },
        ).filter((item) => !dismissedKeys.has(`${item.sourceType}::${item.recordId}::${item.date}`))
      : [];

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
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing to action right now</p>
          )}
          {dueSoon.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Due Soon <span className="text-foreground">({dueSoon.length})</span>
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
                        onClick={() => { onOpenChange(false); setMemberFilter(item.member_id ?? "all"); }}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50"
                      >
                        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase text-muted-foreground">{item.kind}</span>
                            <span className="min-w-0 line-clamp-2 break-words text-sm font-semibold">{item.label}</span>
                            {item.isGiro && <span className="text-sm font-bold">[GIRO]</span>}
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
          <Group title="Urgent" tone="urgent" items={urgent} empty="No urgent items." onNav={() => onOpenChange(false)} />
          <Group title="Review Needed" tone="review" items={review} empty="Nothing to review." onNav={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Same tint/border classes RecordCard.tsx uses for urgent/review status cards —
// keeps the bell's Urgent/Review Needed lists visually matched to the cards
// the person sees when they tap through.
const GROUP_TONE_CLS: Record<"urgent" | "review", string> = {
  urgent: "bg-urgent-tint border-urgent-border",
  review: "bg-review-tint border-review-border",
};
const GROUP_TITLE_CLS: Record<"urgent" | "review", string> = {
  urgent: "text-urgent",
  review: "text-review-foreground",
};

function Group({
  title,
  tone,
  items,
  empty,
  onNav,
}: {
  title: string;
  tone: "urgent" | "review";
  items: any[];
  empty: string;
  onNav: () => void;
}) {
  const setMemberFilter = useAppStore((s) => s.setMemberFilter);
  return (
    <section>
      <h3 className={`mb-2 text-xs font-bold uppercase tracking-wider ${GROUP_TITLE_CLS[tone]}`}>
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
                  onClick={() => { onNav(); setMemberFilter(row.member_id ?? "all"); }}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 hover:brightness-95 ${GROUP_TONE_CLS[tone]}`}
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
