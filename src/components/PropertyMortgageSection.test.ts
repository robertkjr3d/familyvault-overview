import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Only the router link and the card layout pieces are replaced; the section's own
// logic and the real formatting helpers run unchanged.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, hash }: { children?: ReactNode; to: string; hash?: string }) =>
    h("a", { href: hash ? `${to}#${hash}` : to }, children),
}));
vi.mock("@/components/RecordCard", () => ({
  Section: ({ title, children }: { title: string; children?: ReactNode }) =>
    h("section", { "data-title": title }, children),
  FieldRow: ({ label, value }: { label: ReactNode; value: ReactNode }) =>
    h("div", { className: "row" }, h("b", null, label), "=", h("i", null, value)),
}));

import { PropertyMortgageSection } from "./PropertyMortgageSection";
import { mortgageTotals, type LinkedLoan } from "@/lib/propertyMortgage";

const loan = (o: Partial<LinkedLoan>): LinkedLoan => ({ id: "l1", property_id: "p1", ...o });

function render(linked: LinkedLoan[], currency = "SGD") {
  const totals = mortgageTotals(currency, linked, null);
  return renderToStaticMarkup(
    h(PropertyMortgageSection, { linked, totals, currency, onOpenLoan: () => {} }),
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("PropertyMortgageSection", () => {
  it("with no linked loan, tells the user to add the mortgage in the Loans tab", () => {
    const html = render([]);
    expect(html).toContain('href="/loans"');
    expect(text(html)).toContain("No mortgage linked");
    expect(text(html)).toContain("Loans tab");
    expect(text(html)).not.toContain("Total owed");
  });

  it("shows the linked loan's figures and a link that opens that loan", () => {
    const html = render([
      loan({
        bank: "UOB",
        purpose: "Mortgage",
        balance: 900000,
        monthly_payment: 3359,
        rate: 1.5,
        reprice_date: "2028-03-08",
        loan_end_date: "2036-07-01",
      }),
    ]);
    const t = text(html);
    expect(t).toContain("UOB · Mortgage");
    expect(t).toContain("$900,000");
    expect(t).toContain("$3,359");
    expect(t).toContain("1.50%");
    expect(html).toContain('href="/loans#record-l1"');
    expect(t).toContain("Edit in Loans");
    expect(t).not.toContain("Total owed"); // only shown for 2+ loans
    expect(t).not.toContain("No mortgage linked");
  });

  it("shows a dash, not $0, when the balance is not known yet", () => {
    const t = text(render([loan({ bank: "OCBC", balance: null, monthly_payment: 6492 })]));
    expect(t).toContain("OCBC");
    expect(t).toContain("$6,492");
    expect(t).not.toContain("$0");
    expect(t).toMatch(/OCBC\s*=\s*—/);
  });

  it("uses the loan's own rate label when it has one", () => {
    const t = text(render([loan({ rate: 2.3, rate_label: "SORA + 0.8%" })]));
    expect(t).toContain("SORA + 0.8%");
  });

  it("says the end date is not set when it is blank", () => {
    expect(text(render([loan({})]))).toContain("Not set — chart assumes ongoing");
  });

  it("with two loans, lists both and shows the totals", () => {
    const html = render([
      loan({ id: "a", bank: "DBS", balance: 600000, monthly_payment: 2000 }),
      loan({ id: "b", bank: "HDB", balance: 300000, monthly_payment: 1000 }),
    ]);
    const t = text(html);
    expect(t).toContain("DBS");
    expect(t).toContain("HDB");
    expect(html).toContain('href="/loans#record-a"');
    expect(html).toContain('href="/loans#record-b"');
    expect(t).toContain("Total owed");
    expect(t).toContain("$900,000");
    expect(t).toContain("Total monthly payment");
    expect(t).toContain("$3,000");
  });

  it("explains when a foreign-currency loan is left out of the totals", () => {
    const t = text(
      render([
        loan({ id: "a", balance: 100, monthly_payment: 1 }),
        loan({ id: "b", currency: "JPY", balance: 5, monthly_payment: 1 }),
      ]),
    );
    expect(t).toContain("left out of the totals");
  });
});
