import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";
import { useToday } from "@/lib/today";

type Props = {
  properties: any[];
  loans: any[];
  insurance: any[];
  savings: any[];
  members: any[];
  startingNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  appSettings: any;
};

type ChartPoint = {
  year: number;
  netWorth: number;
  annualNet: number;
  events: string[];
};

function insuranceAnnual(ins: any): number {
  const premium = Number(ins.premium) || 0;
  const f = (ins.frequency || "annual").toLowerCase();
  if (f === "one-off" || f === "single") return 0;
  if (f.includes("month")) return premium * 12;
  if (f.includes("semi") || f.includes("half")) return premium * 2;
  if (f.includes("quart")) return premium * 4;
  return premium;
}

export function LifetimeChart({
  properties, loans, insurance, savings, members,
  startingNetWorth, monthlyIncome, monthlyExpenses, appSettings,
}: Props) {
  const { today } = useToday();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const startYear = today.getFullYear();

  const retirementYear = appSettings?.retirement_year ? Number(appSettings.retirement_year) : null;
  const cpfPayoutAge = Number(appSettings?.cpf_payout_age) || 65;
  const cpfMonthlyPayout = Number(appSettings?.cpf_monthly_payout) || 0;
  const investmentGrowthRate = (Number(appSettings?.investment_growth_rate) || 4) / 100;
  const propertyAppreciationRate = (Number(appSettings?.property_appreciation_rate) || 2) / 100;
  const inflationRate = (Number(appSettings?.inflation_rate) || 2) / 100;
  const planningHorizonAge = Number(appSettings?.planning_horizon_age) || 85;

  // Derive oldest member's birth year for accurate horizon and CPF calculation
  const oldestBirthYear = members.length > 0
    ? Math.min(...members.filter((m) => m.birth_year).map((m) => Number(m.birth_year)))
    : null;
  const oldestCurrentAge = oldestBirthYear ? startYear - oldestBirthYear : null;

  // Planning horizon: project to planningHorizonAge from oldest member's current age
  const horizonYears = oldestCurrentAge
    ? Math.max(planningHorizonAge - oldestCurrentAge + 1, 30)
    : 40;
  const clampedHorizon = Math.min(Math.max(horizonYears, 30), 70);

  // CPF payout start year: derived from oldest member's birth year + cpfPayoutAge
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

  const data = useMemo<ChartPoint[]>(() => {
    let runningNetWorth = startingNetWorth;
    // Track compounding values separately
    let investmentPool = properties.reduce((s: number, p: any) => s, 0); // investments tracked via prop
    const investmentStartValue = 0; // handled via annualIn growth below

    // Build per-property current values for appreciation
    const propValues: Record<string, number> = {};
    for (const p of properties) {
      propValues[p.id] = Number(p.current_value) || 0;
    }

    // Properties with a linked mortgage loan — exclude their monthly_payment (covered by loan)
    const mortgagedPropertyIds = new Set(
      loans.filter((l: any) => l.property_id).map((l: any) => l.property_id)
    );

    const years: ChartPoint[] = [];

    for (let i = 0; i < clampedHorizon; i++) {
      const y = startYear + i;
      let annualIn = 0;
      let annualOut = 0;
      const events: string[] = [];

      // Salary income — stops at retirement year
      const salaryActive = !retirementYear || y < retirementYear;
      if (salaryActive) {
        // Inflate expenses each year, keep salary flat (conservative)
        annualIn += monthlyIncome * 12;
      }

      // CPF payout starts at cpfStartYear
      if (cpfStartYear && y >= cpfStartYear && cpfMonthlyPayout > 0) {
        annualIn += cpfMonthlyPayout * 12;
        if (y === cpfStartYear) events.push(`CPF LIFE begins +${fmt(cpfMonthlyPayout * 12)}/yr`);
      }

      // Base expenses — inflate annually
      const inflatedExpenses = monthlyExpenses * 12 * Math.pow(1 + inflationRate, i);
      annualOut += inflatedExpenses;

      // Property: rental income in, costs + mortgage out; value appreciates
      for (const p of properties) {
        if (p.monthly_rent) annualIn += Number(p.monthly_rent) * 12;
        const inflatedCosts = (Number(p.monthly_costs) || 0) * 12 * Math.pow(1 + inflationRate, i);
        annualOut += inflatedCosts;
        const mortgageEnds = p.fixed_rate_end
          ? new Date(p.fixed_rate_end).getFullYear() + 25
          : startYear + 40;
        const isMortgagedViaLoan = mortgagedPropertyIds.has(p.id);
        if (p.monthly_payment && !isMortgagedViaLoan && y <= mortgageEnds) {
          annualOut += Number(p.monthly_payment) * 12;
        }
        // Property appreciation adds to net worth directly
        const appreciation = (propValues[p.id] || 0) * propertyAppreciationRate;
        propValues[p.id] = (propValues[p.id] || 0) + appreciation;
        annualIn += appreciation;
        if (i === 0 && propertyAppreciationRate > 0) {
          // Don't spam events — just model silently
        }
      }

      // Loans: stop at rough payoff
      for (const l of loans) {
        if (!l.monthly_payment) continue;
        const loanEnds = l.reprice_date
          ? new Date(l.reprice_date).getFullYear() + 25
          : startYear + 40;
        if (y <= loanEnds) annualOut += Number(l.monthly_payment) * 12;
      }

      // Insurance: premiums out, payouts as events
      for (const ins of insurance) {
        const insStart = ins.start_date ? new Date(ins.start_date).getFullYear() : startYear;
        const insEnd = ins.end_date ? new Date(ins.end_date).getFullYear() : startYear + 40;
        if (y >= insStart && y <= insEnd) annualOut += insuranceAnnual(ins);
        if (ins.payout_year && Number(ins.payout_year) === y && ins.expected_payout) {
          const payout = Number(ins.expected_payout);
          annualIn += payout;
          events.push(`${ins.name ?? "Insurance"} payout +${fmt(payout)}`);
        }
      }

      // FD / savings maturity
      for (const s of savings) {
        if (!s.maturity_date) continue;
        const matYear = new Date(s.maturity_date).getFullYear();
        if (matYear === y && s.balance) {
          const bal = Number(s.balance);
          annualIn += bal;
          events.push(`${s.institution ?? "FD"} matures +${fmt(bal)}`);
        }
      }

      // Planned one-off events
      for (const ev of plannedEvents as any[]) {
        if (Number(ev.year) === y) {
          const amt = Number(ev.amount);
          if (ev.type === "inflow") {
            annualIn += amt;
            events.push(`${ev.label} +${fmt(amt)}`);
          } else {
            annualOut += amt;
            events.push(`${ev.label} −${fmt(amt)}`);
          }
        }
      }

      // Retirement year marker
      if (retirementYear && y === retirementYear) {
        events.push("Retirement — salary ends");
      }

      // Investment growth on running net worth proxy
      // Model: a portion of net worth (non-property) grows at investmentGrowthRate
      // Simple approach: add growth on positive running balance at growth rate
      if (runningNetWorth > 0 && investmentGrowthRate > 0) {
        const growth = runningNetWorth * investmentGrowthRate * 0.3; // 30% of NW assumed in investments
        annualIn += growth;
      }

      const annualNet = annualIn - annualOut;
      runningNetWorth += annualNet;

      years.push({
        year: y,
        netWorth: Math.round(runningNetWorth),
        annualNet: Math.round(annualNet),
        events,
      });
    }

    return years;
  }, [
    properties, loans, insurance, savings, plannedEvents,
    startingNetWorth, monthlyIncome, monthlyExpenses,
    retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
    inflationRate, clampedHorizon, startYear,
  ]);

  // Shortfall detection
  const shortfallYear = data.find((d) => d.netWorth < 0);
  const minNetWorth = Math.min(...data.map((d) => d.netWorth));
  const maxNetWorth = Math.max(...data.map((d) => d.netWorth));
  const eventYears = data.filter((d) => d.events.length > 0);
  const hasIncome = monthlyIncome > 0;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = data.find((d) => d.year === label);
    const nw = payload.find((p: any) => p.dataKey === "netWorth");
    const an = payload.find((p: any) => p.dataKey === "annualNet");
    const nwColor = nw && nw.value < 0 ? "font-semibold text-urgent" : "font-semibold text-settled";
    const anColor = an && an.value >= 0 ? "font-semibold text-settled" : "font-semibold text-urgent";
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
            <span className="text-muted-foreground">Annual net</span>
            <span className={anColor}>{fmt(an.value)}</span>
          </div>
        )}
        {point?.events.map((e, i) => (
          <div key={i} className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium break-words">{e}</div>
        ))}
      </div>
    );
  };

  const domainMin = Math.min(minNetWorth * 1.1, minNetWorth - 50000, 0);
  const domainMax = maxNetWorth * 1.05;

  return (
    <div className="space-y-2">
      {/* Shortfall alert */}
      {shortfallYear && (
        <div className="rounded-xl border border-urgent/40 bg-urgent-soft/30 px-4 py-3 text-sm">
          <span className="font-bold text-urgent">⚠ Projected shortfall in {shortfallYear.year}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Based on current projections, net worth turns negative in {shortfallYear.year}.
            Consider adjusting income, expenses, or retirement date.
          </p>
        </div>
      )}

      {/* No income warning */}
      {!hasIncome && (
        <p className="rounded-lg bg-review-soft/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠ No salary income set — add it in{" "}
          <a href="/settings" className="font-semibold text-primary underline">Settings</a>{" "}
          for an accurate projection.
        </p>
      )}

      {/* Chart */}
      <div className="h-80 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 30, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={4} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={fmt}
              domain={[domainMin, domainMax]}
              width={56}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Zero line */}
            <ReferenceLine y={0} stroke="oklch(0.50 0.04 250 / 0.6)" strokeDasharray="4 4" />
            {/* Retirement marker */}
            {retirementYear && (
              <ReferenceLine
                x={retirementYear}
                stroke="oklch(0.62 0.10 195 / 0.7)"
                strokeDasharray="4 4"
                label={{ value: "Retire", position: "insideTopLeft", fontSize: 9, fill: "oklch(0.62 0.10 195)", dy: -18 }}
              />
            )}
            {/* Shortfall marker */}
            {shortfallYear && (
              <ReferenceLine
                x={shortfallYear.year}
                stroke="oklch(0.60 0.22 25 / 0.8)"
                strokeWidth={2}
                label={{ value: "Shortfall", position: "insideTopLeft", fontSize: 9, fill: "oklch(0.60 0.22 25)", dy: -18 }}
              />
            )}
            {/* Event markers — gold dotted lines with abbreviated labels */}
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
            {/* Annual net as subtle area */}
            <Area
              type="monotone"
              dataKey="annualNet"
              name="Annual net"
              stroke="oklch(0.62 0.13 155 / 0.4)"
              fill="oklch(0.62 0.13 155 / 0.06)"
              strokeWidth={1}
              dot={false}
            />
            {/* Net worth — the main line */}
            <Line
              type="monotone"
              dataKey="netWorth"
              name="Net worth"
              stroke="oklch(0.72 0.13 80)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Event legend */}
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

      <p className="text-[10px] text-muted-foreground">
        Projection only · inflation-adjusted expenses · property &amp; investment growth modelled at assumed rates ·
        foreign currency excluded · not financial advice
      </p>
    </div>
  );
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
