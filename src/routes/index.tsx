import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToday } from "@/lib/today";
import { fmtMoney, fmtDate, fmtMonth } from "@/lib/format";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { MemberTag } from "@/components/MemberTag";
import { StatusBadge } from "@/components/StatusToggle";
import { useAppStore } from "@/lib/store";
import { addDays, isBefore, parseISO } from "date-fns";
import { LifetimeChart } from "@/components/LifetimeChart";
import { ChevronRight, Building2, Shield, Landmark, TrendingUp, ChevronDown } from "lucide-react";
import { useState } from "react";
import { sortByStatus } from "@/lib/sort";
import { fmtPct } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Home — FamilyVault" }] }),
});

function Dashboard() {
  const { today } = useToday();
  const memberFilter = useAppStore((s) => s.memberFilter);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["dashboard", memberFilter],
    queryFn: async () => {
      const filter = (q: any) =>
        memberFilter === "all" ? q : q.eq("member_id", memberFilter);

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

  const horizon90 = addDays(today, 90);

  type Upcoming = {
    date: string;
    label: string;
    amount?: number | null;
    member_id?: string | null;
    href: string;
    recordId: string;
    daysLeft: number;
  };

  function daysUntil(dateStr: string) {
    const d = parseISO(dateStr);
    return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  const upcoming: Upcoming[] = [];

  for (const p of insurance as any[]) {
    if (p.next_due_date) {
      const d = parseISO(p.next_due_date);
      if (isBefore(d, horizon90)) {
        upcoming.push({ date: p.next_due_date, label: p.name, amount: p.premium, member_id: p.member_id, href: "/insurance", recordId: p.id, daysLeft: daysUntil(p.next_due_date) });
      }
    }
  }

  for (const p of properties as any[]) {
    if (p.fixed_rate_end) {
      const d = parseISO(p.fixed_rate_end);
      if (isBefore(d, horizon90)) {
        upcoming.push({ date: p.fixed_rate_end, label: `${p.name} — fixed rate ends`, amount: null, member_id: p.member_id, href: "/property", recordId: p.id, daysLeft: daysUntil(p.fixed_rate_end) });
      }
    }
  }

  for (const l of loans as any[]) {
    if (l.reprice_date) {
      const d = parseISO(l.reprice_date);
      if (isBefore(d, horizon90)) {
        upcoming.push({ date: l.reprice_date, label: `${l.bank} loan — reprice`, amount: null, member_id: l.member_id, href: "/loans", recordId: l.id, daysLeft: daysUntil(l.reprice_date) });
      }
    }
  }

  for (const s of savings as any[]) {
    if (s.maturity_date) {
      const d = parseISO(s.maturity_date);
      if (isBefore(d, horizon90)) {
        upcoming.push({ date: s.maturity_date, label: `${s.institution} FD matures`, amount: s.balance, member_id: s.member_id, href: "/savings", recordId: s.id, daysLeft: daysUntil(s.maturity_date) });
      }
    }
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const all: Array<{ kind: string; row: any; href: string; icon: any }> = [
    ...properties.map((r: any) => ({ kind: "Property", row: r, href: "/property", icon: Building2 })),
    ...loans.map((r: any) => ({ kind: "Loan", row: r, href: "/loans", icon: Landmark })),
    ...insurance.map((r: any) => ({ kind: "Insurance", row: r, href: "/insurance", icon: Shield })),
    ...investments.map((r: any) => ({ kind: "Invest", row: r, href: "/investments", icon: TrendingUp })),
  ];

  const urgent = all.filter((x) => x.row.status === "urgent");
  const review = all.filter((x) => x.row.status === "review");

  // Bell count: only overdue or due within 30 days
  const upcomingAlerts = upcoming.filter((u) => u.daysLeft <= 30);
  const alertCount = urgent.length + review.length + upcomingAlerts.length;

  const dueToday = upcoming.find((u) => u.date === today.toISOString().slice(0, 10));

  return (
    <div className="space-y-5">
      <MemberFilterBar />

      {dueToday && (
        <Link to="/insurance" hash={`record-${dueToday.recordId}`} className="block rounded-2xl bg-review p-4 text-review-foreground">
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
          <span className="text-xs text-muted-foreground">{upcoming.length} item{upcoming.length === 1 ? "" : "s"}</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing due soon ✓</p>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.slice(0, 8).map((u, i) => {
              const isUrgent = u.daysLeft <= 7;
              return (
                <li key={i}>
                  <Link to={u.href as any} hash={`record-${u.recordId}`} className="flex items-center gap-3 py-2.5 text-sm hover:bg-accent/40 -mx-2 px-2 rounded">
                    <span className={`w-20 shrink-0 text-xs font-bold ${u.daysLeft < 0 ? "text-urgent" : isUrgent ? "text-urgent" : "text-primary"}`}>
                      {u.daysLeft < 0 ? `${Math.abs(u.daysLeft)}d overdue` : isUrgent ? `${u.daysLeft}d left` : fmtDate(u.date)}
                    </span>
                    <span className="flex-1 truncate">{u.label}</span>
                    <MemberTag memberId={u.member_id} />
                    {u.amount != null && <span className="font-semibold">{fmtMoney(u.amount)}</span>}
                    <ChevronRight className="h-4 w-4 text-primary" />
                  </Link>
                </li>
              );
            })}
          </ul>
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
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Inflows</span><span className="font-semibold">{fmtMoney(inflow)}</span></div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted"><div className="h-full bg-settled" style={{ width: `${(inflow / max) * 100}%` }} /></div>
      </div>
      <div>
        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Outflows</span><span className="font-semibold">{fmtMoney(outflow)}</span></div>
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
