import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleSection({
  icon,
  title,
  defaultOpen = false,
  count,
  id,
  open: openProp,
  onOpenChange,
  children,
  dataTour,
}: {
  icon?: ReactNode;
  title: string;
  defaultOpen?: boolean;
  count?: number;
  /** DOM id for this section, used as a scroll target (e.g. from a collapsed-card icon click). */
  id?: string;
  /** Controlled open state. If provided, this section's open/closed state is driven by the parent
   * instead of managing its own — used so a click on the collapsed card's Notes/Reminder icon can
   * force this section open. If omitted, falls back to internal state (existing behaviour). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /** Optional anchor for the guided tour to target this specific section's header. */
  dataTour?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;

  function toggle() {
    if (isControlled) {
      onOpenChange?.(!open);
    } else {
      setInternalOpen((v) => !v);
    }
  }

  return (
    <section id={id} className="rounded-xl border border-border/60 bg-background/60">
      <button
        type="button"
        onClick={toggle}
        data-tour={dataTour}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
          {count != null && count > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {count}
            </span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border/40 px-3 py-3">{children}</div>}
    </section>
  );
}
