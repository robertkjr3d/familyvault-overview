import { describe, it, expect } from "vitest";
import { expandPhasesToYearlyBars, buildDefaultPhases, type ChartPhase } from "./policyChartMath";

describe("expandPhasesToYearlyBars", () => {
  it("returns [] for no phases", () => {
    expect(expandPhasesToYearlyBars([])).toEqual([]);
  });

  it("expands a simple 3-year annual premium phase into 3 bars", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Premium",
        direction: "in",
        startAge: 30,
        endAge: 32,
        amount: 100000,
        frequency: "annual",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars).toEqual([
      { age: 30, in: 100000, out: 0 },
      { age: 31, in: 100000, out: 0 },
      { age: 32, in: 100000, out: 0 },
    ]);
  });

  it("annualizes a monthly phase (amount * 12)", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Income",
        direction: "out",
        startAge: 65,
        endAge: 66,
        amount: 500,
        frequency: "monthly",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars).toEqual([
      { age: 65, in: 0, out: 6000 },
      { age: 66, in: 0, out: 6000 },
    ]);
  });

  it("places a lump-sum phase only at its startAge, ignoring endAge", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Maturity",
        direction: "out",
        startAge: 40,
        endAge: 40,
        amount: 300000,
        frequency: "lump-sum",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars).toEqual([{ age: 40, in: 0, out: 300000 }]);
  });

  it("sums overlapping phases at the same age", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Base plan",
        direction: "out",
        startAge: 65,
        endAge: 70,
        amount: 1000,
        frequency: "annual",
      },
      {
        id: "2",
        label: "Rider",
        direction: "out",
        startAge: 65,
        endAge: 70,
        amount: 500,
        frequency: "annual",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars[0]).toEqual({ age: 65, in: 0, out: 1500 });
  });

  it("matches the user's own worked example — 3 years pay 100k, then 6k/year payout starting the same year cover ends", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Premium",
        direction: "in",
        startAge: 30,
        endAge: 32,
        amount: 100000,
        frequency: "annual",
      },
      {
        id: "2",
        label: "Payout",
        direction: "out",
        startAge: 33,
        endAge: 80,
        amount: 6000,
        frequency: "annual",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars).toHaveLength(80 - 30 + 1);
    expect(bars.filter((b) => b.in > 0)).toHaveLength(3);
    expect(bars.filter((b) => b.out > 0)).toHaveLength(80 - 33 + 1);
    expect(bars.find((b) => b.age === 33)).toEqual({ age: 33, in: 0, out: 6000 });
  });

  it("keeps pay-in and pay-out separate even in the same age (no netting)", () => {
    const phases: ChartPhase[] = [
      {
        id: "1",
        label: "Top-up premium",
        direction: "in",
        startAge: 50,
        endAge: 50,
        amount: 10000,
        frequency: "lump-sum",
      },
      {
        id: "2",
        label: "Withdrawal",
        direction: "out",
        startAge: 50,
        endAge: 50,
        amount: 4000,
        frequency: "lump-sum",
      },
    ];
    const bars = expandPhasesToYearlyBars(phases);
    expect(bars).toEqual([{ age: 50, in: 10000, out: 4000 }]);
  });
});

describe("buildDefaultPhases", () => {
  const basePolicy = {
    premium: null as number | null,
    frequency: null as string | null,
    start_date: null as string | null,
    end_date: null as string | null,
    payout_amount: null as number | null,
    payout_frequency: null as string | null,
    payout_start_date: null as string | null,
    payout_end_date: null as string | null,
    surrender_value: null as number | null,
    surrender_value_date: null as string | null,
  };

  it("returns [] when birthYear is null, regardless of policy data", () => {
    expect(
      buildDefaultPhases({ ...basePolicy, premium: 5000, start_date: "2024-01-01" }, null),
    ).toEqual([]);
  });

  it("returns [] when there's a birth year but no premium/payout/surrender data at all", () => {
    expect(buildDefaultPhases(basePolicy, 1990)).toEqual([]);
  });

  it("builds only a premium phase when there's no payout or surrender value", () => {
    const phases = buildDefaultPhases(
      {
        ...basePolicy,
        premium: 5000,
        frequency: "annual",
        start_date: "2024-01-01",
        end_date: "2026-01-01",
      },
      1990,
    );
    expect(phases).toEqual([
      {
        id: "default-premium",
        label: "Premium",
        direction: "in",
        startAge: 34,
        endAge: 36,
        amount: 5000,
        frequency: "annual",
      },
    ]);
  });

  it("builds premium + recurring payout phases (the annuity/retirement-income shape)", () => {
    const phases = buildDefaultPhases(
      {
        ...basePolicy,
        premium: 100000,
        frequency: "annual",
        start_date: "2020-01-01",
        end_date: "2022-01-01",
        payout_amount: 6000,
        payout_frequency: "annual",
        payout_start_date: "2023-01-01",
        payout_end_date: "2073-01-01",
      },
      1990,
    );
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({ direction: "in", startAge: 30, endAge: 32, amount: 100000 });
    expect(phases[1]).toMatchObject({ direction: "out", startAge: 33, endAge: 83, amount: 6000 });
  });

  it("falls back to a lump-sum surrender-value phase when there's no recurring payout (the endowment shape)", () => {
    const phases = buildDefaultPhases(
      {
        ...basePolicy,
        premium: 5000,
        frequency: "annual",
        start_date: "2024-01-01",
        end_date: "2034-01-01",
        surrender_value: 60000,
        surrender_value_date: "2034-06-01",
      },
      1990,
    );
    expect(phases).toHaveLength(2);
    expect(phases[1]).toEqual({
      id: "default-surrender",
      label: "Surrender value",
      direction: "out",
      startAge: 44,
      endAge: 44,
      amount: 60000,
      frequency: "lump-sum",
    });
  });

  it("prefers recurring payout over surrender value when both are present (payout is the more specific signal)", () => {
    const phases = buildDefaultPhases(
      {
        ...basePolicy,
        payout_amount: 6000,
        payout_frequency: "annual",
        payout_start_date: "2030-01-01",
        payout_end_date: "2060-01-01",
        surrender_value: 60000,
        surrender_value_date: "2030-01-01",
      },
      1990,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0].label).toBe("Payout");
  });

  it("clamps a wildly out-of-range end_date to 120 instead of producing an unsaveable phase (the user's own reported case: a policy end_date typo'd as year 2189)", () => {
    const phases = buildDefaultPhases(
      {
        ...basePolicy,
        premium: 5000,
        frequency: "annual",
        start_date: "2024-01-01",
        end_date: "2189-01-01",
      },
      1990,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0].endAge).toBe(120);
    expect(phases[0].endAge).toBeLessThanOrEqual(120);
  });

  it("clamps a start_date before birth (bad data) to age 0 rather than a negative age", () => {
    const phases = buildDefaultPhases(
      { ...basePolicy, premium: 5000, frequency: "annual", start_date: "1985-01-01" },
      1990,
    );
    expect(phases[0].startAge).toBe(0);
  });
});
