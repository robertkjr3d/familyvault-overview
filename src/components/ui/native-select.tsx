import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A plain HTML <select> styled to match Input/Textarea/shadcn-Select visually —
 * same border, shadow-sm, and a custom chevron at a consistent inset from the
 * right edge (native browser select arrows sit flush against the border and
 * vary by OS/browser, which is why dropdowns across the app looked slightly
 * inconsistent). `appearance-none` removes the native arrow so this one is the
 * only one shown. Callers can still override size/radius/spacing (e.g. h-8,
 * rounded-lg) via className — only the chevron-safe padding, shadow, and
 * appearance are pinned so nothing regresses.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "h-9 w-full cursor-pointer rounded-md border border-input bg-background text-sm transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
            "appearance-none shadow-sm pl-3 pr-8",
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </div>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
