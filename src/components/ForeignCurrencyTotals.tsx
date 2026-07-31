import { fmtMoney, convertToSgd, type FxRates } from "@/lib/format";

/**
 * Shows each foreign-currency total on its own line, kept visibly separate
 * from the SGD figure above it — never added together, since summing
 * different currencies into one number would be misleading. Renders
 * nothing when there's nothing foreign to show.
 *
 * When a cached fx rate is available (see useFxRates), also shows a
 * converted SGD-equivalent + the date that rate is from, so it's always
 * clear the figure is a converted estimate, not the actual entered amount.
 * If `fx` is omitted or has no rate for a given currency, that currency's
 * line just falls back to showing the foreign amount alone — never blocks
 * or shows an error.
 */
export function ForeignCurrencyTotals({
  foreign,
  fx,
}: {
  foreign: { currency: string; total: number }[];
  fx?: FxRates | null;
}) {
  if (foreign.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {foreign.map((f) => {
        const sgdEquivalent = convertToSgd(f.total, f.currency, fx);
        return (
          <span key={f.currency}>
            + {fmtMoney(f.total, f.currency)}
            {sgdEquivalent != null && (
              <span className="text-muted-foreground/70">
                {" "}
                (≈ {fmtMoney(sgdEquivalent)} as of {fx!.rateDate})
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
