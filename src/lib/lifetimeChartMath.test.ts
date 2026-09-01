import { describe, it, expect } from "vitest";
import {
  freqTimesPerYear,
  fmt,
  computeCashflowDomain,
  insuranceAnnual,
  investmentPremiumAnnual,
  propertyTotalCosts,
  insuranceMonthly,
  investmentPremiumMonthly,
  insurancePayoutMonthly,
  investmentPayoutMonthly,
  isSurrenderValueVested,
  projectLifetimeChart,
  type LifetimeProjectionInput,
} from "./lifetimeChartMath";

// Fixed reference date for all tests that need "today" — keeps tests
// deterministic regardless of when they actually run.
const TODAY = new Date("2026-06-22T00:00:00Z");

// ─── freqTimesPerYear ────────────────────────────────────────────────────────

describe("freqTimesPerYear", () => {
  it("maps monthly to 12", () => {
    expect(freqTimesPerYear("monthly")).toBe(12);
  });

  it("maps quarterly to 4", () => {
    expect(freqTimesPerYear("quarterly")).toBe(4);
  });

  it("maps semi-annual and half-yearly variants to 2", () => {
    expect(freqTimesPerYear("semi-annual")).toBe(2);
    expect(freqTimesPerYear("half-yearly")).toBe(2);
  });

  it("maps annual to 1", () => {
    expect(freqTimesPerYear("annual")).toBe(1);
  });

  it("treats one-off, unrecognised, or missing frequency as 1x (a single occurrence this year)", () => {
    expect(freqTimesPerYear("one-off")).toBe(1);
    expect(freqTimesPerYear(null)).toBe(1);
    expect(freqTimesPerYear(undefined)).toBe(1);
    expect(freqTimesPerYear("")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(freqTimesPerYear("MONTHLY")).toBe(12);
    expect(freqTimesPerYear("Quarterly")).toBe(4);
  });
});

// ─── fmt ─────────────────────────────────────────────────────────────────────

describe("fmt", () => {
  it("formats values under $1k as whole dollars", () => {
    expect(fmt(0)).toBe("$0");
    expect(fmt(500)).toBe("$500");
    expect(fmt(999)).toBe("$999");
  });

  it("formats values in the thousands with k suffix", () => {
    expect(fmt(1000)).toBe("$1k");
    expect(fmt(50000)).toBe("$50k");
    expect(fmt(999999)).toBe("$1000k");
  });

  it("formats millions with 1dp M suffix", () => {
    expect(fmt(1_000_000)).toBe("$1.0M");
    expect(fmt(1_500_000)).toBe("$1.5M");
  });

  it("preserves negative sign", () => {
    expect(fmt(-500)).toBe("-$500");
    expect(fmt(-50000)).toBe("-$50k");
    expect(fmt(-2_000_000)).toBe("-$2.0M");
  });
});

// ─── insuranceAnnual ─────────────────────────────────────────────────────────

describe("insuranceAnnual", () => {
  it("annualises a monthly premium correctly", () => {
    expect(insuranceAnnual({ premium: 100, frequency: "monthly" })).toBe(1200);
  });

  it("annualises a quarterly premium correctly", () => {
    expect(insuranceAnnual({ premium: 300, frequency: "quarterly" })).toBe(1200);
  });

  it("annualises a semi-annual premium correctly", () => {
    expect(insuranceAnnual({ premium: 600, frequency: "semi-annual" })).toBe(1200);
    expect(insuranceAnnual({ premium: 600, frequency: "half-yearly" })).toBe(1200);
  });

  it("returns the premium as-is for annual frequency", () => {
    expect(insuranceAnnual({ premium: 1200, frequency: "annual" })).toBe(1200);
  });

  it("returns 0 for one-off and single (no recurring premium)", () => {
    expect(insuranceAnnual({ premium: 5000, frequency: "one-off" })).toBe(0);
    expect(insuranceAnnual({ premium: 5000, frequency: "single" })).toBe(0);
  });

  it("defaults to annual when frequency is missing", () => {
    expect(insuranceAnnual({ premium: 1200 })).toBe(1200);
    expect(insuranceAnnual({ premium: 1200, frequency: null })).toBe(1200);
  });

  it("treats a zero or missing premium as zero regardless of frequency", () => {
    expect(insuranceAnnual({ premium: 0, frequency: "monthly" })).toBe(0);
    expect(insuranceAnnual({ frequency: "monthly" })).toBe(0);
  });
});

// ─── investmentPremiumAnnual ─────────────────────────────────────────────────

describe("investmentPremiumAnnual", () => {
  it("annualises a monthly ILP premium correctly", () => {
    expect(investmentPremiumAnnual({ premium_amount: 500, premium_frequency: "monthly" })).toBe(
      6000,
    );
  });

  it("annualises a quarterly ILP premium correctly", () => {
    expect(investmentPremiumAnnual({ premium_amount: 1500, premium_frequency: "quarterly" })).toBe(
      6000,
    );
  });

  it("annualises a semi-annual ILP premium correctly", () => {
    expect(
      investmentPremiumAnnual({ premium_amount: 3000, premium_frequency: "semi-annual" }),
    ).toBe(6000);
  });

  it("returns the premium_amount as-is for annual frequency", () => {
    expect(investmentPremiumAnnual({ premium_amount: 6000, premium_frequency: "annual" })).toBe(
      6000,
    );
  });

  it("returns 0 for one-off ILP (single premium)", () => {
    expect(investmentPremiumAnnual({ premium_amount: 10000, premium_frequency: "one-off" })).toBe(
      0,
    );
    expect(investmentPremiumAnnual({ premium_amount: 10000, premium_frequency: "single" })).toBe(0);
  });

  it("defaults to annual when premium_frequency is missing", () => {
    expect(investmentPremiumAnnual({ premium_amount: 6000 })).toBe(6000);
  });
});

// ─── propertyTotalCosts ──────────────────────────────────────────────────────

describe("propertyTotalCosts", () => {
  it("sums all five itemised cost fields when present", () => {
    const p = {
      cost_management: 200,
      cost_property_tax: 100,
      cost_fire_insurance: 50,
      cost_maintenance: 150,
      cost_other: 75,
    };
    expect(propertyTotalCosts(p)).toBe(575);
  });

  it("falls back to monthly_costs when no itemised fields are present", () => {
    expect(propertyTotalCosts({ monthly_costs: 800 })).toBe(800);
  });

  it("prefers itemised total over monthly_costs even when itemised total is lower", () => {
    const p = {
      cost_management: 100,
      monthly_costs: 999,
    };
    expect(propertyTotalCosts(p)).toBe(100);
  });

  it("ignores null/undefined/missing itemised fields (treats as 0)", () => {
    expect(propertyTotalCosts({ cost_management: 200, cost_property_tax: null })).toBe(200);
  });

  it("returns 0 when no fields are present at all", () => {
    expect(propertyTotalCosts({})).toBe(0);
  });
});

// ─── projectLifetimeChart ────────────────────────────────────────────────────

/** Minimal valid input — tests override only what they care about. */
const base: LifetimeProjectionInput = {
  properties: [],
  loans: [],
  insurance: [],
  sgdSavings: [],
  sgdInvestments: [],
  plannedEvents: [],
  startingNetWorth: 0,
  monthlyIncome: 0,
  monthlyExpenses: 0,
  startYear: 2030,
  // Jan 1 of startYear — internally consistent with this fixture's own
  // startYear (2030), not the unrelated TODAY constant above (2026, used by
  // other tests in this file for a different purpose).
  today: new Date("2030-01-01T00:00:00Z"),
  horizonYears: 3,
  retirementYear: null,
  cpfStartYear: null,
  cpfMonthlyPayout: 0,
  investmentGrowthRate: 0,
  propertyAppreciationRate: 0,
  inflationRate: 0,
};

describe("projectLifetimeChart", () => {
  // ── Output shape ──────────────────────────────────────────────────────────

  it("returns one ChartPoint per year in the horizon, starting at startYear", () => {
    const result = projectLifetimeChart({ ...base, horizonYears: 5 });
    expect(result).toHaveLength(5);
    expect(result.map((d) => d.year)).toEqual([2030, 2031, 2032, 2033, 2034]);
  });

  it("returns 0 net worth when there is no income, no expenses, and no starting NW", () => {
    const result = projectLifetimeChart(base);
    result.forEach((d) => expect(d.netWorth).toBe(0));
  });

  // ── Starting net worth ────────────────────────────────────────────────────

  it("preserves startingNetWorth as a baseline when cash flow is zero", () => {
    const result = projectLifetimeChart({ ...base, startingNetWorth: 500_000 });
    result.forEach((d) => expect(d.netWorth).toBe(500_000));
  });

  // ── Salary and cash flow ──────────────────────────────────────────────────

  it("accumulates salary income correctly across years", () => {
    // $10k/month = $120k/year. After 3 years: $360k.
    const result = projectLifetimeChart({ ...base, monthlyIncome: 10_000 });
    expect(result[0].netWorth).toBe(120_000);
    expect(result[1].netWorth).toBe(240_000);
    expect(result[2].netWorth).toBe(360_000);
  });

  it("each year's annualIn equals monthlyIncome * 12 with no other income", () => {
    const result = projectLifetimeChart({ ...base, monthlyIncome: 5_000 });
    result.forEach((d) => expect(d.annualIn).toBe(60_000));
  });

  it("deducts living expenses from net worth each year", () => {
    // $5k expenses/month, zero income → net worth goes negative
    const result = projectLifetimeChart({ ...base, monthlyExpenses: 5_000 });
    expect(result[0].netWorth).toBe(-60_000);
    expect(result[1].netWorth).toBe(-120_000);
  });

  it("annualNet equals annualIn minus annualOut for every year", () => {
    const result = projectLifetimeChart({
      ...base,
      monthlyIncome: 8_000,
      monthlyExpenses: 3_000,
    });
    result.forEach((d) => {
      expect(d.annualNet).toBe(d.annualIn - d.annualOut);
    });
  });

  // ── Retirement ───────────────────────────────────────────────────────────

  it("stops salary in the retirement year and all subsequent years", () => {
    // Horizon 2030-2032, retirement 2031. Only 2030 should have salary.
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      monthlyIncome: 10_000,
      retirementYear: 2031,
    });
    // Year 2030: salary active (y < retirementYear)
    expect(result[0].inflowItems.some((it) => it.label === "Salary income")).toBe(true);
    // Year 2031: retirement year — salary stops (y < retirementYear is false)
    expect(result[1].inflowItems.some((it) => it.label === "Salary income")).toBe(false);
    // Year 2032: salary still stopped
    expect(result[2].inflowItems.some((it) => it.label === "Salary income")).toBe(false);
  });

  it("adds a retirement marker event in the retirement year", () => {
    const result = projectLifetimeChart({
      ...base,
      monthlyIncome: 5_000,
      retirementYear: 2031,
    });
    const retYear = result.find((d) => d.year === 2031)!;
    expect(retYear.events.some((e) => e.label.includes("Retirement"))).toBe(true);
  });

  // ── CPF ──────────────────────────────────────────────────────────────────

  it("adds CPF payout income only from cpfStartYear onwards", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 4,
      cpfStartYear: 2032,
      cpfMonthlyPayout: 1_000,
    });
    // 2030, 2031: no CPF
    expect(result[0].annualIn).toBe(0);
    expect(result[1].annualIn).toBe(0);
    // 2032 onwards: CPF adds $12k/year
    expect(result[2].annualIn).toBe(12_000);
    expect(result[3].annualIn).toBe(12_000);
  });

  it("marks the CPF start year with an event label", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 4,
      cpfStartYear: 2031,
      cpfMonthlyPayout: 2_000,
    });
    const cpfYear = result.find((d) => d.year === 2031)!;
    expect(cpfYear.events.some((e) => e.label.includes("CPF LIFE begins"))).toBe(true);
  });

  // ── Inflation ─────────────────────────────────────────────────────────────

  it("inflates living expenses by the inflation rate each year", () => {
    const result = projectLifetimeChart({
      ...base,
      monthlyExpenses: 10_000,
      inflationRate: 0.02,
    });
    // Year 0 (i=0): 10_000 * 12 * 1.0^0 = 120_000
    expect(result[0].annualOut).toBeCloseTo(120_000, 0);
    // Year 1 (i=1): 10_000 * 12 * 1.02^1 = 122_400
    expect(result[1].annualOut).toBeCloseTo(122_400, 0);
    // Year 2 (i=2): 10_000 * 12 * 1.02^2 = 124_848
    expect(result[2].annualOut).toBeCloseTo(124_848, 0);
  });

  // ── Property ─────────────────────────────────────────────────────────────

  it("adds rental income to annualIn for properties with monthly_rent", () => {
    const result = projectLifetimeChart({
      ...base,
      properties: [{ id: "p1", name: "HDB", monthly_rent: 2_000, current_value: 0 }],
    });
    expect(result[0].annualIn).toBe(24_000);
  });

  it("applies property appreciation compounding each year", () => {
    // One property worth $1M, 5% appreciation/year, no income/expenses
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 2,
      startingNetWorth: 1_000_000,
      properties: [{ id: "p1", name: "Condo", current_value: 1_000_000 }],
      propertyAppreciationRate: 0.05,
    });
    // Year 1: appreciation = 1M * 5% = 50k → netWorth = 1_050_000
    expect(result[0].propAppreciation).toBe(50_000);
    expect(result[0].netWorth).toBe(1_050_000);
    // Year 2: appreciation = 1_050_000 * 5% = 52_500 → netWorth = 1_102_500
    expect(result[1].propAppreciation).toBe(52_500);
    expect(result[1].netWorth).toBe(1_102_500);
  });

  // ── Loans ────────────────────────────────────────────────────────────────

  it("deducts loan repayments until loan_end_date, then stops", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      loans: [{ id: "l1", bank: "DBS", monthly_payment: 2_000, loan_end_date: "2031-12-31" }],
    });
    // 2030 and 2031: loan active (y <= 2031) → $24k/year outflow
    expect(result[0].annualOut).toBe(24_000);
    expect(result[1].annualOut).toBe(24_000);
    // 2032: loan ended → no outflow
    expect(result[2].annualOut).toBe(0);
  });

  it("marks the year a loan is paid off with an event", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 2,
      loans: [{ id: "l1", bank: "OCBC", monthly_payment: 1_000, loan_end_date: "2031-06-01" }],
    });
    const payoffYear = result.find((d) => d.year === 2031)!;
    expect(payoffYear.events.some((e) => e.label.includes("paid off"))).toBe(true);
  });

  it("runs a loan indefinitely when loan_end_date is not set", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      loans: [{ id: "l1", bank: "DBS", monthly_payment: 1_000 }],
    });
    result.forEach((d) => expect(d.annualOut).toBe(12_000));
  });

  // ── Insurance premiums ───────────────────────────────────────────────────

  it("deducts insurance premium only within its active date range", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 4,
      insurance: [
        {
          id: "i1",
          name: "Term",
          premium: 3_000,
          frequency: "annual",
          start_date: "2031-01-01",
          end_date: "2032-12-31",
        },
      ],
    });
    // 2030: before start → no premium
    expect(result[0].annualOut).toBe(0);
    // 2031 and 2032: within range → $3k/year
    expect(result[1].annualOut).toBe(3_000);
    expect(result[2].annualOut).toBe(3_000);
    // 2033: after end → no premium
    expect(result[3].annualOut).toBe(0);
  });

  it("includes a monthly insurance premium at its annualised value", () => {
    const result = projectLifetimeChart({
      ...base,
      insurance: [
        {
          id: "i1",
          name: "Medisave",
          premium: 200, // $200/month
          frequency: "monthly",
        },
      ],
    });
    // $200/month * 12 = $2,400/year
    expect(result[0].annualOut).toBe(2_400);
  });

  // ── Insurance recurring payout ────────────────────────────────────────────

  it("adds recurring annual insurance payout as income in the correct year range", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 4,
      insurance: [
        {
          id: "i1",
          name: "Annuity",
          payout_amount: 12_000,
          payout_frequency: "annual",
          payout_start_date: "2031-01-01",
          payout_end_date: "2032-12-31",
        },
      ],
    });
    expect(result[0].annualIn).toBe(0); // 2030: before payout
    expect(result[1].annualIn).toBe(12_000); // 2031: payout starts
    expect(result[2].annualIn).toBe(12_000); // 2032
    expect(result[3].annualIn).toBe(0); // 2033: after payout end
  });

  it("adds a one-off insurance payout only in the exact payout year", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      insurance: [
        {
          id: "i1",
          name: "Critical Illness",
          payout_amount: 100_000,
          payout_frequency: "one-off",
          payout_start_date: "2031-06-01",
        },
      ],
    });
    expect(result[0].annualIn).toBe(0); // 2030: not yet
    expect(result[1].annualIn).toBe(100_000); // 2031: one-off fires
    expect(result[2].annualIn).toBe(0); // 2032: gone
  });

  // ── Investment growth ─────────────────────────────────────────────────────

  it("compounds investment value at the given rate each year", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 2,
      sgdInvestments: [
        { id: "inv1", name: "Unit Trust", current_value: 100_000, group_name: "Unit Trusts" },
      ],
      investmentGrowthRate: 0.1,
    });
    // Year 1: growth = 100_000 * 10% = 10_000
    expect(result[0].investGrowth).toBe(10_000);
    // Year 2: growth = 110_000 * 10% = 11_000
    expect(result[1].investGrowth).toBe(11_000);
  });

  it("does not apply investment growth to ILP/Endowment (handled via premium/payout instead)", () => {
    const result = projectLifetimeChart({
      ...base,
      sgdInvestments: [
        {
          id: "ilp1",
          name: "AIA Elite",
          current_value: 100_000,
          group_name: "ILP (Investment-Linked Policy)",
        },
      ],
      investmentGrowthRate: 0.1,
    });
    // ILPs must NOT compound via investGrowth
    expect(result[0].investGrowth).toBe(0);
  });

  // ── Savings growth ────────────────────────────────────────────────────────

  it("uses each savings account's own interest_rate when set", () => {
    const result = projectLifetimeChart({
      ...base,
      sgdSavings: [{ id: "s1", institution: "DBS Multiplier", balance: 100_000, interest_rate: 3 }],
      investmentGrowthRate: 0.1, // should be ignored for this account
    });
    // 3% of 100_000 = 3_000
    expect(result[0].investGrowth).toBe(3_000);
  });

  it("respects a 0% savings interest rate — does not fall back to investmentGrowthRate", () => {
    // This was a real bug risk: using || instead of != null would silently
    // replace a deliberate 0% with the global rate.
    const result = projectLifetimeChart({
      ...base,
      sgdSavings: [{ id: "s1", institution: "Emergency Fund", balance: 50_000, interest_rate: 0 }],
      investmentGrowthRate: 0.1,
    });
    // 0% rate → no growth, regardless of investmentGrowthRate
    expect(result[0].investGrowth).toBe(0);
  });

  it("falls back to investmentGrowthRate when a savings account has no interest_rate set", () => {
    const result = projectLifetimeChart({
      ...base,
      sgdSavings: [{ id: "s1", institution: "POSB", balance: 100_000, interest_rate: null }],
      investmentGrowthRate: 0.05,
    });
    // 5% of 100_000 = 5_000
    expect(result[0].investGrowth).toBe(5_000);
  });

  // ── Planned events ────────────────────────────────────────────────────────

  it("adds a planned inflow event to annualIn in the correct year", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      plannedEvents: [{ year: 2031, type: "inflow", amount: 50_000, label: "Bonus" }],
    });
    expect(result[0].annualIn).toBe(0); // 2030
    expect(result[1].annualIn).toBe(50_000); // 2031
    expect(result[2].annualIn).toBe(0); // 2032
  });

  it("deducts a planned outflow event from annualIn in the correct year", () => {
    const result = projectLifetimeChart({
      ...base,
      horizonYears: 3,
      plannedEvents: [{ year: 2032, type: "outflow", amount: 30_000, label: "Car" }],
    });
    expect(result[0].annualOut).toBe(0); // 2030
    expect(result[1].annualOut).toBe(0); // 2031
    expect(result[2].annualOut).toBe(30_000); // 2032
  });

  it("marks a planned event year with an event label", () => {
    const result = projectLifetimeChart({
      ...base,
      plannedEvents: [{ year: 2030, type: "inflow", amount: 10_000, label: "Inheritance" }],
    });
    expect(result[0].events.some((e) => e.label.includes("Inheritance"))).toBe(true);
  });

  // ── Net worth accumulation ────────────────────────────────────────────────

  it("net worth accumulates correctly across multiple years with mixed income and expenses", () => {
    // $8k income, $3k expenses, no inflation, no growth → $5k net/month = $60k/year
    const result = projectLifetimeChart({
      ...base,
      monthlyIncome: 8_000,
      monthlyExpenses: 3_000,
      startingNetWorth: 100_000,
    });
    expect(result[0].netWorth).toBe(160_000);
    expect(result[1].netWorth).toBe(220_000);
    expect(result[2].netWorth).toBe(280_000);
  });

  it("correctly identifies a shortfall year when net worth turns negative", () => {
    // $5k expenses/month, zero income, $100k starting NW
    // Year 1: 100_000 - 60_000 = 40_000
    // Year 2: 40_000 - 60_000 = -20_000 → shortfall
    const result = projectLifetimeChart({
      ...base,
      monthlyExpenses: 5_000,
      startingNetWorth: 100_000,
      horizonYears: 3,
    });
    expect(result[0].netWorth).toBeGreaterThan(0);
    expect(result[1].netWorth).toBeLessThan(0);
  });

  // ── lineItem details ──────────────────────────────────────────────────────

  it("includes salary income in inflowItems with timesPerYear=12", () => {
    const result = projectLifetimeChart({ ...base, monthlyIncome: 5_000 });
    const salaryItem = result[0].inflowItems.find((it) => it.label === "Salary income");
    expect(salaryItem).toBeDefined();
    expect(salaryItem!.timesPerYear).toBe(12);
    expect(salaryItem!.amount).toBe(60_000);
  });

  it("includes living expenses in outflowItems with timesPerYear=12", () => {
    const result = projectLifetimeChart({ ...base, monthlyExpenses: 3_000 });
    const expItem = result[0].outflowItems.find((it) => it.label === "Living expenses");
    expect(expItem).toBeDefined();
    expect(expItem!.timesPerYear).toBe(12);
  });

  it("inflowItems sum matches annualIn for every year (no double-counting)", () => {
    // A complex scenario combining income, rental, insurance payout, savings growth
    const input: LifetimeProjectionInput = {
      ...base,
      monthlyIncome: 6_000,
      properties: [{ id: "p1", name: "HDB", monthly_rent: 1_000, current_value: 500_000 }],
      propertyAppreciationRate: 0.03,
      sgdSavings: [{ id: "s1", institution: "DBS", balance: 200_000, interest_rate: 2 }],
      insurance: [
        {
          id: "ins1",
          name: "Annuity",
          payout_amount: 6_000,
          payout_frequency: "annual",
          payout_start_date: "2030-01-01",
          payout_end_date: "2032-12-31",
        },
      ],
    };
    const result = projectLifetimeChart(input);
    result.forEach((d) => {
      const itemisedIn = d.inflowItems.reduce((s, it) => s + it.amount, 0);
      expect(Math.abs(itemisedIn - d.annualIn)).toBeLessThanOrEqual(1); // rounding tolerance
    });
  });

  it("outflowItems sum matches annualOut for every year (no double-counting)", () => {
    const input: LifetimeProjectionInput = {
      ...base,
      monthlyExpenses: 4_000,
      loans: [{ id: "l1", bank: "OCBC", monthly_payment: 1_500 }],
      insurance: [
        {
          id: "ins1",
          name: "Term Life",
          premium: 200,
          frequency: "monthly",
        },
      ],
      properties: [
        {
          id: "p1",
          name: "Condo",
          cost_management: 150,
          cost_maintenance: 100,
          current_value: 800_000,
        },
      ],
    };
    const result = projectLifetimeChart(input);
    result.forEach((d) => {
      const itemisedOut = d.outflowItems.reduce((s, it) => s + it.amount, 0);
      expect(Math.abs(itemisedOut - d.annualOut)).toBeLessThanOrEqual(1);
    });
  });
});

