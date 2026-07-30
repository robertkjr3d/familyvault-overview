import { fmtMoney } from "@/lib/format";

/**
 * Shows each foreign-currency total on its own line, kept visibly separate
 * from the SGD figure above it — never added together, since summing
 * different currencies into one number would be misleading. Renders
 * nothing when there's nothing foreign to show.
 */
export function ForeignCurrencyTotals({ foreign }: { foreign: { currency: string; total: number }[] }) {
  if (foreign.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {foreign.map((f) => (
        <span key={f.currency}>+ {fmtMoney(f.total, f.currency)}</span>
      ))}
    </div>
  );
}
