import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToday } from "@/lib/today";
import { fmtMoney, fmtDate, fmtMonth } from "@/lib/format";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { MemberTag } from "@/components/MemberTag";
import { StatusBadge } from "@/components/StatusToggle";
import { useAppStore } from "@/lib/store";
import { addDays } from "date-fns";
import { buildUpcomingItems, computeNextOccurrence } from "@/lib/alerts";
import type { UpcomingItem } from "@/lib/alerts";
import { LifetimeChart } from "@/components/LifetimeChart";
import type { LineItem } from "@/components/LifetimeChart";
import { ChevronRight, Building2, Shield, Landmark, TrendingUp, ChevronDown, Check } from "lucide-react";
import { useState, useRef } from "react";
import { fmtPct } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { useMembers } from "@/hooks/useMembers";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Home — FamilyVault" }] }),
});

function Dashboard() {
  const { today } = useToday();
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const { data: members = [] } = useMembers();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [cashFlowDetailOpen, setCashFlowDetailOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const queryClient = useQueryClient();
  const cashFlowRef = useRef<any>(null);
  const needsAttentionRef = useRef<any>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  function scrollTo(ref: any, key: string) {
    if (!ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(key);
    setTimeout(() => setHighlight((h) => (h === key ? null : h)), 1800);
  }

  const { data } = useQuery({
    queryKey: ["dashboard", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) {
        return { properties: [], loans: [], insurance: [], investments: [], savings: [], otherAssets: [] };
      }
      const filter = (q: any) => {
        let scoped = q.eq("household_id", activeHouseholdId);
        if (memberFilter !== "all") scoped = scoped.eq("member_id", memberFilter);
        return scoped;
      };
      // inventory_items has no member_id column — don't apply memberFilter,
      // or it silently returns [] whenever any specific member is selected.
      // Route through 'any' since the generated types predate the household_id
      // column added via migration (same stale-types issue as every other table here).
      const filterHH = (q: any) => q.eq("household_id", activeHouseholdId);

      const [props, loans, insurance, invs, savings, inventoryItemsRes, otherAssets] = await Promise.all([
        filter(supabase.from("properties").select("*")),
        filter(supabase.from("loans").select("*")),
        filter(supabase.from("insurance_policies").select("*")),
        filter(supabase.from("investments").select("*")),
        filter(supabase.from("savings_accounts").select("*")),
        filterHH(supabase.from("inventory_items").select("*")),
        filter(supabase.from("other_assets").select("*")),
      ]);
      return {
        properties: props.data ?? [],
        loans: loans.data ?? [],
        insurance: insurance.data ?? [],
        investments: invs.data ?? [],
        savings: savings.data ?? [],
        inventoryItems: inventoryItemsRes.data ?? [],
        otherAssets: otherAssets.data ?? [],
      };
    },
  });

  const { data: appSettings } = useQuery({
    queryKey: ["app_settings", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return null;
      const { data } = await supabase
        .from("app_settings")
        .select("monthly_income, monthly_expenses, currency")
        .eq("household_id", activeHouseholdId)
        .maybeSingle();
      return data;
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
  const inventoryItems = data?.inventoryItems ?? [];
  const otherAssets = data?.otherAssets ?? [];

  const propertyValue = properties.reduce((s: number, p: any) => s + (Number(p.current_value) || 0), 0);
  const investmentsValue = investments.reduce((s: number, i: any) => s + (Number(i.current_value) || 0), 0);
  const savingsValue = savings.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
  const otherAssetsValue = otherAssets.reduce((s: number, a: any) => s + (Number(a.estimated_value) || 0), 0);
  const totalAssets = propertyValue + investmentsValue + savingsValue + otherAssetsValue;
  const totalLiabilities = loans.reduce((s: number, l: any) => s + (Number(l.balance) || 0), 0);
  const netWorth = totalAssets - totalLiabilities;

  const salaryIncome = Number(appSettings?.monthly_income) || 0;
  const rentalIncome = properties.reduce((s: number, p: any) => s + (Number(p.monthly_rent) || 0), 0);
  const insurancePayoutIn = insurance.reduce((s: number, p: any) => s + insurancePayoutMonthly(p), 0);
  const investmentPayoutIn = investments.reduce((s: number, inv: any) => s + investmentPayoutMonthly(inv), 0);
  const monthlyIn = salaryIncome + rentalIncome + insurancePayoutIn + investmentPayoutIn;

  function insuranceMonthly(p: any): number {
    const premium = Number(p.premium) || 0;
    const freq = (p.frequency ?? "").toLowerCase();
    if (freq === "one-off" || freq === "single") return 0;
    if (freq === "monthly") return premium;
    if (freq === "quarterly") return premium / 3;
    if (freq === "half-yearly" || freq === "semi-annual") return premium / 6;
    if (freq === "annual" || freq === "yearly" || freq === "") return premium / 12;
    return premium / 12;
  }

  // ILP/Endowment premiums currently being paid — treated as a monthly outflow.
  function investmentPremiumMonthly(inv: any): number {
    if (inv.group_name !== "ILP (Investment-Linked Policy)" && inv.group_name !== "Endowment") return 0;
    const premium = Number(inv.premium_amount) || 0;
    if (!premium || !inv.premium_start_date) return 0;
    if (new Date(inv.premium_start_date).getTime() > today.getTime()) return 0;
    if (inv.premium_end_date && new Date(inv.premium_end_date).getTime() < today.getTime()) return 0;
    const freq = (inv.premium_frequency ?? "").toLowerCase();
    if (freq === "one-off" || freq === "single") return 0;
    if (freq === "monthly") return premium;
    if (freq === "quarterly") return premium / 3;
    if (freq === "half-yearly" || freq === "semi-annual") return premium / 6;
    if (freq === "annual" || freq === "yearly" || freq === "") return premium / 12;
    return premium / 12;
  }

  // Insurance payouts currently active — treated as a monthly inflow.
  // One-off payouts only count in the month they occur; recurring payouts count
  // for every month between payout_start_date and payout_end_date (or indefinitely if no end date).
  function insurancePayoutMonthly(p: any): number {
    const amount = Number(p.payout_amount) || 0;
    if (!amount || !p.payout_start_date) return 0;
    const startTime = new Date(p.payout_start_date).getTime();
    if (startTime > today.getTime()) return 0;
    const freq = (p.payout_frequency ?? "").toLowerCase();
    const isOneOff = freq === "one-off" || freq === "single" || freq === "";
    if (isOneOff) {
      // Only counts as "this month's" inflow during the actual payout month/year
      const payoutDate = new Date(p.payout_start_date);
      return payoutDate.getFullYear() === today.getFullYear() && payoutDate.getMonth() === today.getMonth() ? amount : 0;
    }
    if (p.payout_end_date && new Date(p.payout_end_date).getTime() < today.getTime()) return 0;
    if (freq === "monthly") return amount;
    if (freq === "quarterly") return amount / 3;
    if (freq === "half-yearly" || freq === "semi-annual") return amount / 6;
    if (freq === "annual" || freq === "yearly") return amount / 12;
    return amount / 12;
  }

  // ILP/Endowment payouts currently active — treated as a monthly inflow. Same logic as insurance payouts.
  function investmentPayoutMonthly(inv: any): number {
    const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
    if (!isILP) return 0;
    const amount = Number(inv.payout_amount) || 0;
    if (!amount || !inv.payout_start_date) return 0;
    const startTime = new Date(inv.payout_start_date).getTime();
    if (startTime > today.getTime()) return 0;
    const freq = (inv.payout_frequency ?? "").toLowerCase();
    const isOneOff = freq === "one-off" || freq === "single" || freq === "";
    if (isOneOff) {
      const payoutDate = new Date(inv.payout_start_date);
      return payoutDate.getFullYear() === today.getFullYear() && payoutDate.getMonth() === today.getMonth() ? amount : 0;
    }
    if (inv.payout_end_date && new Date(inv.payout_end_date).getTime() < today.getTime()) return 0;
    if (freq === "monthly") return amount;
    if (freq === "quarterly") return amount / 3;
    if (freq === "half-yearly" || freq === "semi-annual") return amount / 6;
    if (freq === "annual" || freq === "yearly") return amount / 12;
    return amount / 12;
  }

  // Properties with a linked mortgage loan should not double-count monthly_payment
  const mortgagedPropertyIds = new Set(
    loans.filter((l: any) => l.property_id).map((l: any) => l.property_id)
  );
  function propertyTotalCosts(p: any): number {
    const itemised = ["cost_management", "cost_property_tax", "cost_fire_insurance", "cost_maintenance", "cost_other"]
      .reduce((s, k) => s + (Number(p[k]) || 0), 0);
    return itemised || (Number(p.monthly_costs) || 0);
  }
  const propertyOut = properties.reduce((s: number, p: any) => {
    const costs = propertyTotalCosts(p);
    const mortgage = mortgagedPropertyIds.has(p.id) ? 0 : (Number(p.monthly_payment) || 0);
    return s + costs + mortgage;
  }, 0);
  const loanOut = loans.reduce((s: number, l: any) => s + (Number(l.monthly_payment) || 0), 0);
  const insuranceOut = insurance.reduce((s: number, p: any) => s + insuranceMonthly(p), 0);
  const investmentPremiumOut = investments.reduce((s: number, inv: any) => s + investmentPremiumMonthly(inv), 0);
  const baseExpenses = Number(appSettings?.monthly_expenses) || 0;
  const monthlyOut = propertyOut + loanOut + insuranceOut + investmentPremiumOut + baseExpenses;
  const netCashFlow = monthlyIn - monthlyOut;

  // Per-record cash flow detail — same "what's adding/subtracting and from where"
  // pattern as the Lifetime Chart's Year Detail panel, but for this month's actual figures.
  const inflowDetailItems: LineItem[] = [
    ...(salaryIncome > 0 ? [{ label: "Salary / income", amount: salaryIncome, href: "/settings" }] : []),
    ...properties
      .filter((p: any) => (Number(p.monthly_rent) || 0) > 0)
      .map((p: any) => ({ label: `${p.name ?? "Property"} rental`, amount: Number(p.monthly_rent) || 0, href: `/property#record-${p.id}` })),
    ...insurance
      .filter((p: any) => insurancePayoutMonthly(p) > 0)
      .map((p: any) => ({ label: `${p.name ?? "Insurance"} payout`, amount: insurancePayoutMonthly(p), href: `/insurance#record-${p.id}` })),
    ...investments
      .filter((inv: any) => investmentPayoutMonthly(inv) > 0)
      .map((inv: any) => ({ label: `${inv.name ?? "ILP"} payout`, amount: investmentPayoutMonthly(inv), href: `/investments#record-${inv.id}` })),
  ];

  const outflowDetailItems: LineItem[] = [
    ...properties.flatMap((p: any) => {
      const items: LineItem[] = [];
      const propHref = `/property#record-${p.id}`;
      const costs = propertyTotalCosts(p);
      if (costs > 0) items.push({ label: `${p.name ?? "Property"} costs`, amount: costs, href: propHref });
      const mortgage = mortgagedPropertyIds.has(p.id) ? 0 : Number(p.monthly_payment) || 0;
      if (mortgage > 0) items.push({ label: `${p.name ?? "Property"} mortgage`, amount: mortgage, href: propHref });
      return items;
    }),
    ...loans
      .filter((l: any) => (Number(l.monthly_payment) || 0) > 0)
      .map((l: any) => ({ label: `${l.bank ?? "Loan"} repayment`, amount: Number(l.monthly_payment) || 0, href: `/loans#record-${l.id}` })),
    ...insurance
      .filter((p: any) => insuranceMonthly(p) > 0)
      .map((p: any) => ({ label: `${p.name ?? "Insurance"} premium`, amount: insuranceMonthly(p), href: `/insurance#record-${p.id}` })),
    ...investments
      .filter((inv: any) => investmentPremiumMonthly(inv) > 0)
      .map((inv: any) => ({ label: `${inv.name ?? "ILP"} premium`, amount: investmentPremiumMonthly(inv), href: `/investments#record-${inv.id}` })),
    ...(baseExpenses > 0 ? [{ label: "Other expenses (Settings)", amount: baseExpenses, href: "/settings" }] : []),
  ];

  const showSettingsNudge = salaryIncome === 0 && baseExpenses === 0;

  const horizon90 = 90;

  const allUpcoming = buildUpcomingItems(
    { properties, loans, insurance, investments, savings, inventoryItems, reminders: remindersData ?? [] },
    today,
    horizon90
  );

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

  async function dismissItem(u: UpcomingItem) {
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

  // Asset allocation
  const sgdProperties = properties.filter((p: any) => !p.currency || p.currency === "SGD");
  const allocProperty = sgdProperties.reduce((s: number, p: any) => s + (Number(p.current_value) || 0), 0);
  const allocInvestments = investments.reduce((s: number, i: any) => s + (Number(i.current_value) || 0), 0);
  const allocCash = savings.reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
  const allocTotal = allocProperty + allocInvestments + allocCash;
  const allocPctProperty = allocTotal > 0 ? (allocProperty / allocTotal) * 100 : 0;
  const allocPctInvestments = allocTotal > 0 ? (allocInvestments / allocTotal) * 100 : 0;
  const allocPctCash = allocTotal > 0 ? (allocCash / allocTotal) * 100 : 0;

  // Insurance adequacy
  const activeInsurance = insurance.filter((p: any) => p.status !== "inactive");
  const totalSumAssured = activeInsurance.reduce((s: number, p: any) => s + (Number(p.sum_assured) || 0), 0);
  const policiesWithNoSumAssured = activeInsurance.filter((p: any) => !p.sum_assured).length;
  const incomeReplacementNeed = salaryIncome * 120;
  const coverageRatio = incomeReplacementNeed > 0 ? totalSumAssured / incomeReplacementNeed : null;
  const adequacyStatus =
    incomeReplacementNeed === 0 ? "unset" :
    totalSumAssured === 0 ? "none" :
    coverageRatio !== null && coverageRatio >= 1 ? "covered" : "partial";

  // Financial health checks
  const healthChecks = [
    (() => {
      if (salaryIncome === 0 && baseExpenses === 0) return { label: "Cash flow", status: "incomplete", detail: "Set income and expenses in Settings", href: "/settings" };
      if (netCashFlow > 0) return { label: "Cash flow", status: "pass", detail: `+${fmtMoney(netCashFlow)} monthly surplus`, href: "cash-flow" };
      if (netCashFlow >= -(monthlyOut * 0.1)) return { label: "Cash flow", status: "warning", detail: "Near break-even — monitor closely", href: "cash-flow" };
      return { label: "Cash flow", status: "fail", detail: `${fmtMoney(netCashFlow)} monthly deficit`, href: "cash-flow" };
    })(),
    (() => {
      if (baseExpenses === 0) return { label: "Emergency fund", status: "incomplete", detail: "Set monthly expenses in Settings to calculate", href: "/settings" };
      if (savingsValue >= monthlyOut * 3) return { label: "Emergency fund", status: "pass", detail: `${(savingsValue / monthlyOut).toFixed(1)} months of expenses covered`, href: "/savings" };
      if (savingsValue >= monthlyOut) return { label: "Emergency fund", status: "warning", detail: `Only ${(savingsValue / monthlyOut).toFixed(1)} months covered — aim for 3+`, href: "/savings" };
      return { label: "Emergency fund", status: "fail", detail: "Less than 1 month of expenses in savings", href: "/savings" };
    })(),
    (() => {
      if (adequacyStatus === "unset") return { label: "Insurance coverage", status: "incomplete", detail: "Set monthly income in Settings to calculate", href: "/settings" };
      if (adequacyStatus === "none") return { label: "Insurance coverage", status: "incomplete", detail: "No sum assured entered on policies", href: "/insurance" };
      if (adequacyStatus === "covered") return { label: "Insurance coverage", status: "pass", detail: `${Math.round((coverageRatio ?? 0) * 100)}% of 10-year income need covered`, href: "/insurance" };
      return { label: "Insurance coverage", status: "warning", detail: `Only ${Math.round((coverageRatio ?? 0) * 100)}% of 10-year income need covered`, href: "/insurance" };
    })(),
    (() => {
      if (totalAssets === 0) return { label: "Debt ratio", status: "incomplete", detail: "No asset values recorded yet", href: "/property" };
      const ratio = totalLiabilities / totalAssets;
      const pct = Math.round(ratio * 100);
      if (ratio < 0.4) return { label: "Debt ratio", status: "pass", detail: `${pct}% of assets — healthy`, href: "/loans" };
      if (ratio < 0.6) return { label: "Debt ratio", status: "warning", detail: `${pct}% of assets — monitor debt levels`, href: "/loans" };
      return { label: "Debt ratio", status: "fail", detail: `${pct}% of assets — high debt load`, href: "/loans" };
    })(),
   (() => {
      if (urgent.length === 0) return { label: "Urgent alerts", status: "pass", detail: "No urgent items", href: "" };
      return { label: "Urgent alerts", status: "fail", detail: `${urgent.length} item${urgent.length === 1 ? "" : "s"} need attention`, href: "needs-attention" };
    })(),
  ] as { label: string; status: "pass" | "warning" | "fail" | "incomplete"; detail: string; href: string }[];

  const passCount = healthChecks.filter((c) => c.status === "pass").length;
  const totalScored = healthChecks.filter((c) => c.status !== "incomplete").length;

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
        <Kpi label="Net Worth" value={fmtMoney(netWorth)} accent="gold" big sub="SGD only · foreign currency excluded" />
        <Kpi
          label="Active Alerts"
          value={String(alertCount)}
          accent={alertCount > 0 ? "bad" : "neutral"}
          sub={`${urgent.length} urgent · ${review.length} to review`}
        />
      </div>

      {/* MONTHLY CASH FLOW LINE — tapping scrolls to the full breakdown below */}
      <button
        type="button"
        onClick={() => scrollTo(cashFlowRef, "cash-flow")}
        className="w-full text-center text-sm font-semibold transition-opacity hover:opacity-75"
      >
        <span className="text-muted-foreground">Monthly Cash Flow: </span>
        <span className={netCashFlow >= 0 ? "text-settled" : "text-urgent"}>
          {netCashFlow >= 0 ? "+" : ""}{fmtMoney(netCashFlow)}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground">↓</span>
      </button>

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
            <BreakdownRow label="Other Assets" value={fmtMoney(otherAssetsValue)} />
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
      <div ref={needsAttentionRef} className={`scroll-mt-28 rounded-2xl transition-all ${highlight === "needs-attention" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
        {urgent.length > 0 && <PrioritySection title="Needs Attention" items={urgent} />}
      </div>

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
     <section ref={cashFlowRef} className={`scroll-mt-28 rounded-2xl border border-border bg-card p-4 transition-all ${highlight === "cash-flow" ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">Monthly Cash Flow</h2>
          {(inflowDetailItems.length > 0 || outflowDetailItems.length > 0) && (
            <button
              onClick={() => setCashFlowDetailOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-semibold text-primary"
            >
              {cashFlowDetailOpen ? "Hide breakdown" : "Show breakdown"}
              <ChevronDown className={`h-3.5 w-3.5 transition ${cashFlowDetailOpen ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
        <CashFlowBars
          inflow={monthlyIn}
          outflow={monthlyOut}
          inflowBreakdown={[
            { label: "Salary / income", value: salaryIncome },
            { label: "Rental income", value: rentalIncome },
            { label: "Insurance payouts", value: insurancePayoutIn },
            { label: "ILP / Endowment payouts", value: investmentPayoutIn },
          ]}
          outflowBreakdown={[
            { label: "Property costs", value: propertyOut },
            { label: "Loan repayments", value: loanOut },
            { label: "Insurance premiums", value: insuranceOut },
            { label: "ILP / Endowment premiums", value: investmentPremiumOut },
            { label: "Other expenses", value: baseExpenses },
          ]}
        />
        {cashFlowDetailOpen && (
          <div className="mt-3 space-y-3 border-t border-border/40 pt-3 text-xs">
            {inflowDetailItems.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Money in — by record
                </div>
                {inflowDetailItems.map((it, i) => (
                  <CashFlowItemRow key={i} it={it} color="settled" />
                ))}
              </div>
            )}
            {outflowDetailItems.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Money out — by record
                </div>
                {outflowDetailItems.map((it, i) => (
                  <CashFlowItemRow key={i} it={it} color="urgent" />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-3 text-center">
          <div className="text-xs text-muted-foreground">Net</div>
          <div className={`text-2xl font-bold ${netCashFlow >= 0 ? "text-settled" : "text-urgent"}`}>
            {fmtMoney(netCashFlow)}
          </div>
          {showSettingsNudge && (
            <p className="mt-1 text-xs text-muted-foreground">
              Add income &amp; expenses in <a href="/settings" className="font-semibold text-primary underline">Settings</a> for a complete picture.
            </p>
          )}
        </div>
      </section>

      {/* ASSET ALLOCATION */}
      <AssetAllocationCard
        allocProperty={allocProperty}
        allocInvestments={allocInvestments}
        allocCash={allocCash}
        allocTotal={allocTotal}
        allocPctProperty={allocPctProperty}
        allocPctInvestments={allocPctInvestments}
        allocPctCash={allocPctCash}
      />

      {/* INSURANCE ADEQUACY */}
      <InsuranceAdequacyCard
        totalSumAssured={totalSumAssured}
        incomeReplacementNeed={incomeReplacementNeed}
        coverageRatio={coverageRatio}
        adequacyStatus={adequacyStatus}
        policiesWithNoSumAssured={policiesWithNoSumAssured}
        activePolicyCount={activeInsurance.length}
      />

      {/* FINANCIAL HEALTH */}
      <FinancialHealthCard
        checks={healthChecks}
        passCount={passCount}
        totalScored={totalScored}
        onScroll={(target) => {
          if (target === "cash-flow") scrollTo(cashFlowRef, "cash-flow");
          if (target === "needs-attention") scrollTo(needsAttentionRef, "needs-attention");
        }}
      />

      {/* LIFETIME CHART */}
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-bold">Lifetime Net Worth</h2>
        <p className="mb-3 text-xs text-muted-foreground">Projected trajectory based on your current records.</p>
        <LifetimeChart
          properties={properties}
          loans={loans}
          insurance={insurance}
          savings={savings}
          investments={investments}
          members={members}
          startingNetWorth={netWorth}
          monthlyIncome={salaryIncome}
          monthlyExpenses={baseExpenses}
          appSettings={appSettings}
        />
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

function CashFlowItemRow({ it, color }: { it: LineItem; color: "settled" | "urgent" }) {
  const sign = color === "settled" ? "+" : "−";
  const textClass = color === "settled" ? "font-medium text-settled" : "font-medium text-urgent";
  const inner = (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{it.label}</span>
      <span className={textClass}>{sign}{fmtMoney(it.amount)}</span>
    </div>
  );
  if (it.href) {
    return (
      <a href={it.href} className="block rounded hover:bg-accent/40 -mx-1 px-1 transition-colors">
        {inner}
      </a>
    );
  }
  return inner;
}

type BreakdownItem = { label: string; value: number };

function CashFlowBars({
  inflow,
  outflow,
  inflowBreakdown = [],
  outflowBreakdown = [],
}: {
  inflow: number;
  outflow: number;
  inflowBreakdown?: BreakdownItem[];
  outflowBreakdown?: BreakdownItem[];
}) {
  const max = Math.max(inflow, outflow, 1);
  const activeInflow = inflowBreakdown.filter((i) => i.value > 0);
  const activeOutflow = outflowBreakdown.filter((i) => i.value > 0);
  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Income</span>
          <span className="font-semibold">{fmtMoney(inflow)}</span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-settled" style={{ width: `${(inflow / max) * 100}%` }} />
        </div>
        {activeInflow.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {activeInflow.map((item) => (
              <span key={item.label} className="text-[10px] text-muted-foreground">
                {item.label}: <span className="font-medium text-foreground">{fmtMoney(item.value)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Expenses</span>
          <span className="font-semibold">{fmtMoney(outflow)}</span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-urgent" style={{ width: `${(outflow / max) * 100}%` }} />
        </div>
        {activeOutflow.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {activeOutflow.map((item) => (
              <span key={item.label} className="text-[10px] text-muted-foreground">
                {item.label}: <span className="font-medium text-foreground">{fmtMoney(item.value)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function reviewDateInfo(kind: string, row: any): { prefix: string; date: string } | null {
  if (kind === "Property" && row.fixed_rate_end) return { prefix: "Reprice by", date: fmtMonth(row.fixed_rate_end) };
  if (kind === "Loan" && row.reprice_date) return { prefix: "Reprice by", date: fmtMonth(row.reprice_date) };
  if (kind === "Insurance") {
    // Derived from start_date + frequency, same as everywhere else alerts are computed —
    // not the dead next_due_date field, which no longer gets kept in sync with reality.
    const nextDue = computeNextOccurrence(row.start_date, row.frequency, row.end_date, new Date());
    if (nextDue) return { prefix: "Renew by", date: fmtMonth(nextDue) };
  }
  return null;
}

function AssetAllocationCard({
  allocProperty, allocInvestments, allocCash, allocTotal,
  allocPctProperty, allocPctInvestments, allocPctCash,
}: {
  allocProperty: number; allocInvestments: number; allocCash: number; allocTotal: number;
  allocPctProperty: number; allocPctInvestments: number; allocPctCash: number;
}) {
  const isEmpty = allocTotal === 0;
  const segments = [
    { label: "Property", value: allocProperty, pct: allocPctProperty, color: "bg-primary" },
    { label: "Investments", value: allocInvestments, pct: allocPctInvestments, color: "bg-settled" },
    { label: "Cash & Savings", value: allocCash, pct: allocPctCash, color: "bg-review" },
  ];
  const activeSegments = segments.filter((s) => s.value > 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Asset Allocation</h2>
        <span className="text-xs text-muted-foreground">SGD assets only</span>
      </div>
      {isEmpty ? (
        <p className="py-2 text-xs text-muted-foreground">No asset values recorded yet. Add properties, investments, or savings to see your allocation.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex h-4 w-full overflow-hidden rounded-full">
            {segments.map((s) => {
              const width = s.pct.toFixed(1);
              const isActive = s.value > 0;
              return isActive ? (
                <div
                  key={s.label}
                  className={`h-full ${s.color} transition-all`}
                  style={{ width: `${width}%` }}
                />
              ) : null;
            })}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {segments.map((s) => {
              const pctDisplay = s.pct > 0 ? `${Math.round(s.pct)}%` : "—";
              return (
                <div key={s.label} className="space-y-0.5">
                  <div className="flex items-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${s.color}`} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</span>
                  </div>
                  <div className="text-sm font-bold">{pctDisplay}</div>
                  <div className="text-[10px] text-muted-foreground">{fmtMoney(s.value)}</div>
                </div>
              );
            })}
          </div>
          {activeSegments.length === 1 && (
            <p className="text-[10px] text-muted-foreground">Only one asset class recorded — add investments or savings for a complete picture.</p>
          )}
        </div>
      )}
    </section>
  );
}

function InsuranceAdequacyCard({
  totalSumAssured,
  incomeReplacementNeed,
  coverageRatio,
  adequacyStatus,
  policiesWithNoSumAssured,
  activePolicyCount,
}: {
  totalSumAssured: number;
  incomeReplacementNeed: number;
  coverageRatio: number | null;
  adequacyStatus: "covered" | "partial" | "none" | "unset";
  policiesWithNoSumAssured: number;
  activePolicyCount: number;
}) {
  const statusConfig = {
    covered:  { label: "Adequately covered",  bar: "bg-settled",  text: "text-settled",  border: "border-settled/30  bg-settled/5" },
    partial:  { label: "Partially covered",   bar: "bg-review",   text: "text-review",   border: "border-review/30   bg-review/5" },
    none:     { label: "No cover recorded",   bar: "bg-urgent",   text: "text-urgent",   border: "border-urgent/30   bg-urgent-soft/20" },
    unset:    { label: "Income not set",      bar: "bg-muted",    text: "text-muted-foreground", border: "border-border bg-card" },
  };
  const cfg = statusConfig[adequacyStatus];
  const pct = coverageRatio != null ? Math.min(coverageRatio * 100, 100) : 0;

  return (
    <section className={`rounded-2xl border p-4 ${cfg.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Insurance Adequacy</h2>
        <Link to="/insurance" className="text-xs font-semibold text-primary">View policies →</Link>
      </div>

      {adequacyStatus === "unset" ? (
        <p className="text-xs text-muted-foreground">
          Set your monthly income in{" "}
          <a href="/settings" className="font-semibold text-primary underline">Settings</a>{" "}
          to calculate coverage need.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sum Assured</div>
              <div className="mt-0.5 text-lg font-bold">{fmtMoney(totalSumAssured)}</div>
              {policiesWithNoSumAssured > 0 && (
                <div className="text-[10px] text-muted-foreground">{policiesWithNoSumAssured} polic{policiesWithNoSumAssured === 1 ? "y" : "ies"} missing sum assured</div>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">10-Year Income Need</div>
              <div className="mt-0.5 text-lg font-bold">{fmtMoney(incomeReplacementNeed)}</div>
              <div className="text-[10px] text-muted-foreground">Monthly income × 120</div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={`font-semibold ${cfg.text}`}>{cfg.label}</span>
              {coverageRatio != null && (
                <span className="text-muted-foreground">{Math.round(coverageRatio * 100)}% covered</span>
              )}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full transition-all ${cfg.bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Based on {activePolicyCount} active polic{activePolicyCount === 1 ? "y" : "ies"}. Estimate only — excludes savings, CPF, and debt obligations.
            <Link to="/insurance" className="ml-1 font-semibold text-primary">Add sum assured →</Link>
          </p>
        </div>
      )}
    </section>
  );
}

function FinancialHealthCard({ checks, passCount, totalScored, onScroll }: {
  checks: { label: string; status: "pass" | "warning" | "fail" | "incomplete"; detail: string; href: string }[];
  passCount: number;
  totalScored: number;
  onScroll: (target: string) => void;
}) {
  const statusIcon = { pass: "✓", warning: "⚠", fail: "✗", incomplete: "—" };
  const statusColor = {
    pass: "text-settled",
    warning: "text-review",
    fail: "text-urgent",
    incomplete: "text-muted-foreground",
  };
  const rowBorder = {
    pass: "border-settled/20",
    warning: "border-review/30",
    fail: "border-urgent/30",
    incomplete: "border-border",
  };
  const summaryColor = totalScored === 0 ? "text-muted-foreground" : passCount === totalScored ? "text-settled" : passCount >= totalScored * 0.6 ? "text-review" : "text-urgent";

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Financial Health</h2>
        {totalScored > 0 && (
          <span className={`text-xs font-bold ${summaryColor}`}>{passCount}/{totalScored} checks passed</span>
        )}
      </div>
      <div className="space-y-2">
        {checks.map((c) => {
          const icon = statusIcon[c.status];
          const color = statusColor[c.status];
          const border = rowBorder[c.status];
          if (c.href === "") {
            return (
              <div key={c.label} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${border}`}>
                <span className={`w-4 shrink-0 text-center text-sm font-bold ${color}`}>{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">{c.detail}</div>
                </div>
              </div>
            );
          }
          return c.href === "cash-flow" || c.href === "needs-attention" ? (
              <button key={c.label} onClick={() => onScroll(c.href)} className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 hover:bg-accent/30 ${border}`}>
                <span className={`w-4 shrink-0 text-center text-sm font-bold ${color}`}>{icon}</span>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-xs font-semibold">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">{c.detail}</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ) : (
              <Link key={c.label} to={c.href as any} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 hover:bg-accent/30 ${border}`}>
                <span className={`w-4 shrink-0 text-center text-sm font-bold ${color}`}>{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{c.label}</div>
                  <div className="text-[10px] text-muted-foreground">{c.detail}</div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            );
        })}
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">Indicative only. Based on data entered. Not financial advice.</p>
    </section>
  );
}

function PrioritySection({ title, items, muted, showDate }: { title: string; items: any[]; muted?: boolean; showDate?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 8);
  return (
    <section className={`rounded-2xl border p-4 ${muted ? "border-review/40 bg-review-soft/40" : "border-urgent/40 bg-urgent-soft/30"}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="space-y-2">
        {visible.map(({ kind, row, href, icon: Icon }, i) => {
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
      {items.length > 8 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 flex w-full items-center justify-center gap-1 py-2 text-xs font-semibold text-primary"
        >
          {showAll ? "Show less ↑" : `Show ${items.length - 8} more ↓`}
        </button>
      )}
    </section>
  );
}
