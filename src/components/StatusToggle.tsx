import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Status = "urgent" | "review" | "settled";

const config: Record<Status, { label: string; cls: string; dot: string }> = {
  urgent:  { label: "Urgent",  cls: "status-urgent",  dot: "🔴" },
  review:  { label: "Review",  cls: "status-review",  dot: "🟡" },
  settled: { label: "Settled", cls: "status-settled", dot: "🟢" },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const c = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        c.cls,
        className,
      )}
    >
      <span className="text-[8px]">{c.dot}</span> {c.label}
    </span>
  );
}

/** Single button + dropdown picker. Replaces 3-button toggle. */
export function StatusToggle({
  value,
  onChange,
  disabled,
}: {
  value: Status;
  onChange: (s: Status) => void;
  /** When true, renders as a plain non-interactive badge - no dropdown, no click. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const c = config[value];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  if (disabled) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
          c.cls,
        )}
      >
        <span className="text-[8px]">{c.dot}</span>
        {c.label}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
          c.cls,
        )}
      >
        <span className="text-[8px]">{c.dot}</span>
        {c.label}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        >
          {(["urgent", "review", "settled"] as Status[]).map((s) => {
            const cc = config[s];
            return (
              <button
                key={s}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(s);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent",
                  s === value && "bg-accent/60",
                )}
              >
                <span>{cc.dot}</span>
                <span>{cc.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
