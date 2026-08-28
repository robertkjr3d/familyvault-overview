// Step content for the guided product tour (GuidedTour.tsx runs these).
// Each step's `target` must match a data-tour="..." attribute already
// placed on the real element somewhere in the app — see that attribute's
// call site if a target ever needs to move.
//
// Split into two tours on purpose (Aug 2026 decision): CORE_TOUR_STEPS is
// the first-login walkthrough (add one real record, see it saved) — kept
// short since a 19-step first-run tour risks losing people partway
// through. EXTRAS_TOUR_STEPS is the optional second tour (toggle status,
// duplicate, reminders) offered afterward, and separately from Settings.

export type TourStep = {
  id: string;
  /** Route to navigate to before looking for this step's target. Omit if same page as previous step. */
  route?: string;
  /** Matches a data-tour="..." attribute on the real element to highlight. */
  target: string;
  title: string;
  body: string;
  /** Where the text card sits relative to the highlighted element. */
  placement?: "top" | "bottom" | "left" | "right";
  /**
   * Whether a single tap on the real target should advance the tour by
   * itself, in addition to the Next button. Opt-in on purpose, and false
   * (Next-only) is the safe default — omit this for any step whose target
   * opens something (a dropdown, a Sheet, a date picker) or needs typing
   * (a text field). For those, "tapped" isn't the same moment as "done":
   * tapping a bank dropdown only OPENS it, typing a balance only STARTS
   * once you tap the field. Auto-advancing on the tap itself would jump
   * the tour to the next step while the person is still mid-interaction —
   * confirmed the hard way, not a hypothetical. Set true only for a
   * genuine single-tap-completes-it action verified against the real
   * component: a button/icon whose onClick does the entire thing
   * immediately with no follow-up UI (a nav tap, a plain boolean toggle
   * with no popover, a form's Save/submit button).
   */
  advanceOnClick?: boolean;
  /**
   * For a field step: don't show the Next button until the real input
   * already has a value. Set true for a required field (bank) or one the
   * tour's whole point depends on (balance) — stated directly, not
   * inferred: forcing Next to wait until there's something to advance
   * past is a clearer signal than a highlight ring alone.
   */
  requireValue?: boolean;
  /**
   * Like requireValue, but for a step whose real action isn't a form
   * field with a .value — it's a click-driven control (the status
   * toggle's dropdown) that changes its own displayed text instead.
   * Next stays hidden until the target's visible text actually changes
   * from what it was when the step started. Don't combine with
   * disableInteraction — this needs the element to genuinely stay
   * clickable so the person can pick a real option.
   */
  requireChange?: boolean;
  /**
   * Milliseconds to wait, after this step is chosen but before the tour
   * actually starts looking for its target, when arriving at it opens a
   * Sheet or navigates to a new route. Confirmed real bug this fixes: the
   * tour would find the target the instant it existed in the DOM, which
   * for a Sheet still sliding into place or a page still rendering is
   * BEFORE the layout has actually settled — so the spotlight would
   * appear in the wrong spot and then visibly snap to the right one a
   * moment later once driver.js re-measured. This makes the tour wait
   * out that settle time BEFORE it looks at all, so what appears is
   * already correct the first time, instead of appearing wrong and then
   * jumping — the "video, not two things stacked on each other" feel.
   * Only set this on a step that follows a real transition (a Sheet
   * opening, a route change, a Sheet closing back to a list) — most
   * steps stay on the same static page and don't need it.
   */
  settleDelay?: number;
  /**
   * Highlight the real element but block real interaction with it — used
   * for a step whose real action (open a Sheet, open a dropdown) has no
   * downstream step depending on it having actually happened, so there's
   * nothing to gain from letting it fire and real cost to letting it:
   * confirmed directly — tapping "duplicate" during the tour created a
   * genuine second entry and opened a Sheet over the tour, which is
   * exactly the kind of real side effect a "just look at this" step
   * shouldn't be able to trigger. Never set this on a step whose target
   * needs to stay tappable for the tour to proceed (reminder-trigger,
   * any field, add-entry, the two Save buttons).
   */
  disableInteraction?: boolean;
};

// Shared by GuidedTour.tsx (on finish/skip) and TourWelcomeScreen.tsx (on
// cancel) so there's exactly one place that writes this flag. Best-effort:
// a failed write here should never block the tour UI — worst case the
// welcome screen offers itself again next login, a minor annoyance, not a
// broken experience.
export async function markTourSeen() {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return;
  await supabase.from("household_users" as any).update({ has_seen_tour: true }).eq("user_id", userId);
}

