import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// "Just added" memory: after a new record is saved, the save code calls
// flashNewRecord(id). The card with that id (it only exists once the list has
// refreshed) then scrolls into view and flashes. Held in memory only, never
// saved, and ignored after 20s so a card that is hidden by a member filter
// cannot flash by surprise later.
const NEW_RECORD_MAX_AGE_MS = 20_000;
const SHEET_CLOSE_MS = 600; // the add-form sheet takes ~500ms to slide away
let justAdded: { id: string; at: number } | null = null;

export function flashNewRecord(recordId: string | null | undefined) {
  justAdded = recordId ? { id: `record-${recordId}`, at: Date.now() } : null;
}

export function HashHighlight({ id, children }: { id: string; children: ReactNode }) {
  const [hl, setHl] = useState(false);
  useEffect(() => {
    const check = () => {
      if (typeof window === "undefined") return;
      if (window.location.hash === `#${id}`) {
        // Poll for the element instead of a single fixed delay — on a
        // fresh page load the data (and this element) may still be
        // loading well past 50ms, which silently skipped the scroll.
        let attempts = 0;
        const tryScroll = () => {
          const el = document.getElementById(id);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (attempts < 20) {
            attempts++;
            setTimeout(tryScroll, 100);
          }
        };
        tryScroll();
        setHl(true);
        const t = setTimeout(() => setHl(false), 2000);
        return () => clearTimeout(t);
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [id]);

  // Newly saved record: wait for the add-form sheet to finish closing, scroll
  // to this card, flash it for 3s. Timers are cleared on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!justAdded || justAdded.id !== id) return;
    const age = Date.now() - justAdded.at;
    if (age > NEW_RECORD_MAX_AGE_MS) {
      justAdded = null;
      return;
    }
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(
      () => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
        setHl(true);
        justAdded = null;
        hideTimer = setTimeout(() => setHl(false), 3000);
      },
      Math.max(0, SHEET_CLOSE_MS - age),
    );
    return () => {
      clearTimeout(startTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [id]);

  return (
    <div
      id={id}
      className={cn(
        "rounded-2xl transition-all duration-500",
        hl && "ring-4 ring-yellow-400 ring-offset-2 ring-offset-background",
      )}
    >
      {children}
    </div>
  );
}
