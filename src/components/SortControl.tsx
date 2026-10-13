import { useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "@/lib/store";
import { RECORD_SORT_LABELS, type RecordSort } from "@/lib/sort";
import { cn } from "@/lib/utils";

const OPTIONS: RecordSort[] = ["urgency", "edited", "created"];

/**
 * The "Sort" button shown beside each record tab's title (Loans, Insurance,
 * Savings, ...). Pure display choice: it changes the order the cards are listed
 * in, nothing else, and is not saved (see recordSort in store.ts).
 *
 * The button is exactly 32px tall, the same as the page title's line height
 * (text-2xl), so putting it in the title row does not move anything below it.
 * It shows the current choice, and is tinted when it is not the default so
 * nobody wonders why their cards are in a different order.
 */
export function SortControl() {
  const recordSort = useAppStore((s) => s.recordSort);
  const setRecordSort = useAppStore((s) => s.setRecordSort);
  const [open, setOpen] = useState(false);
  const label = RECORD_SORT_LABELS[recordSort];
  const isDefault = recordSort === "urgency";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sort cards. Currently sorted by ${label}`}
          className={cn(
            "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition",
            isDefault
              ? "border-border bg-card text-foreground hover:bg-accent"
              : "border-primary bg-primary/10 text-primary hover:bg-primary/15",
          )}
        >
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sort: {label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={16} className="w-48 p-1">
        <div role="radiogroup" aria-label="Sort cards by">
          {OPTIONS.map((option) => {
            const selected = option === recordSort;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setRecordSort(option);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-left text-sm hover:bg-accent",
                  selected && "font-semibold",
                )}
              >
                <span>
                  {RECORD_SORT_LABELS[option]}
                  {option === "urgency" && (
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (default)
                    </span>
                  )}
                </span>
                {selected && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
