import * as React from "react";
import { X } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";
import { useDateInputBuffer } from "@/hooks/useDateInputBuffer";

/**
 * A Safari-safe wrapper around the native <input type="date">.
 *
 * ROOT CAUSE (Aug 18, 2026 — diagnosed from code, NOT yet confirmed live in
 * Safari; this sandbox has no browser. Verify on a real Safari/iPhone
 * device before treating this as fully closed):
 *
 * Every date field in this app was a plain controlled
 * `<input type="date" value={x} onChange={e => setX(e.target.value)} />`.
 * On each keystroke, the new value is written straight back into React
 * state and re-rendered into the DOM node's `value`. Chrome's native
 * date-picker tolerates this. Safari's WebKit implementation does not —
 * re-assigning `.value` while a segment (day/month/year) is still being
 * typed resets its internal per-segment editing/cursor state, which is
 * what produces the "invalid" flash and the "click around a bunch of
 * times before it takes" symptom reported for the Insurance tab (and
 * elsewhere — the same pattern existed in 7 other files, see below).
 *
 * This is also almost certainly why a one-off payout's start and end date
 * couldn't be set equal on Safari: there is no min/max or equality
 * validation anywhere in this app's code (confirmed by grep) — it's the
 * same native-widget glitch triggered while typing/picking the matching
 * date, not an application rule.
 *
 * FIX: buffer the DOM input's live value in local state (useDateInputBuffer)
 * and only let a genuine EXTERNAL change (switching records, a reset) sync
 * back down — never our own onChange's own round trip through the parent.
 *
 * Swapped in everywhere a raw `<Input type="date">` previously existed:
 * RecordFormSheet.tsx, RecordWizardSheet.tsx, ReminderButton.tsx,
 * OnboardingWizard.tsx (x2), inventory.tsx (x2). Settings' Test Mode date
 * keeps its own raw custom-styled <input> but reuses the same
 * useDateInputBuffer hook underneath, rather than a hand-copied fix.
 */
export const DateInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string | null | undefined;
    onChange: (v: string) => void;
    className?: string;
    /** Show the round "clear date" (×) button when a date is set. Default true — pass false to match a call site that never had one. */
    showClear?: boolean;
  } & Omit<React.ComponentProps<"input">, "value" | "onChange" | "type">
>(({ value, onChange, className, showClear = true, ...props }, ref) => {
  const { local, handleChange, clear } = useDateInputBuffer(value, onChange);
  const hasDate = local !== "";

  return (
    <div className="relative flex items-center">
      <Input
        ref={ref}
        type="date"
        value={local}
        onChange={handleChange}
        className={cn(showClear && "pr-8", className)}
        {...props}
      />
      {showClear && hasDate && (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 flex items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Clear date"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
DateInput.displayName = "DateInput";
