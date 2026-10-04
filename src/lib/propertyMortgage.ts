// A property's mortgage lives ONLY in the Loans tab (a loan linked to the
// property through loans.property_id). The Property card just displays the
// linked loans, using the helpers below, so there is one place to edit and
// the two screens can never disagree.

import { monthlyPayment } from "@/lib/loanMath";
import { convertToSgd, type FxRates } from "@/lib/format";

export type LinkedLoan = {
  id: string;
  property_id?: string | null;
  bank?: string | null;
  purpose?: string | null;
  member_id?: string | null;
  currency?: string | null;
  balance?: number | string | null;
  monthly_payment?: number | string | null;
  original_amount?: number | string | null;
  term_years?: number | string | null;
  rate?: number | string | null;
  rate_label?: string | null;
  reprice_date?: string | null;
  loan_end_date?: string | null;
};

/** Every loan linked to this property (a property can have more than one). */
export function loansLinkedTo<L extends { property_id?: string | null }>(
  propertyId: string,
  loans: L[],
): L[] {
  return loans.filter((l) => l.property_id === propertyId);
}

/**
 * The monthly payment shown for a loan: the amount typed in, otherwise the
 * estimate worked out from the loan terms. Same rule as the card on the Loans tab,
 * so both screens show the same number.
 */
export function loanPaymentOf(l: LinkedLoan): number {
  const typed = Number(l.monthly_payment) || 0;
  if (typed) return typed;
  const principal = Number(l.original_amount ?? l.balance ?? 0);
  const term = Number(l.term_years ?? 0);
  const rate = Number(l.rate ?? 0);
  return principal && term ? monthlyPayment(principal, rate, term) : 0;
}

/**
 * Converts an amount between two currencies using the cached daily rates
 * (rates are foreign units per 1 SGD). Returns null, never a guess, when a
 * needed rate is missing.
 */
export function amountInCurrency(
  amount: number,
  from: string,
  to: string,
  fx: FxRates | null | undefined,
): number | null {
  if (from === to) return amount;
  const sgd = convertToSgd(amount, from, fx);
  if (sgd == null) return null;
  if (to === "SGD") return sgd;
  const rate = fx?.rates[to];
  if (!rate || !isFinite(rate) || rate <= 0) return null;
  return sgd * rate;
}

export type MortgageTotals = {
  /** Total balance of the linked loans, in the property's currency. */
  owed: number;
  /** Total monthly payment of the linked loans, in the property's currency. */
  payment: number;
  hasLoans: boolean;
  /** True if a loan in another currency was left out because no rate is cached yet. */
  unconverted: boolean;
};

/** Adds up a property's linked loans in the property's own currency. */
export function mortgageTotals(
  propertyCurrency: string | null | undefined,
  linked: LinkedLoan[],
  fx: FxRates | null | undefined,
): MortgageTotals {
  const target = propertyCurrency || "SGD";
  let owed = 0;
  let payment = 0;
  let unconverted = false;
  for (const l of linked) {
    const cur = l.currency || "SGD";
    const bal = amountInCurrency(Number(l.balance) || 0, cur, target, fx);
    const pay = amountInCurrency(loanPaymentOf(l), cur, target, fx);
    if (bal == null || pay == null) {
      unconverted = true;
      continue;
    }
    owed += bal;
    payment += pay;
  }
  return { owed, payment, hasLoans: linked.length > 0, unconverted };
}
