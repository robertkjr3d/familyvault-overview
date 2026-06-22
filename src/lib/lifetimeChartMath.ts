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

// Converts an insurance policy's premium to an annual figure based on its
// frequency field. Moved here (was private to LifetimeChart.tsx) so it can
// be unit tested directly and reused without duplication.
export function insuranceAnnual(ins: any): number {
  const premium = Number(ins.premium) || 0;
  const f = (ins.frequency || "annual").toLowerCase();
  if (f === "one-off" || f === "single") return 0;
  if (f.includes("month")) return premium * 12;
  if (f.includes("semi") || f.includes("half")) return premium * 2;
  if (f.includes("quart")) return premium * 4;
  return premium;
}

// Same conversion as insuranceAnnual, for ILP/Endowment investment premiums.
// Kept as a separate function (not merged with insuranceAnnual) because the
// two read different fields (premium vs premium_amount/premium_frequency)
// from genuinely different record shapes.
export function investmentPremiumAnnual(inv: any): number {
  const premium = Number(inv.premium_amount) || 0;
  const f = (inv.premium_frequency || "annual").toLowerCase();
  if (f === "one-off" || f === "single") return 0;
  if (f.includes("month")) return premium * 12;
  if (f.includes("semi") || f.includes("half")) return premium * 2;
  if (f.includes("quart")) return premium * 4;
  return premium;
}

// Sums a property's itemised monthly cost fields, falling back to the
// legacy monthly_costs field if none of the itemised fields are populated.
// This is the single source of truth for property costs — both the
// Lifetime Chart projection AND the dashboard's current-month cash flow
// (src/routes/index.tsx) must import this rather than redefining it; a
// second, identical copy was found living locally in index.tsx and has
// been consolidated to import from here instead.
export function propertyTotalCosts(p: any): number {
  const itemised = ["cost_management", "cost_property_tax", "cost_fire_insurance", "cost_maintenance", "cost_other"]
    .reduce((s, k) => s + (Number(p[k]) || 0), 0);
  return itemised || (Number(p.monthly_costs) || 0);
}

export type LifetimeProjectionInput = {
  properties: any[];
  loans: any[];
  insurance: any[];
  // Already filtered to SGD-only by the caller (foreign-currency savings/
  // investments are excluded from the projection entirely, see
  // hasForeignExcluded in LifetimeChart.tsx).
  sgdSavings: any[];
  sgdInvestments: any[];
  plannedEvents: any[];
  startingNetWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  startYear: number;
  horizonYears: number;
  retirementYear: number | null;
  cpfStartYear: number | null;
  cpfMonthlyPayout: number;
  investmentGrowthRate: number;
  propertyAppreciationRate: number;
  inflationRate: number;
};

