import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/**
 * Small "ⓘ" button that reveals a short explanation on tap. Used to keep
 * longer helper text out of the main layout (same look and behaviour as
 * FxInfoNote, but for any text). Place it next to a heading or label, not
 * inside a <label> element, so tapping it never focuses the field.
 */
export function InfoTip({
  children,
  label = "More info",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label={label}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={16}
        className="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs font-normal normal-case leading-snug text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
