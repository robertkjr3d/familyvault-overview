import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";
import { useToday } from "@/lib/today";
import { YearDetailPanel } from "@/components/YearDetailPanel";
import { type ChartPoint, fmt, projectLifetimeChart } from "@/lib/lifetimeChartMath";

type Props = {
  properties: any[];
  loans: any[];
  insurance: any[];
  savings: any[];
  investments: any[];
  members: any[];
  startingNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  appSettings: any;
};

export function LifetimeChart({
  properties, loans, insurance, savings, investments, members,
  startingNetWorth, monthlyIncome, monthlyExpenses, appSettings,
}: Props) {
  const { today } = useToday();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const startYear = today.getFullYear();

  // Read settings — use != null so 0 is respected, not treated as falsy
  const retirementYear = appSettings?.retirement_year != null ? Number(appSettings.retirement_year) : null;
  const cpfPayoutAge = appSettings?.cpf_payout_age != null ? Number(appSettings.cpf_payout_age) : 65;
  const cpfMonthlyPayout = appSettings?.cpf_monthly_payout != null ? Number(appSettings.cpf_monthly_payout) : 0;
  const investmentGrowthRate = (appSettings?.investment_growth_rate != null ? Number(appSettings.investment_growth_rate) : 4) / 100;
  const propertyAppreciationRate = (appSettings?.property_appreciation_rate != null ? Number(appSettings.property_appreciation_rate) : 2) / 100;
  const inflationRate = (appSettings?.inflation_rate != null ? Number(appSettings.inflation_rate) : 2) / 100;
  const planningHorizonAge = appSettings?.planning_horizon_age != null ? Number(appSettings.planning_horizon_age) : 85;

  // Derive oldest member's birth year for accurate horizon and CPF calculation
  const membersWithAge = members.filter((m) => m.birth_year);
  const oldestBirthYear = membersWithAge.length > 0
    ? Math.min(...membersWithAge.map((m) => Number(m.birth_year)))
    : null;
  const oldestCurrentAge = oldestBirthYear ? startYear - oldestBirthYear : null;

  // Planning horizon in years from oldest member's current age
  const horizonYears = oldestCurrentAge
    ? Math.max(planningHorizonAge - oldestCurrentAge + 1, 30)
    : 40;
  const clampedHorizon = Math.min(Math.max(horizonYears, 30), 70);

  // CPF payout start year from oldest member's birth year
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

  // Investments and savings without a currency field are treated as SGD.
  // Once the currency field is added to investments, non-SGD ones will be excluded.
  const sgdInvestments = investments.filter((inv: any) => !inv.currency || inv.currency === "SGD");
  const foreignInvestments = investments.filter((inv: any) => inv.currency && inv.currency !== "SGD");
  const sgdSavings = savings.filter((s: any) => !s.currency || s.currency === "SGD");
  const foreignSavings = savings.filter((s: any) => s.currency && s.currency !== "SGD");
  const hasForeignExcluded = foreignInvestments.length > 0 || foreignSavings.length > 0;

  const data = useMemo<ChartPoint[]>(() => projectLifetimeChart({
    properties, loans, insurance, sgdSavings, sgdInvestments, plannedEvents,
    startingNetWorth, monthlyIncome, monthlyExpenses, startYear,
    horizonYears: clampedHorizon, retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
  }), [
    properties, loans, insurance, sgdSavings, sgdInvestments, plannedEvents,
    startingNetWorth, monthlyIncome, monthlyExpenses,
    retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
    clampedHorizon, startYear,
  ]);

  const shortfallYear = data.find((d) => d.netWorth < 0) ?? null;
  const minNetWorth = Math.min(...data.map((d) => d.netWorth));
  const maxNetWorth = Math.max(...data.map((d) => d.netWorth));
  const eventYears = data.filter((d) => d.events.length > 0);
  const hasIncome = monthlyIncome > 0;
  const hasILPPayout = sgdInvestments.some((inv: any) =>
    (inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment")
    && inv.payout_amount && inv.payout_start_date
  );
  const domainMin = Math.min(minNetWorth * 1.1, minNetWorth - 50000, 0);
  const domainMax = maxNetWorth * 1.05;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = data.find((d) => d.year === label) ?? null;
    const nw = payload.find((p: any) => p.dataKey === "netWorth");
    const an = payload.find((p: any) => p.dataKey === "annualNet");
    const nwColor = nw && nw.value < 0 ? "font-semibold text-urgent" : "font-semibold text-settled";
    const anColor = an && an.value >= 0 ? "font-semibold text-settled" : "font-semibold text-urgent";
    const showPropGrowth = point !== null && point.propAppreciation > 0;
    const showInvestGrowth = point !== null && point.investGrowth > 0;
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-lg max-w-[220px]">
        <div className="mb-1 font-bold">{label}</div>
        {nw && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Net worth</span>
            <span className={nwColor}>{fmt(nw.value)}</span>
          </div>
        )}
        {an && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Cash flow net</span>
            <span className={anColor}>{fmt(an.value)}</span>
          </div>
        )}
        {point && (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">— Income</span>
              <span className="text-settled">+{fmt(point.annualIn)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">— Outflow</span>
              <span className="text-urgent">−{fmt(point.annualOut)}</span>
            </div>
          </>
        )}
        {showPropGrowth && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Property growth</span>
            <span className="font-semibold text-settled">+{fmt(point!.propAppreciation)}</span>
          </div>
        )}
        {showInvestGrowth && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Investment growth</span>
            <span className="font-semibold text-settled">+{fmt(point!.investGrowth)}</span>
          </div>
        )}
        {point?.events.map((e, idx) => (
          <div key={idx} className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium break-words">{e}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 pb-1">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
          <span className="inline-block h-0.5 w-5 rounded-full bg-[oklch(0.72_0.13_80)]" />
          Net Worth
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
          <span className="inline-block h-0.5 w-5 rounded-full bg-[oklch(0.62_0.13_155)]" />
          Annual Cash Flow
        </span>
      </div>
      {shortfallYear && (
        <div className="rounded-xl border border-urgent/40 bg-urgent-soft/30 px-4 py-3 text-sm">
          <span className="font-bold text-urgent">⚠ Projected shortfall in {shortfallYear.year}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Net worth turns negative in {shortfallYear.year} based on current projections.
            Consider adjusting income, expenses, or retirement date.
          </p>
        </div>
      )}
      {hasILPPayout && (
        <p className="rounded-lg bg-review-soft/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠ ILP/Endowment payouts are shown as additional income, while the policy's current value
          keeps growing untouched. In reality, the value would decline as payouts are drawn —
          this projection is indicative only and likely optimistic for years with active payouts.
        </p>
      )}
      {hasForeignExcluded && (
        <p className="rounded-lg bg-review-soft/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠ {foreignInvestments.length > 0 && foreignSavings.length > 0
            ? "Some investments and savings accounts are"
            : foreignInvestments.length > 0
            ? "Some investments are"
            : "Some savings accounts are"} in foreign currency and excluded from this projection. Only SGD assets are modelled.
        </p>
      )}
      {!hasIncome && (
        <p className="rounded-lg bg-review-soft/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠ No salary income set — add it in{" "}
          <a href="/settings" className="font-semibold text-primary underline">Settings</a>{" "}
          for an accurate projection.
        </p>
      )}
      <div className="h-80 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 30, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={4} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmt} domain={[domainMin, domainMax]} width={56} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="oklch(0.50 0.04 250 / 0.6)" strokeDasharray="4 4" />
            {retirementYear !== null && (
              <ReferenceLine
                x={retirementYear}
                stroke="oklch(0.62 0.10 195 / 0.7)"
                strokeDasharray="4 4"
                label={{ value: "Retire", position: "insideTopLeft", fontSize: 9, fill: "oklch(0.62 0.10 195)", dy: -18 }}
              />
            )}
            {shortfallYear !== null && (
              <ReferenceLine
                x={shortfallYear.year}
                stroke="oklch(0.60 0.22 25 / 0.8)"
                strokeWidth={2}
                label={{ value: "Shortfall", position: "insideTopLeft", fontSize: 9, fill: "oklch(0.60 0.22 25)", dy: -18 }}
              />
            )}
            {eventYears
              .filter((d) => d.year !== retirementYear && d.year !== shortfallYear?.year)
              .map((d) => {
                const shortLabel = d.events[0]?.split(" ")[0] ?? "";
                return (
                  <ReferenceLine
                    key={d.year}
                    x={d.year}
                    stroke="oklch(0.72 0.13 80 / 0.6)"
                    strokeDasharray="3 3"
                    label={{ value: shortLabel, position: "insideTopLeft", fontSize: 8, fill: "oklch(0.72 0.13 80)", dy: -18 }}
                  />
                );
              })}
            <Area
              type="monotone" dataKey="annualNet" name="Annual net"
              stroke="oklch(0.62 0.13 155 / 0.4)" fill="oklch(0.62 0.13 155 / 0.06)"
              strokeWidth={1} dot={false}
            />
            <Line
              type="monotone" dataKey="netWorth" name="Net worth"
              stroke="oklch(0.72 0.13 80)" strokeWidth={2.5}
              dot={false} activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {eventYears.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {eventYears.map((d) =>
            d.events.map((e, i) => (
              <span key={`${d.year}-${i}`} className="text-[10px] text-muted-foreground">
                <span className="font-semibold text-primary">{d.year}</span> — {e}
              </span>
            ))
          )}
        </div>
      )}
      <YearDetailPanel
        data={data}
        retirementYear={retirementYear}
        shortfallYear={shortfallYear?.year ?? null}
      />
      <p className="text-[10px] text-muted-foreground">
        Projection only · inflation-adjusted expenses · property &amp; investment growth modelled at assumed rates · foreign currency excluded · not financial advice
      </p>
    </div>
  );
}