// ─── insuranceMonthly ─────────────────────────────────────────────────────────

describe("insuranceMonthly", () => {
  it("returns the premium as-is for monthly frequency", () => {
    expect(insuranceMonthly({ premium: 200, frequency: "monthly" })).toBe(200);
  });

  it("divides quarterly premium by 3", () => {
    expect(insuranceMonthly({ premium: 900, frequency: "quarterly" })).toBe(300);
  });

  it("divides semi-annual premium by 6", () => {
    expect(insuranceMonthly({ premium: 1200, frequency: "half-yearly" })).toBe(200);
    expect(insuranceMonthly({ premium: 1200, frequency: "semi-annual" })).toBe(200);
  });

  it("divides annual premium by 12", () => {
    expect(insuranceMonthly({ premium: 2400, frequency: "annual" })).toBe(200);
    expect(insuranceMonthly({ premium: 2400, frequency: "yearly" })).toBe(200);
  });

  it("returns 0 for one-off and single (no recurring cost)", () => {
    expect(insuranceMonthly({ premium: 5000, frequency: "one-off" })).toBe(0);
    expect(insuranceMonthly({ premium: 5000, frequency: "single" })).toBe(0);
  });

  it("defaults to dividing by 12 when frequency is missing or empty", () => {
    expect(insuranceMonthly({ premium: 1200, frequency: "" })).toBe(100);
    expect(insuranceMonthly({ premium: 1200 })).toBe(100);
  });
});

