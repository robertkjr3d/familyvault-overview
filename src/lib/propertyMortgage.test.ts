import { describe, expect, it } from "vitest";
import {
  amountInCurrency,
  loanPaymentOf,
  loansLinkedTo,
  mortgageTotals,
  type LinkedLoan,
} from "./propertyMortgage";
import { monthlyPayment } from "./loanMath";

const fx = { rateDate: "2026-10-03", rates: { USD: 0.5, GBP: 0.4 } };

const loan = (o: Partial<LinkedLoan>): LinkedLoan => ({ id: "l1", property_id: "p1", ...o });

describe("loansLinkedTo", () => {
  it("returns only the loans linked to that property", () => {
    const loans = [
      loan({ id: "a" }),
      loan({ id: "b", property_id: "p2" }),
      loan({ id: "c", property_id: null }),
    ];
    expect(loansLinkedTo("p1", loans).map((l) => l.id)).toEqual(["a"]);
    expect(loansLinkedTo("p9", loans)).toEqual([]);
  });
  it("returns every loan when a property has more than one", () => {
    const loans = [loan({ id: "a" }), loan({ id: "b" })];
    expect(loansLinkedTo("p1", loans)).toHaveLength(2);
  });
});

describe("loanPaymentOf", () => {
  it("uses the typed-in payment", () => {
    expect(loanPaymentOf(loan({ monthly_payment: 3359 }))).toBe(3359);
  });
  it("falls back to the estimate when the payment is blank (same rule as the Loans card)", () => {
    const l = loan({ monthly_payment: null, original_amount: 900000, term_years: 25, rate: 2.5 });
    expect(loanPaymentOf(l)).toBeCloseTo(monthlyPayment(900000, 2.5, 25), 6);
  });
  it("is 0 when there is nothing to work from", () => {
    expect(loanPaymentOf(loan({}))).toBe(0);
  });
});

describe("amountInCurrency", () => {
  it("returns the amount unchanged for the same currency, even with no rates", () => {
    expect(amountInCurrency(100, "GBP", "GBP", null)).toBe(100);
  });
  it("converts foreign to SGD and SGD to foreign", () => {
    expect(amountInCurrency(50, "USD", "SGD", fx)).toBe(100);
    expect(amountInCurrency(100, "SGD", "USD", fx)).toBe(50);
  });
  it("converts between two foreign currencies through SGD", () => {
    expect(amountInCurrency(50, "USD", "GBP", fx)).toBeCloseTo(40, 6);
  });
  it("returns null, not a guess, when a rate is missing", () => {
    expect(amountInCurrency(100, "JPY", "SGD", fx)).toBeNull();
    expect(amountInCurrency(100, "SGD", "JPY", fx)).toBeNull();
    expect(amountInCurrency(100, "USD", "SGD", null)).toBeNull();
  });
});

describe("mortgageTotals", () => {
  it("is empty for a property with no linked loans", () => {
    expect(mortgageTotals("SGD", [], fx)).toEqual({
      owed: 0,
      payment: 0,
      hasLoans: false,
      unconverted: false,
    });
  });
  it("adds up several loans in the property's currency", () => {
    const t = mortgageTotals(
      "SGD",
      [
        loan({ id: "a", balance: 900000, monthly_payment: 3359 }),
        loan({ id: "b", balance: 100000, monthly_payment: 500 }),
      ],
      fx,
    );
    expect(t.owed).toBe(1000000);
    expect(t.payment).toBe(3859);
    expect(t.hasLoans).toBe(true);
    expect(t.unconverted).toBe(false);
  });
  it("treats a missing property currency as SGD and a missing loan currency as SGD", () => {
    const t = mortgageTotals(
      undefined,
      [loan({ currency: null, balance: 10, monthly_payment: 1 })],
      fx,
    );
    expect(t.owed).toBe(10);
  });
  it("converts a loan in another currency into the property's currency", () => {
    const t = mortgageTotals(
      "SGD",
      [loan({ currency: "USD", balance: 50, monthly_payment: 5 })],
      fx,
    );
    expect(t.owed).toBe(100);
    expect(t.payment).toBe(10);
  });
  it("leaves out a loan it cannot convert, and says so", () => {
    const t = mortgageTotals(
      "SGD",
      [
        loan({ id: "a", balance: 100, monthly_payment: 1 }),
        loan({ id: "b", currency: "JPY", balance: 999, monthly_payment: 9 }),
      ],
      fx,
    );
    expect(t.owed).toBe(100);
    expect(t.payment).toBe(1);
    expect(t.unconverted).toBe(true);
    expect(t.hasLoans).toBe(true);
  });
  it("ignores a blank balance instead of producing NaN", () => {
    const t = mortgageTotals("SGD", [loan({ balance: null, monthly_payment: 1000 })], fx);
    expect(t.owed).toBe(0);
    expect(t.payment).toBe(1000);
  });
});
