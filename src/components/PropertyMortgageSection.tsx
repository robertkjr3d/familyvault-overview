import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { FieldRow, Section } from "@/components/RecordCard";
import { fmtMoney, fmtDate, fmtPct } from "@/lib/format";
import { loanPaymentOf, type LinkedLoan, type MortgageTotals } from "@/lib/propertyMortgage";

function AlertLabel({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1">
      {text}
      <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />
    </span>
  );
}

/**
 * The "Mortgage" part of a property card. Read-only: the mortgage is entered and
 * edited as a loan in the Loans tab, and this just shows the loans linked to the
 * property (a property can have more than one).
 */
export function PropertyMortgageSection({
  linked,
  totals,
  currency,
  onOpenLoan,
}: {
  linked: LinkedLoan[];
  totals: MortgageTotals;
  currency: string | null | undefined;
  onOpenLoan: (loan: LinkedLoan) => void;
}) {
  return (
    <Section title="Mortgage">
      {linked.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No mortgage linked. If this property has one, add it in the{" "}
          <Link to="/loans" className="font-semibold text-primary underline">
            Loans tab
          </Link>{" "}
          and pick this property under "Linked property".
        </p>
      ) : (
        <>
          {linked.map((l) => (
            <div
              key={l.id}
              className="space-y-1 border-t border-border/50 pt-2 first:border-0 first:pt-0"
            >
              <FieldRow
                label={[l.bank, l.purpose].filter(Boolean).join(" · ") || "Mortgage"}
                value={fmtMoney(l.balance == null ? null : Number(l.balance), l.currency)}
              />
              <FieldRow
                label="Monthly payment"
                value={loanPaymentOf(l) ? fmtMoney(loanPaymentOf(l), l.currency) : "—"}
              />
              <FieldRow
                label="Interest rate"
                value={l.rate_label || fmtPct(l.rate == null ? null : Number(l.rate))}
              />
              <FieldRow
                label={<AlertLabel text="Rate ends / Reprice" />}
                value={fmtDate(l.reprice_date)}
              />
              <FieldRow
                label="Mortgage end date"
                value={
                  l.loan_end_date ? (
                    fmtDate(l.loan_end_date)
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      Not set — chart assumes ongoing
                    </span>
                  )
                }
              />
              <Link
                to="/loans"
                hash={`record-${l.id}`}
                onClick={() => onOpenLoan(l)}
                className="inline-block pt-1 text-xs font-semibold text-primary underline"
              >
                Edit in Loans →
              </Link>
            </div>
          ))}
          {linked.length > 1 && (
            <div className="space-y-1 border-t border-border pt-2">
              <FieldRow
                label={<span className="font-bold">Total owed</span>}
                value={<span className="font-bold">{fmtMoney(totals.owed, currency)}</span>}
              />
              <FieldRow
                label={<span className="font-bold">Total monthly payment</span>}
                value={<span className="font-bold">{fmtMoney(totals.payment, currency)}</span>}
              />
            </div>
          )}
          {totals.unconverted && (
            <p className="text-[11px] text-muted-foreground">
              A loan in another currency is left out of the totals until its exchange rate is
              available.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
