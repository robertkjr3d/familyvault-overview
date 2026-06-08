import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToday } from "@/lib/today";
import { fmtMoney, fmtDate, fmtMonth } from "@/lib/format";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { MemberTag } from "@/components/MemberTag";
import { StatusBadge } from "@/components/StatusToggle";
import { useAppStore } from "@/lib/store";
import { addDays, isBefore, parseISO } from "date-fns";
import { LifetimeChart } from "@/components/LifetimeChart";
import { ChevronRight, Building2, Shield, Landmark, TrendingUp, ChevronDown, Check, Bell, PiggyBank } from "lucide-react";
import { useState } from "react";
import { fmtPct } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Home — FamilyVault" }] }),
});

function Dashboard() {
  const { today } = useToday();
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["dashboard", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) {
        return { properties: [], loans: [], insurance: [], investments: [], savings: [] };
      }
      const filter = (q: any) => {
        let scoped = q.eq("household_id", activeHouseholdId);
        if (memberFilter !== "all") scoped = scoped.eq("member_id", memberFilter);
        return scoped;
      };
      const [props, loans, insurance, invs, savings] = await Promise.all([
        filter(supabase.from("properties").select("*")),
        filter(supabase.from("loans").select("*")),
        filter(supabase.from("insurance_policies").select("*")),
        filter(supabase.from("investments").select("*")),
        filter(supabase.from("savings_accounts").select("*")),
      ]);
      return {
        properties: props.data ?? [],
        loans: loans.data ?? [],
        insurance: insurance.data ?? [],
        investments: invs.data ?? [],
        savings: savings.data ?? [],
      };
    },
  });

  const { data: remindersData } = useQuery({
    queryKey: ["reminders-dashboard", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const horizonStr = addDays(new Date(), 90).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("reminders")
        .select("*")
        .eq("household_id", activeHouseholdId)
        .eq("dismissed", false)
        .lte("remind_at", horizonStr);
      return data ?? [];
    },
  });

  const { data: dismissedData } = useQuery({
    queryKey: ["dismissed-dashboard", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data } = await supabase
        .from("dismissed_dashboard_items")
        .select("id, record_id, source_type, dismissed_date")
        .eq("household_id", activeHouseholdId);
      return data ?? [];
    },
  });

  const dismissedKeys = new Set(
    (dismissedData ?? []).map((d: any) => `${d.source_type}::${d.record_id}::${d.dismissed_date}`)
  );

  const properties = data?.properties ?? [];
  const loans = data?.loans ?? [];
  const insurance = data?.insurance ?? [];
  const investments = data?.investments ?? [];
  const savings = data?.savings ?? [];

  const propertyValue = properties.reduce((s: number, p: any) => s + (Number(p.current_value) || 0), 0);
  const investmentsValue = investments.reduce((s: number, i: any) => s + (Number(i.current_value) || 0), 0);
  const savingsValue = savings.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
  const totalAssets = propertyValue + investmentsValue + savingsValue;
  const totalLiabilities = loans.reduce((s: number, l: any) => s + (Number(l.balance) || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const monthlyIn = properties.reduce((s: number, p: any) => s + (Number(p.monthly_rent) || 0), 0);
  const monthlyOut =
    properties.reduce((s: number, p: any) => s + (Number(p.monthly_costs) || 0) + (Number(p.monthly_payment) || 0), 0) +
    loans.reduce((s: number, l: any) => s + (Number(l.monthly_payment) || 0), 0);
  const netCashFlow = monthlyIn - monthlyOut;

  function reminderHref(entityType: string | null | undefined): string {
    switch (entityType) {
      case "loan":       return "/loans";
      case "property":   return "/property";
      case "insurance":  return "/insurance";
      case "savings":    return "/savings";
      case "investment": return "/investments";
      case "health":     return "/health";
      case "inventory":  return "/inventory";
      default:           return "/";
    }
  }

  const horizon90 = addDays(today, 90);

  type Upcoming = {
    date: string;
    label: string;
    amount?: number | null;
    member_id?: string | null;
    href: string;
    recordId: string;
    sourceType: string;
    daysLeft: number;
    icon: any;
  };

  function daysUntil(dateStr: string) {
    const d = parseISO(dateStr);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const allUpcoming: Upcoming[] = [];

  for (const p of insurance as any[]) {
    if (p.next_due_date) {
      const d = parseISO(p.next_due_date);
      if (isBefore(d, horizon90)) {
        allUpcoming.push({ date: p.next_due_date, label: p.name, amount: p.premium, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_next_due", daysLeft: daysUntil(p.next_due_date), icon: Shield });
      }
    }
    if (p.end_date) {
      const d = parseISO(p.end_date);
      if (isBefore(d, horizon90)) {
        allUpcoming.push({ date: p.end_date, label: `${p.name} — policy ends`, amount: null, member_id: p.member_id, href: "/insurance", recordId: p.id, sourceType: "insurance_end", daysLeft: daysUntil(p.end_date), icon: Shield });
      }
    }
  }

  for (const p of properties as any[]) {
    if (p.fixed_rate_end) {
      const d = parseISO(p.fixed_rate_end);
      if (isBefore(d, horizon90)) {
        allUpcoming.push({ date: p.fixed_rate_end, label: `${p.name} — fixed rate ends`, amount: null, member_id: p.member_id, href: "/property", recordId: p.id, sourceType: "property_fixed_rate", daysLeft: daysUntil(p.fixed_rate_end), icon: Building2 });
      }
    }
  }

  for (const l of loans as any[]) {
    if (l.reprice_date) {
      const d = parseISO(l.reprice_date);
      if (isBefore(d, horizon90)) {
        allUpcoming.push({ date: l.reprice_date, label: `${l.bank} loan — reprice`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, sourceType: "loan_reprice", daysLeft: daysUntil(l.reprice_date), icon: Landmark });
      }
    }
  }

  for (const s of savings as any[]) {
    if (s.maturity_date) {
      const d = parseISO(s.maturity_date);
      if (isBefore(d, horizon90)) {
        allUpcoming.push({ date: s.maturity_date, label: `${s.institution} FD matures`, amount: s.balance, member_id: s.member_id, href: "/savings", recordId: s.id, sourceType: "savings_maturity", daysLeft: daysUntil(s.maturity_date), icon: PiggyBank });
      }
    }
  }

  for (const r of remindersData ?? []) {
    const dateStr = r.remind_at.slice(0, 10);
    const d = parseISO(dateStr);
    if (isBefore(d, horizon90)) {
      const href = reminderHref(r.entity_type);
      const recordId = r.entity_id ?? r.id;
      allUpcoming.push({
        date: dateStr,
        label: r.what ?? "Reminder",
        amount: null,
        member_id: null,
        href,
        recordId,
        sourceType: "reminder",
        daysLeft: daysUntil(dateStr),
        icon: Bell,
      });
    }
  }

  allUpcoming.sort((a, b) => a.date.localeCompare(b.date));

  const upcoming = allUpcoming.filter(
    (u) => !dismissedKeys.has(`${u.sourceType}::${u.recordId}::${u.date}`)
  );

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dismissed-dashboard", activeHouseholdId] }),
      queryClient.invalidateQueries({ queryKey: ["reminders-dashboard", memberFilter, activeHouseholdId] }),
      queryClient.invalidateQueries({ queryKey: ["alert-count", activeHouseholdId] }),
    ]);
  }

  async function dismissItem(u: Upcoming) {
    if (!activeHouseholdId) return;
    const key = `${u.sourceType}::${u.recordId}`;
    if (dismissing === key) return;
    setDismissing(key);

    const { data: inserted, error } = await supabase
      .from("dismissed_dashboard_items")
      .insert({
        household_id: activeHouseholdId,
        source_type: u.sourceType,
        record_id: u.recordId,
        label: u.label,
        dismissed_date: u.date,
      })
      .select("id")
      .single();

    setDismissing(null);

    if (error || !inserted) {
      toast.error("Could not mark as done.");
      return;
    }

    const insertedId = inserted.id;
    await invalidateAll();

    toast.success("Marked as done.", {
  duration: 5000,
  action: {
    label: "Undo",
    onClick: async () => {
          await supabase
            .from("dismissed_dashboard_items")
            .delete()
            .eq("id", insertedId);
          await invalidateAll();
        },
      },
    });
  }

  const all: Array<{ kind: string; row: any; href: string; icon: any }> = [
    ...properties.map((r: any) => ({ kind: "Property", row: r, href: "/property", icon: Building2 })),
    ...loans.map((r: any) => ({ kind: "Loan", row: r, href: "/loans", icon: Landmark })),
    ...insurance.map((r: any) => ({ kind: "Insurance", row: r, href: "/insurance", icon: Shield })),
    ...investments.map((r: any) => ({ kind: "Invest", row: r, href: "/investments", icon: TrendingUp })),
  ];

  const urgent = all.filter((x) => x.row.status === "urgent");
  const review = all.filter((x) => x.row.status === "review");

  const upcomingAlerts = upcoming.filter((u) => u.daysLeft <= 30);
  const alertCount = urgent.length + review.length + upcomingAlerts.length;

  const dueToday = upcoming.find((u) => u.date === today.toISOString().slice(0, 10));

  return (
    <div className="space-y-5">
      <MemberFilterBar />

      {dueToday && (
        <Link to={dueToday.href as any} hash={`record-${dueToday.recordId}`} className="block rounded-2xl bg-review p-4 text-review-foreground">
          <div className="text-xs font-semibold uppercase">Due today</div>
          <div className="mt-1 text-base font-bold">{dueToday.label} {dueToday.amount ? `· ${fmtMoney(dueToday.amount)}` : ""}</div>
        </Link>
      )}

      {/* KPI ROW */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total Assets" value={fmtMoney(totalAssets)} />
        <Kpi label="Total Liabilities" value={fmtMoney(totalLiabilities)} />
        <Kpi label="Net Worth" value={fmtMoney(netWorth)} accent="gold" big />
        <Kpi
          label="Active Alerts"
          value={String(alertCount)}
          accent={alertCount > 0 ? "bad" : "neutral"}
          sub={`${urgent.length} urgent · ${review.length} to review`}
        />
      </div>

      {/* MONTHLY CASH FLOW LINE */}
      <div className="text-center text-sm font-semibold">
        <span className="text-muted-foreground">Monthly Cash Flow: </span>
        <span className={netCashFlow >= 0 ? "text-settled" : "text-urgent"}>
          {netCashFlow >= 0 ? "+" : ""}{fmtMoney(netCashFlow)}
        </span>
      </div>

      {/* NET WORTH BREAKDOWN */}
      <section className="rounded-2xl border border-border bg-card">
        <button
          onClick={() => setBreakdownOpen((v) => !v)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <h2 className="text-sm font-bold">Net Worth Breakdown</h2>
          <ChevronDown className={`h-4 w-4 transition ${breakdownOpen ? "rotate-180" : ""}`} />
        </button>
        {breakdownOpen && (
          <div className="space-y-1 border-t border-border/40 px-4 pb-4 pt-3 text-sm">
            <BreakdownRow label="Properties" value={fmtMoney(propertyValue)} />
            <BreakdownRow label="Investments" value={fmtMoney(investmentsValue)} />
            <BreakdownRow label="Savings & CPF" value={fmtMoney(savingsValue)} />
            <div className="my-2 border-t border-dashed border-border" />
            <BreakdownRow label="Total Assets" value={fmtMoney(totalAssets)} bold />
            <div className="my-2 border-t border-border" />
            <BreakdownRow label="Loans" value={`−${fmtMoney(totalLiabilities)}`} className="text-urgent" />
            <BreakdownRow label="Total Liabilities" value={`−${fmtMoney(totalLiabilities)}`} className="text-urgent" bold />
            <div className="my-2 border-t-2 border-double border-foreground/40" />
            <div className="flex items-center justify-between pt-1">
              <span className="text-base font-bold">NET WORTH</span>
              <span className="text-2xl font-bold text-primary">{fmtMoney(netWorth)}</span>
            </div>
          </div>
        )}
      </section>

      {/* NEEDS ATTENTION */}
      {urgent.length > 0 && <PrioritySection title="Needs Attention" items={urgent} />}

      {/* DUE IN NEXT 90 DAYS */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight">Due in the Next 90 Days</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{upcoming.length} item{upcoming.length === 1 ? "" : "s"}</span>
            {upcoming.length > 0 && (
              <button
                onClick={() => setEditMode((v) => !v)}
                className="text-xs font-semibold text-primary"
              >
                {editMode ? "Done" : "Edit"}
              </button>
            )}
          </div>
        </div>
        {editMode && (
          <p className="mb-2 text-xs text-muted-foreground">Tap ✓ to mark an item as done and remove it from this list.</p>
        )}
        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing due soon ✓</p>
        ) : (
          <>
          <ul className="divide-y divide-border">
            {(showAllUpcoming ? upcoming : upcoming.slice(0, 8)).map((u, i) => {
              const isUrgent = u.daysLeft <= 7;
              const itemKey = `${u.sourceType}::${u.recordId}`;
              const isDismissing = dismissing === itemKey;
              const dateClass = u.daysLeft < 0 ? "text-urgent" : isUrgent ? "text-urgent" : "text-primary";
              const dateLabel = u.daysLeft < 0 ? `${Math.abs(u.daysLeft)}d overdue` : isUrgent ? `${u.daysLeft}d left` : fmtDate(u.date);
              return (
               <li key={i} className="flex min-w-0 items-center gap-3 py-2.5 text-sm -mx-2 px-2 overflow-hidden">
                  {editMode ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className={`w-20 shrink-0 text-xs font-bold ${dateClass}`}>{dateLabel}</span>
                      <u.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{u.label}</span>
                      <MemberTag memberId={u.member_id} />
                      {u.amount != null && <span className="shrink-0 font-semibold">{fmtMoney(u.amount)}</span>}
                      <button
                        onClick={() => dismissItem(u)}
                        className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${isDismissing ? "border-muted text-muted-foreground" : "border-settled text-settled"}`}
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Link to={u.href as any} hash={`record-${u.recordId}`} className="flex min-w-0 flex-1 items-center gap-3 hover:bg-accent/40 rounded overflow-hidden">
                      <span className={`w-20 shrink-0 text-xs font-bold ${dateClass}`}>{dateLabel}</span>
                      <u.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{u.label}</span>
                      <MemberTag memberId={u.member_id} />
                      {u.amount != null && <span className="shrink-0 font-semibold">{fmtMoney(u.amount)}</span>}
                      <ChevronRight className="h-4 w-4 shrink-0 text-primary" />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {upcoming.length > 8 && (
            <button
              onClick={() => setShowAllUpcoming((v) => !v)}
              className="mt-2 flex w-full items-center justify-center gap-1 py-2 text-xs font-semibold text-primary"
            >
              {showAllUpcoming ? "Show less ↑" : `Show ${upcoming.length - 8} more ↓`}
            </button>
          )}
          </>
        )}
      </section>

      {/* REVIEW NEEDED */}
      {review.length > 0 && <PrioritySection title="Review Needed" items={review} muted showDate />}

      {/* MONTHLY CASH FLOW BARS */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold">Monthly Cash Flow</h2>
        <CashFlowBars inflow={monthlyIn} outflow={monthlyOut} />
        <div className="mt-3 text-center">
          <div className="text-xs text-muted-foreground">Net</div>
          <div className={`text-2xl font-bold ${netCashFlow >= 0 ? "text-settled" : "text-urgent"}`}>
            {fmtMoney(netCashFlow)}
          </div>
        </div>
      </section>

      {/* LIFETIME CHART */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-bold">Lifetime Cash Flow</h2>
        <p className="mb-3 text-xs text-muted-foreground">Projected next 40 years across all records.</p>
        <LifetimeChart properties={properties} loans={loans} insurance={insurance} />
      </section>
    </div>
  );
}

function Kpi({ label, value, accent, big, sub }: { label: string; value: string; accent?: "good" | "bad" | "neutral" | "gold"; big?: boolean; sub?: string }) {
  const valueColor = accent === "good" ? "text-settled" : accent === "bad" ? "text-urgent" : accent === "gold" ? "text-primary" : "";
  const borderTop = accent === "bad" ? "bg-urgent-soft/30 border-urgent/30" : accent === "gold" ? "border-primary/40" : "";
  return (
    <div className={`rounded-2xl border border-border bg-card p-3 ${borderTop}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 ${big ? "text-2xl" : "text-xl"} font-bold ${valueColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function BreakdownRow({ label, value, bold, className }: { label: string; value: string; bold?: boolean; className?: string }) {
  return (
    <div className={`flex items-center justify-between py-0.5 ${bold ? "font-bold" : ""} ${className ?? ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CashFlowBars({ inflow, outflow }: { inflow: number; outflow: number }) {
  const max = Math.max(inflow, outflow, 1);
  return (
    <div className="space-y-2">
     <div>
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Income</span><span className="font-semibold">{fmtMoney(inflow)}</span></div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-settled" style={{ width: `${(inflow / max) * 100}%` }} /></div>
      </div>
      <div>
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Expenses</span><span className="font-semibold">{fmtMoney(outflow)}</span></div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-urgent" style={{ width: `${(outflow / max) * 100}%` }} /></div>
      </div>
    </div>
  );
}

function reviewDateInfo(kind: string, row: any): { prefix: string; date: string } | null {
  if (kind === "Property" && row.fixed_rate_end) return { prefix: "Reprice by", date: fmtMonth(row.fixed_rate_end) };
  if (kind === "Loan" && row.reprice_date) return { prefix: "Reprice by", date: fmtMonth(row.reprice_date) };
  if (kind === "Insurance" && row.next_due_date) return { prefix: "Renew by", date: fmtMonth(row.next_due_date) };
  return null;
}

function PrioritySection({ title, items, muted, showDate }: { title: string; items: any[]; muted?: boolean; showDate?: boolean }) {
  return (
    <section className={`rounded-2xl border p-4 ${muted ? "border-review/40 bg-review-soft/40" : "border-urgent/40 bg-urgent-soft/30"}`}>
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      <ul className="space-y-2">
        {items.slice(0, 8).map(({ kind, row, href, icon: Icon }, i) => {
          const dateInfo = showDate ? reviewDateInfo(kind, row) : null;
          return (
            <li key={i}>
              <Link to={href as any} hash={`record-${row.id}`} className="flex items-start gap-3 rounded-xl bg-card/80 p-3 hover:bg-card">
                <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase text-muted-foreground">{kind}</span>
                    <span className="text-sm font-semibold truncate">{row.name || row.bank}</span>
                    <MemberTag memberId={row.member_id} />
                  </div>
                  {dateInfo && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {dateInfo.prefix} <span className="font-bold text-primary">{dateInfo.date}</span>
                    </p>
                  )}
                  {row.action && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.action}</p>}
                </div>
                <StatusBadge status={row.status} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
