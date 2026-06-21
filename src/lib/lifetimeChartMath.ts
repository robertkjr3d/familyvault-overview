// Pure types and calculation helpers shared between LifetimeChart.tsx,
// YearDetailPanel.tsx, and the dashboard's cash-flow breakdown — deliberately
// kept free of any React or charting library import. This is what lets the
// dashboard (src/routes/index.tsx) use freqTimesPerYear/LineItem without
// eagerly loading recharts; only the actual <LifetimeChart> component (lazy-
// loaded) pulls recharts in, and only when it's about to render.

export type LineItem = {
  label: string;
  amount: number;
  href?: string;
  // How many times per year this item recurs (12 = monthly, 4 = quarterly,
  // 2 = semi-annual, 1 = annual or a single one-off occurrence this year).
  // Optional — defaults to 1 (annual) wherever omitted.
  timesPerYear?: number;
};

export type ChartPoint = {
  year: number;
  netWorth: number;
  annualNet: number;
  annualIn: number;
  annualOut: number;
  inflowItems: LineItem[];
  outflowItems: LineItem[];
  propAppreciation: number;
  investGrowth: number;
  events: string[];
};

// Maps a frequency string (e.g. insurance/ILP "frequency" or "payout_frequency"
// fields) to how many times per year it occurs, for the Year Detail frequency
// column and the dashboard's "÷12" cash-flow annotation. Defaults to 1
// (annual / single occurrence) for unrecognised or one-off values.
export function freqTimesPerYear(freq: string | null | undefined): number {
  const f = (freq || "annual").toLowerCase();
  if (f.includes("month")) return 12;
  if (f.includes("quart")) return 4;
  if (f.includes("semi") || f.includes("half")) return 2;
  return 1;
}

export function fmt(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
