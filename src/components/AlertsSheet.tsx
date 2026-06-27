import { useState } from “react”;
import { useQuery } from “@tanstack/react-query”;
import { Link } from “@tanstack/react-router”;
import { supabase } from “@/integrations/supabase/client”;
import { Sheet, SheetContent, SheetHeader, SheetTitle } from “@/components/ui/sheet”;
import { Building2, Shield, Landmark, TrendingUp, Heart, ChevronRight, Gem } from “lucide-react”;
import { MemberTag } from “./MemberTag”;
import { fmtDate, fmtMoney } from “@/lib/format”;
import { useAppStore } from “@/lib/store”;
import { buildUpcomingItems } from “@/lib/alerts”;
import type { UpcomingItem } from “@/lib/alerts”;

const SOURCES = [
{ table: “properties”,         href: “/property”,    kind: “Property”,  icon: Building2,  title: (r: any) => r.name },
{ table: “loans”,              href: “/loans”,       kind: “Loan”,      icon: Landmark,   title: (r: any) => `${r.bank} · ${r.purpose ?? ""}` },
{ table: “insurance_policies”, href: “/insurance”,   kind: “Insurance”, icon: Shield,     title: (r: any) => r.name },
{ table: “investments”,        href: “/investments”, kind: “Invest”,    icon: TrendingUp, title: (r: any) => r.name },
{ table: “health_conditions”,  href: “/health”,      kind: “Health”,    icon: Heart,      title: (r: any) => r.name },
{ table: “other_assets”,       href: “/other-assets”, kind: “Asset”,   icon: Gem,        title: (r: any) => r.name },
] as const;

// Same logic source as the dashboard (90-day) — both now pull from buildUpcomingItems
// in src/lib/alerts.ts. This is the only place the bell’s horizon is set.
const BELL_HORIZON_DAYS = 30;

async function fetchDueSoonItems(today: Date, householdId: string): Promise<UpcomingItem[]> {
const [properties, loans, insurance, investments, savings, inventoryItems, reminders, dismissed, settings] = await Promise.all([
supabase.from(“properties”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“loans”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“insurance_policies”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“investments”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“savings_accounts”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“inventory_items”).select(”*”).eq(“household_id”, householdId).then((r) => r.data ?? []),
supabase.from(“reminders”).select(”*”).eq(“household_id”, householdId).eq(“dismissed”, false).then((r) => r.data ?? []),
supabase.from(“dismissed_dashboard_items”).select(“record_id, source_type, dismissed_date”).eq(“household_id”, householdId).eq(“permanently_deleted” as any, false).then((r) => r.data ?? []),
supabase.from(“app_settings”).select(“mortgage_days, insurance_days, fd_days, warranty_days”).eq(“household_id”, householdId).maybeSingle().then((r) => r.data),
]);

const dismissedKeys = new Set(
dismissed.map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`)
);

const allItems = buildUpcomingItems(
{ properties, loans, insurance, investments, savings, inventoryItems, reminders },
today,
BELL_HORIZON_DAYS,
{
mortgage_days: settings?.mortgage_days,
insurance_days: settings?.insurance_days,
fd_days: settings?.fd_days,
warranty_days: settings?.warranty_days,
}
);

return allItems.filter((item) => !dismissedKeys.has(`${item.sourceType}::${item.recordId}::${item.date}`));
}

export function AlertsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
const today = new Date();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);

const { data } = useQuery({
queryKey: [“alerts-all”, activeHouseholdId],
enabled: open && !!activeHouseholdId,
queryFn: async () => {
const [statusResults, dueSoon] = await Promise.all([
Promise.all(
SOURCES.map(async (s) => {
const { data } = await supabase
.from(s.table as any)
.select(”*”)
.eq(“household_id”, activeHouseholdId!)
.in(“status”, [“urgent”, “review”]);
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
const urgent = allStatus.filter((x) => x.row.status === “urgent”);
const review = allStatus.filter((x) => x.row.status === “review”);

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
className=“flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50”
>
<Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
<div className="min-w-0 flex-1">
<div className="flex flex-wrap items-center gap-2">
<span className="text-[10px] font-semibold uppercase text-muted-foreground">{item.kind}</span>
<span className="min-w-0 line-clamp-2 break-words text-sm font-semibold">{item.label}</span>
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
<Group title=“🔴 Urgent” items={urgent} empty=“No urgent items.” onNav={() => onOpenChange(false)} />
<Group title=“🟡 Review Needed” items={review} empty=“Nothing to review.” onNav={() => onOpenChange(false)} />
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
className=“flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent/50”
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
