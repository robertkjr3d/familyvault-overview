import { describe, it, expect } from "vitest";
import { linkedPropertyIds, unlinkedMortgageProperties } from "./netWorthMath";
import { groupByCurrency, totalWithFx } from "./format";

const fx = { rateDate: "2026-09-28", rates: { USD: 0.75 } } as never;

describe("unlinkedMortgageProperties", () => {
  it("includes a property whose mortgage is only on the Property tab", () => {
    const props = [{ id: "a", mortgage_balance: 800_000, currency: "SGD" }];
    expect(unlinkedMortgageProperties(props, [])).toHaveLength(1);
  });
  it("excludes a property that has a linked Loans-tab row (counted once, via the loan)", () => {
    const props = [{ id: "b", mortgage_balance: 400_000 }];
    expect(unlinkedMortgageProperties(props, [{ property_id: "b" }])).toHaveLength(0);
  });
  it("ignores properties with no, zero or blank mortgage balance", () => {
    const props = [
      { id: "c", mortgage_balance: null },
      { id: "d", mortgage_balance: 0 },
      { id: "e" },
    ];
    expect(unlinkedMortgageProperties(props, [])).toHaveLength(0);
  });
  it("an unrelated loan does not hide a property's own mortgage", () => {
    const props = [{ id: "f", mortgage_balance: 100_000 }];
    expect(unlinkedMortgageProperties(props, [{ property_id: null }, {}])).toHaveLength(1);
  });
  it("a linked loan still suppresses the double count when passed the full loans list", () => {
    const props = [{ id: "g", mortgage_balance: 250_000 }];
    const allLoans = [{ property_id: "g" }];
    expect(unlinkedMortgageProperties(props, allLoans)).toHaveLength(0);
  });
  it("linkedPropertyIds collects only real links", () => {
    expect([...linkedPropertyIds([{ property_id: "x" }, { property_id: null }, {}])]).toEqual([
      "x",
    ]);
  });
  it("end to end: SGD + USD mortgages convert and add up once", () => {
    const props = [
      { id: "a", mortgage_balance: 800_000, currency: "SGD" },
      { id: "b", mortgage_balance: 400_000, currency: "SGD" }, // linked -> excluded
      { id: "d", mortgage_balance: 200_000, currency: "USD" },
    ];
    const list = unlinkedMortgageProperties(props, [{ property_id: "b" }]);
    const total = totalWithFx(
      groupByCurrency(list, (p) => p.mortgage_balance),
      fx,
    );
    // rates are foreign units per 1 SGD (see format.ts), so USD is divided by the rate
    expect(total).toBeCloseTo(800_000 + 200_000 / 0.75, 2);
  });
});
