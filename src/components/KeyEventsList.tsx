import type { ChartPoint } from "@/lib/lifetimeChartMath";

// Shared "key events" list rendered below both LifetimeChart and
// CashflowOverYearsChart. One column on phone (each event its own row),
// two columns on desktop with a divider down the middle — done via
// Tailwind's built-in `odd:`/`even:` child selectors (odd items land in
// the left column, even in the right, for standard left-to-right grid
// auto-placement), NOT via `divide-x` — divide-x borders every child
// after the first regardless of grid column, which would draw a stray
// line down the left column too. `md:odd:border-r` only borders the
// left-column item, giving one clean vertical divider.
export function KeyEventsList({ eventYears }: { eventYears: ChartPoint[] }) {
  if (eventYears.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-y-1 pt-1 text-[10px] text-muted-foreground md:grid-cols-2 md:gap-x-4">
      {eventYears.flatMap((d) =>
        d.events.map((e, i) => {
          const key = `${d.year}-${i}`;
          const content = (
            <>
              <span className="font-semibold text-primary">{d.year}</span> — {e.label}
            </>
          );
          const className = `rounded px-1 py-0.5 transition-colors md:odd:border-r md:odd:border-border md:odd:pr-3 ${
            e.href ? "hover:bg-accent/40 hover:text-foreground" : ""
          }`;
          return e.href ? (
            <a key={key} href={e.href} className={className}>
              {content}
            </a>
          ) : (
            <span key={key} className={className}>
              {content}
            </span>
          );
        })
      )}
    </div>
  );
}
