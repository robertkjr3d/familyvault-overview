import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { useToday } from "@/lib/today";

type Props = {
  properties: any[];
  loans: any[];
  insurance: any[];
  savings: any[];
  startingNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
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
  return premium; // annual default
}

export function LifetimeChart({
  properties,
  loans,
  insurance,
  savings,
  startingNetWorth,
  monthlyIncome,
  monthlyExpenses,
}: Props) {
  const { today } = useToday();
  const startYear = today.getFullYear();

  const data = useMemo<ChartPoint[]>(() => {
    let runningNetWorth = startingNetWorth;
    const years: ChartPoint[] = [];

    for (let i = 0; i < 40; i++) {
      const y = startYear + i;
      let annualIn = 0;
      let annualOut = 0;
      const events: string[] = [];

      // Salary income and base expenses (monthly → annual)
      annualIn += monthlyIncome * 12;
      annualOut += monthlyExpenses * 12;

      // Property: rental income in, costs + mortgage out
      for (const p of properties) {
        if (p.monthly_rent) annualIn += Number(p.monthly_rent) * 12;
        if (p.monthly_costs) annualOut += Number(p.monthly_costs) * 12;
        // Mortgage stops at fixed_rate_end year as a rough payoff proxy
        const mortgageEnds = p.fixed_rate_end ? new Date(p.fixed_rate_end).getFullYear() + 25 : startYear + 40;
        if (p.monthly_payment && y <= mortgageEnds) {
          annualOut += Number(p.monthly_payment) * 12;
        }
      }

      // Loans: repayments out, stop 25y after reprice date as rough payoff proxy
      for (const l of loans) {
        if (!l.monthly_payment) continue;
        const loanEnds = l.reprice_date ? new Date(l.reprice_date).getFullYear() + 25 : startYear + 40;
        if (y <= loanEnds) {
          annualOut += Number(l.monthly_payment) * 12;
        }
      }

      // Insurance: premiums out during active period, payout as one-off inflow
      for (const ins of insurance) {
        const insStart = ins.start_date ? new Date(ins.start_date).getFullYear() : startYear;
        const insEnd = ins.end_date ? new Date(ins.end_date).getFullYear() : startYear + 40;
        if (y >= insStart && y <= insEnd) {
          annualOut += insuranceAnnual(ins);
        }
        if (ins.payout_year && Number(ins.payout_year) === y && ins.expected_payout) {
          const payout = Number(ins.expected_payout);
          annualIn += payout;
          events.push(`${ins.name ?? "Insurance"} payout +$${(payout / 1000).toFixed(0)}k`);
        }
      }

      // Savings / FD: maturity lump sum inflow
      for (const s of savings) {
        if (!s.maturity_date) continue;
        const matYear = new Date(s.maturity_date).getFullYear();
        if (matYear === y && s.balance) {
          const bal = Number(s.balance);
          annualIn += bal;
          events.push(`${s.institution ?? "FD"} matures +$${(bal / 1000).toFixed(0)}k`);
        }
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
  }, [properties, loans, insurance, savings, startingNetWorth, monthlyIncome, monthlyExpenses, startYear]);

  const hasIncome = monthlyIncome > 0;
  const minNetWorth = Math.min(...data.map((d) => d.netWorth));
  const maxNetWorth = Math.max(...data.map((d) => d.netWorth));

  const eventYears = data.filter((d) => d.events.length > 0);

  const fmt = (v: number) => {
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
    return `${sign}$${abs}`;
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = data.find((d) => d.year === label);
    const nw = payload.find((p: any) => p.dataKey === "netWorth");
    const an = payload.find((p: any) => p.dataKey === "annualNet");
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-lg max-w-[200px]">
        <div className="mb-1 font-bold">{label}</div>
        {nw && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Net worth</span>
            <span className="font-semibold">{fmt(nw.value)}</span>
          </div>
        )}
        {an && (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Annual net</span>
            {(() => {
              const anColor = an.value >= 0 ? "font-semibold text-settled" : "font-semibold text-urgent";
              return <span className={anColor}>{fmt(an.value)}</span>;
            })()}
          </div>
        )}
        {point?.events.map((e, i) => (
          <div key={i} className="mt-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary font-medium">{e}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {!hasIncome && (
        <p className="rounded-lg bg-review-soft/40 px-3 py-2 text-xs text-muted-foreground">
          ⚠️ No salary income set — add it in{" "}
          <a href="/settings" className="font-semibold text-primary underline">Settings</a>{" "}
          for an accurate projection.
        </p>
      )}
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={4} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={fmt}
              domain={[Math.min(minNetWorth * 1.1, 0), maxNetWorth * 1.05]}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* Zero line */}
            <ReferenceLine y={0} stroke="oklch(0.50 0.04 250 / 0.5)" strokeDasharray="4 4" />
            {/* Event markers */}
            {eventYears.map((d) => (
              <ReferenceLine
                key={d.year}
                x={d.year}
                stroke="oklch(0.72 0.13 80 / 0.6)"
                strokeDasharray="3 3"
              />
            ))}
            {/* Annual net cash flow as subtle area */}
            <Area
              type="monotone"
              dataKey="annualNet"
              name="Annual net"
              stroke="oklch(0.62 0.13 155 / 0.4)"
              fill="oklch(0.62 0.13 155 / 0.08)"
              strokeWidth={1}
              dot={false}
            />
            {/* Cumulative net worth — the main line */}
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
        Projection only · assumes current cash flows continue · foreign currency excluded · investment returns not modelled
      </p>
    </div>
  );
}
