import { Info } from "lucide-react";
import type { FxRates } from "@/lib/format";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

/**
 * Small "ⓘ" button next to a total that includes converted foreign
 * currency — tapping it explains where the conversion comes from. Renders
 * nothing if there's no cached rate yet, since there'd be nothing converted
 * to explain.
 *
 * Sep 6 2026: was a hand-rolled `absolute left-0 top-5 w-56` span — always
 * anchored its LEFT edge to the button with a fixed 224px width, so on any
 * screen where the button itself sat toward the right (common here, since
 * this appears next to right-aligned dollar totals), the popover ran off
 * the right edge of the viewport with no way to reposition itself. Rebuilt
 * on this app's own Popover primitive (Radix — already proven working here
 * via Dialog/Select, just never used for a popover before this) instead of
 * guessing pixel offsets myself: it has real collision detection built in,
 * so it shifts to stay on-screen regardless of where the trigger sits.
 */
export function FxInfoNote({ fx }: { fx?: FxRates | null }) {
  if (!fx) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          aria-label="About the foreign currency conversion"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={16}
        className="w-56 max-w-[calc(100vw-2rem)] p-2 text-[10px] font-normal normal-case leading-snug text-muted-foreground"
      >
        Foreign currency amounts are converted to SGD automatically once a day, using live rates
        from Frankfurter. Rate date: {fx.rateDate}.
      </PopoverContent>
    </Popover>
  );
}
