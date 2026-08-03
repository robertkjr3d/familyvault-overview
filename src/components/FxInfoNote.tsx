import { useState } from "react";
import { Info } from "lucide-react";
import type { FxRates } from "@/lib/format";

/**
 * Small "ⓘ" button next to a total that includes converted foreign
 * currency — tapping it explains where the conversion comes from. Same
 * tap-to-toggle pattern as the Lifetime Chart's info button (not a hover
 * tooltip, since this app is used on mobile). Renders nothing if there's no
 * cached rate yet, since there'd be nothing converted to explain.
 */
export function FxInfoNote({ fx }: { fx?: FxRates | null }) {
  const [open, setOpen] = useState(false);
  if (!fx) return null;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="ml-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        aria-label="About the foreign currency conversion"
      >
        <Info className="h-3 w-3" />
      </button>
      {open && (
        <span className="absolute left-0 top-5 z-10 w-56 rounded-lg border border-border bg-card p-2 text-[10px] font-normal normal-case leading-snug text-muted-foreground shadow-md">
          Foreign currency amounts are converted to SGD automatically once a day, using live rates
          from Frankfurter. Rate date: {fx.rateDate}.
        </span>
      )}
    </span>
  );
}