// The core year-by-year net worth projection used by the Lifetime Chart.
// Pure function: same inputs always produce the same ChartPoint[] output,
// with no React, no Supabase, no Date.now() — every "today" comes in via
// startYear. This is what makes it directly unit-testable (see
// lifetimeChartMath.test.ts) without needing to render the chart component
// or mock react-query/Supabase.
//
// Extracted verbatim from the useMemo body that used to live inline in
// LifetimeChart.tsx — the year-by-year logic itself is unchanged, only its
// location moved. See LifetimeChart.tsx for how the component derives
// horizonYears/cpfStartYear/etc. from appSettings before calling this.
export function projectLifetimeChart(input: LifetimeProjectionInput): ChartPoint[] {
  const {
    properties, loans, insurance, sgdSavings, sgdInvestments, plannedEvents,
    startingNetWorth, monthlyIncome, monthlyExpenses, startYear, horizonYears,
    retirementYear, cpfStartYear, cpfMonthlyPayout,
    investmentGrowthRate, propertyAppreciationRate, inflationRate,
  } = input;

  let runningNetWorth = startingNetWorth;

  // Per-property value tracking for appreciation
  const propValues: Record<string, number> = {};
  for (const p of properties) {
    propValues[p.id] = Number(p.current_value) || 0;
  }

  // Per-investment value tracking for growth (SGD only, non-ILP/Endowment)
  // ILP/Endowment are already handled via their premium/payout fields below
  const invValues: Record<string, number> = {};
  for (const inv of sgdInvestments) {
    const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
    if (!isILP) invValues[inv.id] = Number(inv.current_value) || 0;
  }

  // Per-savings balance tracking for growth (SGD only)
  const savValues: Record<string, number> = {};
  for (const s of sgdSavings) {
    savValues[s.id] = Number(s.balance) || 0;
  }

  // Properties linked to a loan — skip their monthly_payment (counted via loan)
  const mortgagedPropertyIds = new Set(
    loans.filter((l: any) => l.property_id).map((l: any) => l.property_id)
  );

  const years: ChartPoint[] = [];

  for (let i = 0; i < horizonYears; i++) {
    const y = startYear + i;
    let annualIn = 0;
    let annualOut = 0;
    const inflowItems: LineItem[] = [];
    const outflowItems: LineItem[] = [];
    const events: string[] = [];

    // Salary — stops at retirement year
    const salaryActive = retirementYear === null || y < retirementYear;
    if (salaryActive) {
      const salary = monthlyIncome * 12;
      annualIn += salary;
      if (salary > 0) inflowItems.push({ label: "Salary income", amount: salary, href: "/settings", timesPerYear: 12 });
    }

    // CPF LIFE payout
    if (cpfStartYear !== null && y >= cpfStartYear && cpfMonthlyPayout > 0) {
      const cpf = cpfMonthlyPayout * 12;
      annualIn += cpf;
      inflowItems.push({ label: "CPF LIFE payout", amount: cpf, href: "/settings", timesPerYear: 12 });
      if (y === cpfStartYear) events.push(`CPF LIFE begins +${fmt(cpfMonthlyPayout * 12)}/yr`);
    }

    // Base household expenses — inflate annually
    const livingExpenses = monthlyExpenses * 12 * Math.pow(1 + inflationRate, i);
    annualOut += livingExpenses;
    if (livingExpenses > 0) outflowItems.push({ label: "Living expenses", amount: livingExpenses, href: "/settings", timesPerYear: 12 });

    // Properties
    let yearPropertyAppreciation = 0;
    for (const p of properties) {
      const propHref = `/property#record-${p.id}`;

      // Rental income
      const rental = (Number(p.monthly_rent) || 0) * 12;
      annualIn += rental;
      if (rental > 0) inflowItems.push({ label: `${p.name ?? "Property"} rental`, amount: rental, href: propHref, timesPerYear: 12 });

      // Costs — use itemised fields, fall back to monthly_costs
      const costs = propertyTotalCosts(p);
      const annualCosts = costs * 12 * Math.pow(1 + inflationRate, i);
      annualOut += annualCosts;
      if (annualCosts > 0) outflowItems.push({ label: `${p.name ?? "Property"} costs`, amount: annualCosts, href: propHref, timesPerYear: 12 });

      // Mortgage — skip if linked loan covers it, stop at mortgage_end_date
      const isMortgagedViaLoan = mortgagedPropertyIds.has(p.id);
      if (!isMortgagedViaLoan && p.monthly_payment) {
        const mortgageEndYear = p.mortgage_end_date
          ? new Date(p.mortgage_end_date).getFullYear()
          : null;
        if (mortgageEndYear === null || y <= mortgageEndYear) {
          const mortgage = Number(p.monthly_payment) * 12;
          annualOut += mortgage;
          outflowItems.push({ label: `${p.name ?? "Property"} mortgage`, amount: mortgage, href: propHref, timesPerYear: 12 });
        }
      }

      // Property appreciation — tracked separately, does not feed investable pools
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
        const repayment = Number(l.monthly_payment) * 12;
        annualOut += repayment;
        outflowItems.push({ label: `${l.bank ?? "Loan"} repayment`, amount: repayment, href: `/loans#record-${l.id}`, timesPerYear: 12 });
      }
      if (loanEndYear === y) {
        events.push(`${l.bank ?? "Loan"} paid off`);
      }
    }

    // Insurance premiums and payouts
    for (const ins of insurance) {
      const insHref = `/insurance#record-${ins.id}`;
      const insStart = ins.start_date ? new Date(ins.start_date).getFullYear() : startYear;
      const insEnd = ins.end_date ? new Date(ins.end_date).getFullYear() : startYear + 70;
      if (y >= insStart && y <= insEnd) {
        const premium = insuranceAnnual(ins);
        annualOut += premium;
        if (premium > 0) outflowItems.push({ label: `${ins.name ?? "Insurance"} premium`, amount: premium, href: insHref, timesPerYear: freqTimesPerYear(ins.frequency) });
      }
      if (ins.payout_amount && ins.payout_start_date) {
        const payoutStartYear = new Date(ins.payout_start_date).getFullYear();
        const payoutEndYear = ins.payout_end_date ? new Date(ins.payout_end_date).getFullYear() : startYear + 70;
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
          inflowItems.push({ label: `${ins.name ?? "Insurance"} payout`, amount: annualPayoutAmt, href: insHref, timesPerYear: freqTimesPerYear(pFreq) });
          if (y === payoutStartYear) events.push(`${ins.name ?? "Insurance"} payout begins +${fmt(annualPayoutAmt)}/yr`);
        } else if (!isRecurring && y === payoutStartYear) {
          annualIn += annualPayoutAmt;
          inflowItems.push({ label: `${ins.name ?? "Insurance"} payout`, amount: annualPayoutAmt, href: insHref, timesPerYear: 1 });
          events.push(`${ins.name ?? "Insurance"} payout +${fmt(annualPayoutAmt)}`);
        }
      }
    }

    // ILP / Endowment premiums and payouts (SGD investments only)
    for (const inv of sgdInvestments) {
      const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
      if (!isILP) continue;
      const invHref = `/investments#record-${inv.id}`;

      if (inv.premium_amount && inv.premium_start_date) {
        const premStartYear = new Date(inv.premium_start_date).getFullYear();
        const premEndYear = inv.premium_end_date ? new Date(inv.premium_end_date).getFullYear() : startYear + 70;
        if (y >= premStartYear && y <= premEndYear) {
          const premium = investmentPremiumAnnual(inv);
          annualOut += premium;
          if (premium > 0) outflowItems.push({ label: `${inv.name ?? "ILP"} premium`, amount: premium, href: invHref, timesPerYear: freqTimesPerYear(inv.premium_frequency) });
          if (y === premEndYear) events.push(`${inv.name ?? "ILP"} premiums end`);
        }
      }

      if (inv.payout_amount && inv.payout_start_date) {
        const payoutStartYear = new Date(inv.payout_start_date).getFullYear();
        const payoutEndYear = inv.payout_end_date ? new Date(inv.payout_end_date).getFullYear() : startYear + 70;
        const pFreq = (inv.payout_frequency || "one-off").toLowerCase();
        const isRecurring = pFreq.includes("month") || pFreq.includes("annual") || pFreq.includes("year") || pFreq.includes("quart") || pFreq.includes("semi") || pFreq.includes("half");
        const annualPayoutAmt = isRecurring
          ? pFreq.includes("month") ? Number(inv.payout_amount) * 12
          : pFreq.includes("quart") ? Number(inv.payout_amount) * 4
          : pFreq.includes("semi") || pFreq.includes("half") ? Number(inv.payout_amount) * 2
          : Number(inv.payout_amount)
          : Number(inv.payout_amount);
        if (isRecurring && y >= payoutStartYear && y <= payoutEndYear) {
          annualIn += annualPayoutAmt;
          inflowItems.push({ label: `${inv.name ?? "ILP"} payout`, amount: annualPayoutAmt, href: invHref, timesPerYear: freqTimesPerYear(pFreq) });
          if (y === payoutStartYear) events.push(`${inv.name ?? "ILP"} payout begins +${fmt(annualPayoutAmt)}/yr`);
        } else if (!isRecurring && y === payoutStartYear) {
          annualIn += annualPayoutAmt;
          inflowItems.push({ label: `${inv.name ?? "ILP"} payout`, amount: annualPayoutAmt, href: invHref, timesPerYear: 1 });
          events.push(`${inv.name ?? "ILP"} payout +${fmt(annualPayoutAmt)}`);
        }
      }
    }

    // Per-investment growth (SGD non-ILP/Endowment only)
    // Each investment compounds at the global investment growth rate and appears
    // as its own named line item in the year detail, with a link to the record.
    let yearInvestGrowth = 0;
    for (const inv of sgdInvestments) {
      const isILP = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
      if (isILP) continue;
      const growth = (invValues[inv.id] || 0) * investmentGrowthRate;
      invValues[inv.id] += growth;
      yearInvestGrowth += growth;
      if (growth > 0) {
        inflowItems.push({
          label: `${inv.name ?? "Investment"} growth`,
          amount: growth,
          href: `/investments#record-${inv.id}`,
          timesPerYear: 1,
        });
      }
    }

    // Per-savings growth (SGD only)
    // Each savings account compounds at its OWN interest_rate field when set,
    // falling back to the global investment growth rate only if interest_rate
    // is null. Uses != null (not ||) so a deliberately entered 0% rate is
    // respected rather than silently replaced by the global rate.
    for (const s of sgdSavings) {
      const accountRate = s.interest_rate != null ? Number(s.interest_rate) / 100 : investmentGrowthRate;
      const growth = (savValues[s.id] || 0) * accountRate;
      savValues[s.id] += growth;
      yearInvestGrowth += growth;
      if (growth > 0) {
        inflowItems.push({
          label: `${s.institution ?? "Savings"} growth`,
          amount: growth,
          href: `/savings#record-${s.id}`,
          timesPerYear: 1,
        });
      }
    }

    // FD / savings maturities — informational marker only.
    // The balance is already inside savValues and compounding there,
    // so it must NOT also be added to annualIn (that would double-count it).
    for (const s of sgdSavings) {
      if (!s.maturity_date) continue;
      const matYear = new Date(s.maturity_date).getFullYear();
      if (matYear === y && s.balance) {
        const bal = Number(s.balance);
        events.push(`${s.institution ?? "FD"} matures (${fmt(bal)} becomes available)`);
      }
    }

    // Planned one-off events
    for (const ev of plannedEvents as any[]) {
      if (Number(ev.year) === y) {
        const amt = Number(ev.amount);
        if (ev.type === "inflow") {
          annualIn += amt;
          inflowItems.push({ label: ev.label, amount: amt, timesPerYear: 1 });
          events.push(`${ev.label} +${fmt(amt)}`);
        } else {
          annualOut += amt;
          outflowItems.push({ label: ev.label, amount: amt, timesPerYear: 1 });
          events.push(`${ev.label} −${fmt(amt)}`);
        }
      }
    }

    // Retirement marker
    if (retirementYear !== null && y === retirementYear) {
      events.push("Retirement — salary ends");
    }

    // Investment growth feeds into annualIn so net worth maths stays consistent
    annualIn += yearInvestGrowth;

    // Cash flow net (excludes property appreciation; includes investment/savings growth)
    const annualNet = annualIn - annualOut;

    // Net worth: cash flow (which now includes investment growth) + property appreciation
    runningNetWorth += annualNet + yearPropertyAppreciation;

    // Dev-time sanity check: itemized lists must sum to the same totals
    // used for netWorth. If this ever warns, an item was missed or
    // double-counted during a future edit to this loop.
    if (import.meta.env.DEV) {
      const inSum = inflowItems.reduce((s, it) => s + it.amount, 0);
      const outSum = outflowItems.reduce((s, it) => s + it.amount, 0);
      if (Math.abs(inSum - annualIn) > 1) {
        console.warn(`LifetimeChart: inflowItems sum (${inSum}) != annualIn (${annualIn}) for year ${y}`);
      }
      if (Math.abs(outSum - annualOut) > 1) {
        console.warn(`LifetimeChart: outflowItems sum (${outSum}) != annualOut (${annualOut}) for year ${y}`);
      }
    }

    years.push({
      year: y,
      netWorth: Math.round(runningNetWorth),
      annualNet: Math.round(annualNet),
      annualIn: Math.round(annualIn),
      annualOut: Math.round(annualOut),
      inflowItems: inflowItems.map((it) => ({ ...it, amount: Math.round(it.amount) })),
      outflowItems: outflowItems.map((it) => ({ ...it, amount: Math.round(it.amount) })),
      propAppreciation: Math.round(yearPropertyAppreciation),
      investGrowth: Math.round(yearInvestGrowth),
      events,
    });
  }

  return years;
}