// ─── investmentPremiumMonthly ─────────────────────────────────────────────────

describe("investmentPremiumMonthly", () => {
  const ACTIVE_ILP = {
    group_name: "ILP (Investment-Linked Policy)",
    premium_amount: 600,
    premium_frequency: "monthly",
    premium_start_date: "2024-01-01",
  };

  it("returns monthly premium for an active ILP with monthly frequency", () => {
    expect(investmentPremiumMonthly(ACTIVE_ILP, TODAY)).toBe(600);
  });

  it("divides annual ILP premium by 12", () => {
    const inv = { ...ACTIVE_ILP, premium_amount: 7200, premium_frequency: "annual" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(600);
  });

  it("returns 0 for non-ILP/Endowment investments", () => {
    const inv = { ...ACTIVE_ILP, group_name: "Unit Trusts" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(0);
  });

  it("returns 0 when premium hasn't started yet", () => {
    const inv = { ...ACTIVE_ILP, premium_start_date: "2027-01-01" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(0);
  });

  it("returns 0 when premium period has already ended", () => {
    const inv = { ...ACTIVE_ILP, premium_end_date: "2025-12-31" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(0);
  });

  it("includes the premium in the end month itself (end date in the same month as today)", () => {
    // end_date of 2026-06-30 should still count for June 2026
    const inv = { ...ACTIVE_ILP, premium_end_date: "2026-06-30" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(600);
  });

  it("returns 0 for one-off ILP single premium", () => {
    const inv = { ...ACTIVE_ILP, premium_frequency: "one-off" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(0);
  });

  it("returns 0 when premium_amount is missing", () => {
    const inv = { ...ACTIVE_ILP, premium_amount: 0 };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(0);
  });

  it("also works for Endowment group_name", () => {
    const inv = { ...ACTIVE_ILP, group_name: "Endowment" };
    expect(investmentPremiumMonthly(inv, TODAY)).toBe(600);
  });
});

// ─── insurancePayoutMonthly ───────────────────────────────────────────────────

describe("insurancePayoutMonthly", () => {
  const ANNUAL_PAYOUT = {
    payout_amount: 12000,
    payout_frequency: "annual",
    payout_start_date: "2025-01-01",
  };

  it("returns monthly equivalent of an annual payout that is currently active", () => {
    expect(insurancePayoutMonthly(ANNUAL_PAYOUT, TODAY)).toBe(1000);
  });

  it("returns monthly amount for a monthly payout", () => {
    const ins = {
      payout_amount: 500,
      payout_frequency: "monthly",
      payout_start_date: "2025-01-01",
    };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(500);
  });

  it("divides quarterly payout by 3", () => {
    const ins = {
      payout_amount: 900,
      payout_frequency: "quarterly",
      payout_start_date: "2025-01-01",
    };
    expect(insurancePayoutMonthly(ins, TODAY)).toBeCloseTo(300, 1);
  });

  it("returns 0 when payout hasn't started yet", () => {
    const ins = { ...ANNUAL_PAYOUT, payout_start_date: "2027-01-01" };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(0);
  });

  it("returns 0 when recurring payout has ended", () => {
    const ins = { ...ANNUAL_PAYOUT, payout_end_date: "2025-12-31" };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(0);
  });

  it("counts a one-off payout only in its exact calendar month", () => {
    // June 2026 — same month as TODAY
    const ins = {
      payout_amount: 50000,
      payout_frequency: "one-off",
      payout_start_date: "2026-06-15",
    };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(50000);
  });

  it("returns 0 for a one-off payout in a different month", () => {
    const ins = {
      payout_amount: 50000,
      payout_frequency: "one-off",
      payout_start_date: "2026-05-01",
    };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(0);
  });

  it("treats empty payout_frequency string as one-off", () => {
    // payout_frequency: "" → isOneOff = true → only counts in exact month
    const ins = { payout_amount: 10000, payout_frequency: "", payout_start_date: "2026-06-01" };
    expect(insurancePayoutMonthly(ins, TODAY)).toBe(10000);
  });

  it("returns 0 when payout_amount is 0 or missing", () => {
    expect(
      insurancePayoutMonthly({ payout_amount: 0, payout_start_date: "2025-01-01" }, TODAY),
    ).toBe(0);
    expect(insurancePayoutMonthly({ payout_start_date: "2025-01-01" }, TODAY)).toBe(0);
  });

  it("returns 0 when payout_start_date is missing", () => {
    expect(insurancePayoutMonthly({ payout_amount: 5000, payout_frequency: "annual" }, TODAY)).toBe(
      0,
    );
  });
});

// ─── investmentPayoutMonthly ──────────────────────────────────────────────────

describe("investmentPayoutMonthly", () => {
  const ACTIVE_ILP_PAYOUT = {
    group_name: "ILP (Investment-Linked Policy)",
    payout_amount: 12000,
    payout_frequency: "annual",
    payout_start_date: "2025-01-01",
  };

  it("returns monthly equivalent of an active annual ILP payout", () => {
    expect(investmentPayoutMonthly(ACTIVE_ILP_PAYOUT, TODAY)).toBe(1000);
  });

  it("returns 0 for non-ILP/Endowment investments", () => {
    const inv = { ...ACTIVE_ILP_PAYOUT, group_name: "Unit Trusts" };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(0);
  });

  it("returns 0 when payout hasn't started yet", () => {
    const inv = { ...ACTIVE_ILP_PAYOUT, payout_start_date: "2028-01-01" };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(0);
  });

  it("returns 0 when payout has ended", () => {
    const inv = { ...ACTIVE_ILP_PAYOUT, payout_end_date: "2026-01-01" };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(0);
  });

  it("counts a one-off ILP payout only in the exact calendar month", () => {
    const inv = {
      ...ACTIVE_ILP_PAYOUT,
      payout_frequency: "one-off",
      payout_start_date: "2026-06-10",
    };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(12000);
  });

  it("returns 0 for a one-off ILP payout in a different month", () => {
    const inv = {
      ...ACTIVE_ILP_PAYOUT,
      payout_frequency: "one-off",
      payout_start_date: "2026-05-01",
    };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(0);
  });

  it("works for Endowment group_name", () => {
    const inv = { ...ACTIVE_ILP_PAYOUT, group_name: "Endowment" };
    expect(investmentPayoutMonthly(inv, TODAY)).toBe(1000);
  });
});

// ─── isSurrenderValueVested ────────────────────────────────────────────────
describe("isSurrenderValueVested", () => {
  it("returns true when no surrender_value_date is set (original, always-counted behaviour)", () => {
    expect(isSurrenderValueVested({ surrender_value: 300_000 }, TODAY)).toBe(true);
  });

  it("returns true when the date is in the past", () => {
    expect(isSurrenderValueVested({ surrender_value_date: "2020-01-01" }, TODAY)).toBe(true);
  });

  it("returns true when the date is exactly today", () => {
    expect(isSurrenderValueVested({ surrender_value_date: "2026-06-22" }, TODAY)).toBe(true);
  });

  it("returns false when the date is in the future", () => {
    expect(isSurrenderValueVested({ surrender_value_date: "2030-01-01" }, TODAY)).toBe(false);
  });
});

// ─── projectLifetimeChart — surrender value vesting ────────────────────────
describe("projectLifetimeChart — surrender value vesting", () => {
  it("with no surrender_value_date, the value stays flat every year (unchanged existing behaviour)", () => {
    const input: LifetimeProjectionInput = {
      ...base,
      startingNetWorth: 300_000,
      insurance: [{ id: "ins1", name: "Endowment", surrender_value: 300_000 }],
    };
    const result = projectLifetimeChart(input);
    result.forEach((d) => expect(d.netWorth).toBe(300_000));
    result.forEach((d) =>
      expect(d.inflowItems.some((it) => it.label.includes("surrender value"))).toBe(false),
    );
  });

  it("injects a one-time step-up in the exact year a future surrender_value_date falls, not before", () => {
    // startYear 2030, vests 2031 — must NOT be in startingNetWorth (caller's job,
    // simulated here by leaving it out), and must appear exactly once, in 2031.
    const input: LifetimeProjectionInput = {
      ...base,
      startingNetWorth: 0,
      horizonYears: 3,
      insurance: [
        {
          id: "ins1",
          name: "Endowment",
          surrender_value: 300_000,
          surrender_value_date: "2031-06-01",
        },
      ],
    };
    const result = projectLifetimeChart(input);
    const y2030 = result.find((d) => d.year === 2030)!;
    const y2031 = result.find((d) => d.year === 2031)!;
    const y2032 = result.find((d) => d.year === 2032)!;
    expect(y2030.netWorth).toBe(0);
    expect(y2031.netWorth).toBe(300_000);
    expect(y2032.netWorth).toBe(300_000); // stays flat after vesting, same as the no-date case
    expect(y2031.inflowItems.some((it) => it.label.includes("surrender value available"))).toBe(
      true,
    );
    expect(y2030.inflowItems.some((it) => it.label.includes("surrender value available"))).toBe(
      false,
    );
  });

  it("does not double-count when the policy vests later in the same calendar year as startYear (today mid-year, not yet vested)", () => {
    // today = 2030-01-01 (from base), vests 2030-06-01 — later the same year.
    // startingNetWorth must NOT include it yet (caller's job); the chart must
    // inject it exactly once, in startYear itself, not lose it forever.
    const input: LifetimeProjectionInput = {
      ...base,
      startingNetWorth: 0,
      insurance: [
        {
          id: "ins1",
          name: "Endowment",
          surrender_value: 300_000,
          surrender_value_date: "2030-06-01",
        },
      ],
    };
    const result = projectLifetimeChart(input);
    const y2030 = result.find((d) => d.year === 2030)!;
    expect(y2030.netWorth).toBe(300_000);
    expect(y2030.inflowItems.some((it) => it.label.includes("surrender value available"))).toBe(
      true,
    );
  });

  it("does not double-count when the policy already vested earlier in the same calendar year as startYear", () => {
    // today = 2030-01-01 per base's `today`, but override to mid-year so an
    // earlier-this-year vest date is genuinely in the past relative to "today".
    const input: LifetimeProjectionInput = {
      ...base,
      today: new Date("2030-06-15T00:00:00Z"),
      // Simulates the caller (routes/index.tsx) already having included it,
      // since isSurrenderValueVested(this policy, this today) is true.
      startingNetWorth: 300_000,
      insurance: [
        {
          id: "ins1",
          name: "Endowment",
          surrender_value: 300_000,
          surrender_value_date: "2030-01-10",
        },
      ],
    };
    const result = projectLifetimeChart(input);
    const y2030 = result.find((d) => d.year === 2030)!;
    // Must stay at 300k, not 600k — the step-up must NOT fire a second time.
    expect(y2030.netWorth).toBe(300_000);
    expect(y2030.inflowItems.some((it) => it.label.includes("surrender value available"))).toBe(
      false,
    );
  });

  it("ignores a surrender_value_date outside the projection horizon without erroring", () => {
    const input: LifetimeProjectionInput = {
      ...base,
      startingNetWorth: 0,
      horizonYears: 3, // covers 2030-2032
      insurance: [
        {
          id: "ins1",
          name: "Endowment",
          surrender_value: 300_000,
          surrender_value_date: "2050-01-01",
        },
      ],
    };
    const result = projectLifetimeChart(input);
    result.forEach((d) => expect(d.netWorth).toBe(0));
  });
});

describe("computeCashflowDomain", () => {
  it("gives a normal series real headroom above and below its actual range", () => {
    const { min, max } = computeCashflowDomain([10_000, -5_000, 20_000]);
    expect(min).toBeLessThan(-5_000);
    expect(max).toBeGreaterThan(20_000);
  });

  it("never collapses to a zero-height domain for an all-zero series — this is exactly the bug being guarded against: a flat $0-every-year cashflow (e.g. no income data entered) would previously have produced min === max, an invisible/invalid chart axis", () => {
    const { min, max } = computeCashflowDomain([0, 0, 0]);
    expect(max).toBeGreaterThan(min);
  });

  it("keeps zero inside the domain for an all-negative series, so the zero-line reference still renders correctly on this axis", () => {
    const { min, max } = computeCashflowDomain([-50_000, -80_000, -30_000]);
    expect(min).toBeLessThanOrEqual(-80_000);
    expect(max).toBeGreaterThanOrEqual(0);
  });

  it("keeps zero inside the domain for an all-positive series, symmetric to the all-negative case above", () => {
    const { min, max } = computeCashflowDomain([50_000, 80_000, 30_000]);
    expect(max).toBeGreaterThanOrEqual(80_000);
    expect(min).toBeLessThanOrEqual(0);
  });
});
