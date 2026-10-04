import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { scrollCardIntoView } from "@/lib/scrollToCard";

// "Flash this card" signal. Used after a new record is saved and when a card is
// picked from the header's Recent list: the caller names a record id, and the
// card with that id scrolls into view and flashes. Cards already on screen are
// told straight away; a card that only appears after the list refreshes (or
// after the member filter changes) picks it up when it mounts. Held in memory
// only, never saved, and ignored after 20s so a card hidden by a member filter
// cannot flash by surprise later.
const FLASH_MAX_AGE_MS = 20_000;
const SHEET_CLOSE_MS = 600; // a Sheet takes ~500ms to slide away; scroll after that
const FLASH_MS = 3000;
let pending: { id: string; at: number } | null = null;
const listeners = new Set<() => void>();

export function flashRecord(recordId: string | null | undefined) {
  pending = recordId ? { id: `record-${recordId}`, at: Date.now() } : null;
  listeners.forEach((notify) => notify());
}
// Older name, still used by the add-record forms.
export const flashNewRecord = flashRecord;

export function HashHighlight({ id, children }: { id: string; children: ReactNode }) {
  const [hl, setHl] = useState(false);
  useEffect(() => {
    let cancelScroll: (() => void) | undefined;
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
            cancelScroll?.();
            cancelScroll = scrollCardIntoView(el);
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
    return () => {
      window.removeEventListener("hashchange", check);
      cancelScroll?.();
    };
  }, [id]);

  // Flash signal (see top of file). Waits for any closing Sheet, scrolls to this
  // card, flashes it for 3s. All timers are cleared on unmount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelScroll: (() => void) | undefined;
    const run = () => {
      if (!pending || pending.id !== id) return;
      const age = Date.now() - pending.at;
      if (age > FLASH_MAX_AGE_MS) {
        pending = null;
        return;
      }
      if (startTimer) clearTimeout(startTimer);
      startTimer = setTimeout(
        () => {
          pending = null;
          const el = document.getElementById(id);
          if (el) {
            cancelScroll?.();
            cancelScroll = scrollCardIntoView(el);
          }
          setHl(true);
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => setHl(false), FLASH_MS);
        },
        Math.max(0, SHEET_CLOSE_MS - age),
      );
    };
    run(); // a flash requested before this card mounted
    listeners.add(run); // a flash requested while this card is already on screen
    return () => {
      listeners.delete(run);
      if (startTimer) clearTimeout(startTimer);
      if (hideTimer) clearTimeout(hideTimer);
      cancelScroll?.();
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
