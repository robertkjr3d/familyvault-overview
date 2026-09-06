import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { ResponsiveContainer, ComposedChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from "recharts";
import { useToday } from "@/lib/today";
import { formatDateOnly } from "@/lib/alerts";
import { type ChartPoint, fmt, projectLifetimeChart, computeCashflowDomain } from "@/lib/lifetimeChartMath";
import { KeyEventsList } from "@/components/KeyEventsList";

// Aug 29, 2026: moved out of LifetimeChart.tsx (the Lifetime Net Worth
// card) into its own chart, in its own card (Monthly Cash Flow), per
// explicit request — the shared-axis version made cashflow an invisible
// sliver next to net worth's much larger scale. A standalone chart with
// its own axis is the cleaner fix (dual-axis charts are a recognized
// data-viz anti-pattern for exactly this reason).
//
// This intentionally DUPLICATES LifetimeChart.tsx's settings-parsing and
// projectLifetimeChart() setup rather than sharing a hook with it. Real
// tradeoff, not an oversight: extracting a shared hook is the more
// "correct" long-term structure, but LifetimeChart.tsx has been
// genuinely unstable this session (two rounds of real regressions
// already reverted) — touching its internals a third time to wire up a
// shared hook was judged higher-risk than accepting this duplication for
// now. Worth consolidating once that file has had a clean run for a
// while. If you change the projection math in one of these two files,
// check whether the same change applies to the other.

type Props = {
  properties: any[];
  loans: any[];
  insurance: any[];
  savings: any[];
  investments: any[];
  creditCards: any[];
  members: any[];
  startingNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  appSettings: any;
};

export function CashflowOverYearsChart({
  properties, loans, insurance, savings, investments, creditCards, members,
  startingNetWorth, monthlyIncome, monthlyExpenses, appSettings,
}: Props) {
  const { today } = useToday();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const startYear = today.getFullYear();
  const todayISO = formatDateOnly(today);

  const retirementYear = appSettings?.retirement_year != null ? Number(appSettings.retirement_year) : null;
  const cpfPayoutAge = appSettings?.cpf_payout_age != null ? Number(appSettings.cpf_payout_age) : 65;
  const cpfMonthlyPayout = appSettings?.cpf_monthly_payout != null ? Number(appSettings.cpf_monthly_payout) : 0;
  const investmentGrowthRate = (appSettings?.investment_growth_rate != null ? Number(appSettings.investment_growth_rate) : 4) / 100;
  const propertyAppreciationRate = (appSettings?.property_appreciation_rate != null ? Number(appSettings.property_appreciation_rate) : 2) / 100;
  const inflationRate = (appSettings?.inflation_rate != null ? Number(appSettings.inflation_rate) : 2) / 100;
  const planningHorizonAge = appSettings?.planning_horizon_age != null ? Number(appSettings.planning_horizon_age) : 85;

  const membersWithAge = members.filter((m) => m.birth_year);
  const oldestBirthYear = membersWithAge.length > 0
    ? Math.min(...membersWithAge.map((m) => Number(m.birth_year)))
    : null;
  const oldestCurrentAge = oldestBirthYear ? startYear - oldestBirthYear : null;
  const horizonYears = oldestCurrentAge
    ? Math.max(planningHorizonAge - oldestCurrentAge + 1, 30)
    : 40;
  const clampedHorizon = Math.min(Math.max(horizonYears, 30), 70);
  const cpfStartYear = oldestBirthYear
    ? oldestBirthYear + cpfPayoutAge
    : retirementYear
    ? retirementYear - 65 + cpfPayoutAge
    : null;

  const { data: plannedEvents = [] } = useQuery({
    queryKey: ["planned_events_chart", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data } = await supabase
        .from("planned_cashflow_events" as any)
        .select("*")
        .eq("household_id", activeHouseholdId)
        .order("year", { ascending: true });
      return data ?? [];
    },
  });

  const sgdProperties = properties.filter((p: any) => !p.currency || p.currency === "SGD");
  const sgdLoans = loans.filter((l: any) => !l.currency || l.currency === "SGD");
  const sgdInsurance = insurance.filter((p: any) => !p.currency || p.currency === "SGD");
  const sgdInvestments = investments.filter((inv: any) => !inv.currency || inv.currency === "SGD");
  const sgdSavings = savings.filter((s: any) => !s.currency || s.currency === "SGD");

  const data = useMemo<ChartPoint[]>(() => projectLifetimeChart({
    properties: sgdProperties, loans: sgdLoans, insurance: sgdInsurance, sgdSavings, sgdInvestments, plannedEvents,
    creditCards,
    startingNetWorth, monthlyIncome, monthlyExpenses, startYear, today,
    horizonYears: clampedHorizon, retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    sgdProperties, sgdLoans, sgdInsurance, sgdSavings, sgdInvestments, plannedEvents, creditCards,
    startingNetWorth, monthlyIncome, monthlyExpenses,
    retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
    clampedHorizon, startYear, todayISO,
  ]);

  const { min: flowDomainMin, max: flowDomainMax } = computeCashflowDomain(data.map((d) => d.annualNet));
  const eventYears = data.filter((d) => d.events.length > 0);

  const CashflowTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const an = payload.find((p: any) => p.dataKey === "annualNet");
    if (!an) return null;
    const point = data.find((d) => d.year === label) ?? null;
    const color = an.value >= 0 ? "font-semibold text-settled" : "font-semibold text-urgent";
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-lg max-w-[220px]">
        <div className="mb-1 font-bold">{label}</div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Net cash flow</span>
          <span className={color}>{fmt(an.value)}</span>
        </div>
        {point?.events.map((e, idx) => (
          <div key={idx} className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium break-words">{e.label}</div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.85 0.01 250 / 0.4)" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={Math.max(4, Math.ceil(data.length / 8))} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={fmt} domain={[flowDomainMin, flowDomainMax]} width={48} />
            <Tooltip content={<CashflowTooltip />} />
            <ReferenceLine y={0} stroke="oklch(0.50 0.04 250 / 0.6)" strokeDasharray="4 4" />
            {eventYears.map((d) => (
              <ReferenceLine key={d.year} x={d.year} stroke="oklch(0.72 0.13 80 / 0.5)" strokeDasharray="3 3" />
            ))}
            <Area
              type="monotone" dataKey="annualNet" name="Net cash flow"
              stroke="oklch(0.62 0.13 155 / 0.8)" fill="oklch(0.62 0.13 155 / 0.2)"
              strokeWidth={1.5} dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <KeyEventsList eventYears={eventYears} />
    </div>
  );
}
