// Pure math for the FA policy-chart tool (client-illustration feature).
// Deliberately product-agnostic: every SG insurance product type (term,
// whole life, endowment, ILP, annuity/retirement income) reduces to an
// ordered list of pay-in/pay-out "phases" over the insured's age — see
// areas/advisor-dashboard.md for the research this is based on. Nothing
// here special-cases a product type; the FA can represent any of them
// with the same phase shape.

export type ChartPhaseFrequency = "monthly" | "annual" | "lump-sum";
export type ChartPhaseDirection = "in" | "out";

export type ChartPhase = {
  id: string;
  label: string;
  direction: ChartPhaseDirection;
  startAge: number;
  endAge: number; // equal to startAge for a lump-sum point
  amount: number; // per-occurrence — annualized inside expandPhasesToYearlyBars for "monthly"
  frequency: ChartPhaseFrequency;
};

export type YearlyBar = { age: number; in: number; out: number };

// Expands phases into one bar per age, from the earliest startAge to the
// latest relevant age across all phases (inclusive). A lump-sum phase
// contributes its full amount at startAge only, ignoring endAge. A
// monthly phase's per-year total is amount * 12. Phases that overlap the
// same age and direction sum together (e.g. two riders both paying out
// at the same age). Returns [] for an empty phase list — callers should
// treat that as "nothing to chart yet", not an error.
export function expandPhasesToYearlyBars(phases: ChartPhase[]): YearlyBar[] {
  if (phases.length === 0) return [];
  const minAge = Math.min(...phases.map((p) => p.startAge));
  const maxAge = Math.max(
    ...phases.map((p) => (p.frequency === "lump-sum" ? p.startAge : p.endAge)),
  );
  const bars: YearlyBar[] = [];
  for (let age = minAge; age <= maxAge; age++) {
    let inAmt = 0;
    let outAmt = 0;
    for (const p of phases) {
      const perYear = p.frequency === "monthly" ? p.amount * 12 : p.amount;
      const applies =
        p.frequency === "lump-sum" ? age === p.startAge : age >= p.startAge && age <= p.endAge;
      if (!applies) continue;
      if (p.direction === "in") inAmt += perYear;
      else outAmt += perYear;
    }
    bars.push({ age, in: inAmt, out: outAmt });
  }
  return bars;
}

// Builds a starting set of phases from a policy's existing fields plus
// the insured member's birth_year, so the FA isn't starting from a blank
// slate for the already-modeled two-phase case (premium period +
// recurring payout, or premium period + single surrender-value maturity
// point when there's no recurring payout). Returns [] when there isn't
// enough data (no birth year, or neither a premium nor a payout/
// surrender figure) — the FA then starts from a blank chart, which is a
// fine fallback, not an error state.
export function buildDefaultPhases(
  policy: {
    premium: number | null;
    frequency: string | null;
    start_date: string | null;
    end_date: string | null;
    payout_amount: number | null;
    payout_frequency: string | null;
    payout_start_date: string | null;
    payout_end_date: string | null;
    surrender_value: number | null;
    surrender_value_date: string | null;
  },
  birthYear: number | null,
): ChartPhase[] {
  if (birthYear == null) return [];
  const ageOf = (dateStr: string | null): number | null => {
    if (!dateStr) return null;
    const year = new Date(dateStr).getFullYear();
    if (Number.isNaN(year)) return null;
    const age = year - birthYear;
    // Defensively clamp — a bad upstream date (e.g. a policy's end_date
    // typo'd as a far-future year) must never silently produce an
    // out-of-range default the chart schema then rejects at save time
    // with a cryptic raw validation error. The FA can still edit the
    // clamped value if 120 genuinely isn't right for their case.
    if (age < 0) return 0;
    if (age > 120) return 120;
    return age;
  };
  const phases: ChartPhase[] = [];

  const premiumStartAge = ageOf(policy.start_date);
  if (policy.premium != null && premiumStartAge != null) {
    phases.push({
      id: "default-premium",
      label: "Premium",
      direction: "in",
      startAge: premiumStartAge,
      endAge: ageOf(policy.end_date) ?? premiumStartAge,
      amount: policy.premium,
      frequency: policy.frequency === "monthly" ? "monthly" : "annual",
    });
  }

  const payoutStartAge = ageOf(policy.payout_start_date);
  if (policy.payout_amount != null && payoutStartAge != null) {
    phases.push({
      id: "default-payout",
      label: "Payout",
      direction: "out",
      startAge: payoutStartAge,
      endAge: ageOf(policy.payout_end_date) ?? payoutStartAge,
      amount: policy.payout_amount,
      frequency: policy.payout_frequency === "monthly" ? "monthly" : "annual",
    });
  } else {
    // No recurring payout modeled on this policy — fall back to the
    // surrender value as a single lump-sum maturity point, when there's
    // a vesting date to place it at.
    const surrenderAge = ageOf(policy.surrender_value_date);
    if (policy.surrender_value != null && surrenderAge != null) {
      phases.push({
        id: "default-surrender",
        label: "Surrender value",
        direction: "out",
        startAge: surrenderAge,
        endAge: surrenderAge,
        amount: policy.surrender_value,
        frequency: "lump-sum",
      });
    }
  }

  return phases;
}
