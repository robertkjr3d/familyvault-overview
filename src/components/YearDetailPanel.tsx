import { useState } from "react";
import { fmt } from "@/components/LifetimeChart";
import type { ChartPoint, LineItem } from "@/components/LifetimeChart";

type Props = {
  data: ChartPoint[];
  retirementYear: number | null;
  shortfallYear: number | null;
};

function ItemRow({ it, color }: { it: LineItem; color: "settled" | "urgent" }) {
  const sign = color === "settled" ? "+" : "−";
  const textClass = color === "settled" ? "font-medium text-settled" : "font-medium text-urgent";
  const inner = (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{it.label}</span>
      <span className={textClass}>{sign}{fmt(it.amount)}</span>
    </div>
  );
  if (it.href) {
    return (
      <a href={it.href} className="block rounded hover:bg-accent/40 -mx-1 px-1 transition-colors">
        {inner}
      </a>
    );
  }
  return inner;
}

export function YearDetailPanel({ data, retirementYear, shortfallYear }: Props) {
  const [selectedYear, setSelectedYear] = useState<number>(data[0]?.year ?? new Date().getFullYear());
  const point = data.find((d) => d.year === selectedYear) ?? data[0] ?? null;

  if (!point) return null;

  const inflows = [...point.inflowItems].filter((it) => it.amount > 0).sort((a, b) => b.amount - a.amount);
  const outflows = [...point.outflowItems].filter((it) => it.amount > 0).sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-2 pt-2">
      <div className="text-xs font-bold">Year detail</div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {data.map((d) => {
          const isSelected = d.year === selectedYear;
          const isRetirement = d.year === retirementYear;
          const isShortfall = d.year === shortfallYear;
          return (
            <button
              key={d.year}
              type="button"
              onClick={() => setSelectedYear(d.year)}
              className={`flex-shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {d.year}
              {isShortfall && <span className={isSelected ? "ml-1" : "ml-1 text-urgent"}>⚠</span>}
              {!isShortfall && isRetirement && <span className={isSelected ? "ml-1" : "ml-1 text-primary"}>●</span>}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border bg-card p-3 text-xs">
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-bold">{point.year}</span>
          <span className="text-[10px] text-muted-foreground">
            Net worth: <span className="font-semibold text-foreground">{fmt(point.netWorth)}</span>
          </span>
        </div>

        {inflows.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Money in
            </div>
            {inflows.map((it, i) => (
              <ItemRow key={i} it={it} color="settled" />
            ))}
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold">
              <span>Total in</span>
              <span className="text-settled">+{fmt(point.annualIn)}</span>
            </div>
          </div>
        )}

        {outflows.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Money out
            </div>
            {outflows.map((it, i) => (
              <ItemRow key={i} it={it} color="urgent" />
            ))}
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-bold">
              <span>Total out</span>
              <span className="text-urgent">−{fmt(point.annualOut)}</span>
            </div>
          </div>
        )}

        <div
          className={`mt-1 flex justify-between border-t border-border pt-1.5 font-bold ${
            point.annualNet >= 0 ? "text-settled" : "text-urgent"
          }`}
        >
          <span>Net cash flow</span>
          <span>
            {point.annualNet >= 0 ? "+" : "−"}{fmt(Math.abs(point.annualNet))}
          </span>
        </div>

        {point.propAppreciation > 0 && (
          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Property appreciation</span>
              <span className="font-medium text-settled">+{fmt(point.propAppreciation)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Not included in cash flow — tracked separately as an asset value increase.
            </p>
          </div>
        )}

        {point.events.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {point.events.map((e, i) => (
              <div key={i} className="break-words rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {e}
              </div>
            ))}
          </div>
        )}

        {inflows.length === 0 && outflows.length === 0 && (
          <div className="text-muted-foreground">No cash flow recorded for this year.</div>
        )}

        <p className="mt-2 text-[10px] text-muted-foreground">
          Tap any line item to go to that record.
        </p>
      </div>
    </div>
  );
}
