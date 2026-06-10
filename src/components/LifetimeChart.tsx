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
  propAppreciation: number;
  investGrowth: number;
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

function propertyTotalCosts(p: any): number {
  const itemised = ["cost_management", "cost_property_tax", "cost_fire_insurance", "cost_maintenance", "cost_other"]
    .reduce((s, k) => s + (Number(p[k]) || 0), 0);
  return itemised || (Number(p.monthly_costs) || 0);
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function LifetimeChart({
  properties, loans, insurance, savings, members,
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

  const data = useMemo<ChartPoint[]>(() => {
    let runningNetWorth = startingNetWorth;

    // Per-property value tracking for appreciation
    const propValues: Record<string, number> = {};
    for (const p of properties) {
      propValues[p.id] = Number(p.current_value) || 0;
    }

    // Investable pool: net worth minus property values, grows independently
    const totalPropertyValue = properties.reduce((s: number, p: any) => s + (Number(p.current_value) || 0), 0);
    let investablePool = Math.max(startingNetWorth - totalPropertyValue, 0);

    // Properties linked to a loan — skip their monthly_payment (counted via loan)
    const mortgagedPropertyIds = new Set(
      loans.filter((l: any) => l.property_id).map((l: any) => l.property_id)
    );

    const years: ChartPoint[] = [];

    for (let i = 0; i < clampedHorizon; i++) {
      const y = startYear + i;
      let annualIn = 0;
      let annualOut = 0;
      const events: string[] = [];

      // Salary — stops at retirement year
      const salaryActive = retirementYear === null || y < retirementYear;
      if (salaryActive) {
        annualIn += monthlyIncome * 12;
      }

      // CPF LIFE payout
      if (cpfStartYear !== null && y >= cpfStartYear && cpfMonthlyPayout > 0) {
        annualIn += cpfMonthlyPayout * 12;
        if (y === cpfStartYear) events.push(`CPF LIFE begins +${fmt(cpfMonthlyPayout * 12)}/yr`);
      }

      // Base household expenses — inflate annually
      annualOut += monthlyExpenses * 12 * Math.pow(1 + inflationRate, i);

      // Properties
      let yearPropertyAppreciation = 0;
      for (const p of properties) {
        // Rental income
        annualIn += (Number(p.monthly_rent) || 0) * 12;

        // Costs — use itemised fields, fall back to monthly_costs
        const costs = propertyTotalCosts(p);
        annualOut += costs * 12 * Math.pow(1 + inflationRate, i);

        // Mortgage — skip if linked loan covers it, stop at mortgage_end_date
        const isMortgagedViaLoan = mortgagedPropertyIds.has(p.id);
        if (!isMortgagedViaLoan && p.monthly_payment) {
          const mortgageEndYear = p.mortgage_end_date
            ? new Date(p.mortgage_end_date).getFullYear()
            : null;
          if (mortgageEndYear === null || y <= mortgageEndYear) {
            annualOut += Number(p.monthly_payment) * 12;
          }
        }

        // Property appreciation — tracked separately, does not feed investablePool
        const appreciation = (propValues[p.id] || 0) * propertyAppreciationRate;
        propValues[p.id] += appreciation;
        yearPropertyAppreciation += appreciation;
      }

      // Loans — stop at loan_end_date if set, otherwise run indefinitely
      for (const l of loans) {
        if (!l.monthly_payment) continue;
        const loanEndYear = l.loan_end_date
          ? new Date(l.loan_end_date).getFullYear()
          : null;
        if (loanEndYear === null || y <= loanEndYear) {
          annualOut += Number(l.monthly_payment) * 12;
        }
        if (loanEndYear === y) {
          events.push(`${l.bank ?? "Loan"} paid off`);
        }
      }

      // Insurance premiums and payouts
      for (const ins of insurance) {
        const insStart = ins.start_date ? new Date(ins.start_date).getFullYear() : startYear;
        const insEnd = ins.end_date ? new Date(ins.end_date).getFullYear() : startYear + 40;
        if (y >= insStart && y <= insEnd) annualOut += insuranceAnnual(ins);
        if (ins.payout_amount && ins.payout_start_date) {
          const payoutStartYear = new Date(ins.payout_start_date).getFullYear();
          const payoutEndYear = ins.payout_end_date ? new Date(ins.payout_end_date).getFullYear() : payoutStartYear;
          const pFreq = (ins.payout_frequency || "one-off").toLowerCase();
          const isRecurring = pFreq.includes("month") || pFreq.includes("annual") || pFreq.includes("year") || pFreq.includes("quart") || pFreq.includes("semi") || pFreq.includes("half");
          const annualPayoutAmt = isRecurring
            ? pFreq.includes("month") ? Number(ins.payout_amount) * 12
            : pFreq.includes("quart") ? Number(ins.payout_amount) * 4
            : pFreq.includes("semi") || pFreq.includes("half") ? Number(ins.payout_amount) * 2
            : Number(ins.payout_amount)
            : Number(ins.payout_amount);
          if (isRecurring && y >= payoutStartYear && y <= payoutEndYear) {
            annualIn += annualPayoutAmt;
            if (y === payoutStartYear) events.push(`${ins.name ?? "Insurance"} payout begins +${fmt(annualPayoutAmt)}/yr`);
          } else if (!isRecurring && y === payoutStartYear) {
            annualIn += annualPayoutAmt;
            events.push(`${ins.name ?? "Insurance"} payout +${fmt(annualPayoutAmt)}`);
          }
        }
      }

      // FD / savings maturities
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

      // Retirement marker
      if (retirementYear !== null && y === retirementYear) {
        events.push("Retirement — salary ends");
      }

      // Investment growth on investable pool — completely separate from property
      const investmentGrowth = investablePool * investmentGrowthRate;
      investablePool += investmentGrowth;

      // Cash flow net (excludes appreciation and investment growth)
      const annualNet = annualIn - annualOut;

      // Net worth: cash flow + investment growth + property appreciation
      runningNetWorth += annualNet + investmentGrowth + yearPropertyAppreciation;

      years.push({
        year: y,
        netWorth: Math.round(runningNetWorth),
        annualNet: Math.round(annualNet),
        propAppreciation: Math.round(yearPropertyAppreciation),
        investGrowth: Math.round(investmentGrowth),
        events,
      });
    }

    return years;
  }, [
    properties, loans, insurance, savings, plannedEvents,
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
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="inline-block h-0.5 w-5 rounded-full bg-[oklch(0.72_0.13_80)]" />
          Net Worth
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
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
      <p className="text-[10px] text-muted-foreground">
        Projection only · inflation-adjusted expenses · property &amp; investment growth modelled at assumed rates · foreign currency excluded · not financial advice
      </p>
    </div>
  );
}