export const CORE_TOUR_STEPS: TourStep[] = [
  {
    id: "member-tag",
    route: "/",
    target: "member-filter",
    title: "This is you",
    body: "If your household has more than one person, tap a name here anytime to see just their portfolio.",
    placement: "bottom",
    advanceOnClick: true, // whole filter bar, tapping any chip is a complete, instant action
  },
  {
    id: "loans-tab",
    target: "nav-loans",
    title: "Do you have a loan?",
    body: "Mortgage, car loan, personal loan — let's add one. Tap here.",
    placement: "top",
    advanceOnClick: true, // nav tap, instant
  },
  {
    id: "member-confirm",
    route: "/loans",
    target: "member-filter",
    title: "Quick check",
    body: "Make sure this is set to you (or whoever the loan belongs to) before adding it.",
    placement: "bottom",
    // Purely informational — nothing to tap here, Next-only.
  },
  {
    id: "add-entry",
    target: "add-record-fab",
    title: "Add a new entry",
    body: "Tap the + button to add your first loan.",
    placement: "left",
    advanceOnClick: true, // FAB, instant
  },
  {
    id: "bank-field",
    target: "field-bank",
    title: "Which bank?",
    body: "Pick the bank this loan is with.",
    placement: "bottom",
    requireValue: true,
    settleDelay: 400, // follows add-entry opening the record Sheet
    // A dropdown — tapping it only OPENS the list, picking a bank is a
    // separate later moment. Next-only, and hidden until a bank is picked.
  },
  {
    id: "balance-field",
    target: "field-balance",
    title: "What's the current balance?",
    body: "A rough estimate is fine for now — you can always refine it later.",
    placement: "bottom",
    requireValue: true,
    // Text field — tapping it only focuses it for typing. Next-only, and
    // hidden until a number is actually typed in.
  },
  {
    id: "action-field",
    target: "field-action",
    title: "Anything to follow up on?",
    body: "Optional — a note on what to do next, e.g. \"Ask for a repricing rate by May.\" Then tap Next.",
    placement: "bottom",
    // Text field, same reasoning. Next-only.
  },
  {
    id: "save",
    target: "record-save",
    title: "Save it",
    body: "Don't worry about filling in every field — you can always come back and add more later.",
    placement: "top",
    advanceOnClick: true, // real submit button, instant
  },
  {
    id: "saved",
    target: "record-card",
    title: "Nice — you're all set! 🎉",
    body: "Your loan is saved. This card is where everything about it lives from now on. Insurance, property, and other sections work the same way — add one whenever you're ready.",
    placement: "bottom",
    settleDelay: 500, // follows Save writing to the database and the list refetching
    // Nothing to tap — this is the last step, "Done" ends the tour.
  },
];

export const EXTRAS_TOUR_STEPS: TourStep[] = [
  {
    id: "status-toggle",
    route: "/loans",
    target: "status-toggle",
    title: "Track progress",
    body: "Tap here and pick a status, so it's easy to see what still needs attention.",
    placement: "top",
    requireChange: true, // genuinely tap through and pick one — see requireChange's own comment for why this needs a different check than requireValue
  },
  {
    id: "duplicate",
    target: "duplicate-icon",
    title: "Got a similar one?",
    body: "Duplicate copies this entry's details into a new one — handy if you're adding several similar loans.",
    placement: "left",
    disableInteraction: true, // confirmed: tapping this for real creates a genuine second entry
  },
  {
    id: "expand",
    target: "expand-card",
    title: "More options",
    body: "Tap here to open the card and see notes, reminders, and history.",
    placement: "top",
    advanceOnClick: true, // plain expand/collapse toggle, no popover — instant
  },
  {
    id: "reminders-section",
    target: "reminders-section",
    title: "Reminders live here",
    body: "Tap to open the Reminders section.",
    placement: "top",
    advanceOnClick: true, // plain expand/collapse toggle, no popover — instant
    settleDelay: 350, // follows "expand" opening the card — its own expand animation needs to settle first
  },
  {
    id: "reminder-trigger",
    target: "reminder-trigger",
    title: "Set a reminder",
    body: "Tap here if you want an alert to come back to this later.",
    placement: "top",
    // Real single-tap action that opens the Sheet the next two steps live
    // in — same pattern as the FAB, not the same as duplicate/status-
    // toggle above (those have nothing downstream depending on them).
    advanceOnClick: true,
    settleDelay: 350, // follows "reminders-section" expanding — same reasoning
  },
  {
    id: "reminder-what",
    target: "field-reminder-what",
    title: "What's it about?",
    body: "A short label is enough, e.g. \"Reprice loan.\"",
    placement: "bottom",
    requireValue: true,
    settleDelay: 400, // follows reminder-trigger opening the reminder Sheet
    // Confirmed: the real Save button's own validation silently rejects
    // an empty "what" (a toast, not a disabled button) — without gating
    // Next here, the tour could walk someone straight into that toast
    // while itself moving on regardless. Text field — Next-only.
  },
  {
    id: "reminder-date",
    target: "field-reminder-date",
    title: "When?",
    body: "Just put today's date for now if you're not sure — you can change it later.",
    placement: "bottom",
    requireValue: true,
    // Same reasoning as reminder-what — the real form requires this too.
  },
  {
    id: "reminder-save",
    target: "reminder-save",
    title: "Save the reminder",
    body: "That's it — it'll show up on your dashboard when it's due.",
    placement: "top",
    advanceOnClick: true, // real submit button, instant
  },
  {
    id: "nav-home",
    target: "nav-home",
    title: "Back to your dashboard",
    body: "Tap Home to see everything in one place.",
    placement: "top",
    advanceOnClick: true, // nav tap, instant
    settleDelay: 400, // follows reminder-save closing the Sheet back to the list
  },
  {
    id: "upcoming",
    route: "/",
    target: "upcoming-section",
    title: "There it is 🎉",
    body: "Your reminder shows up here, along with anything else coming due across your whole household. That's the tour — explore Insurance, Property, and the rest whenever you're ready.",
    placement: "top",
    settleDelay: 400, // follows the nav-home route change
    // Final step, nothing to tap — "Done" ends the tour.
  },
];
