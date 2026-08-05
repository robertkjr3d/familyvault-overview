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
  },
  {
    id: "loans-tab",
    target: "nav-loans",
    title: "Do you have a loan?",
    body: "Mortgage, car loan, personal loan — let's add one. Tap here.",
    placement: "top",
  },
  {
    id: "member-confirm",
    route: "/loans",
    target: "member-filter",
    title: "Quick check",
    body: "Make sure this is set to you (or whoever the loan belongs to) before adding it.",
    placement: "bottom",
  },
  {
    id: "add-entry",
    target: "add-record-fab",
    title: "Add a new entry",
    body: "Tap the + button to add your first loan.",
    placement: "left",
  },
  {
    id: "bank-field",
    target: "field-bank",
    title: "Which bank?",
    body: "Pick the bank this loan is with.",
    placement: "bottom",
  },
  {
    id: "balance-field",
    target: "field-balance",
    title: "What's the current balance?",
    body: "A rough estimate is fine for now — you can always refine it later.",
    placement: "bottom",
  },
  {
    id: "action-field",
    target: "field-action",
    title: "Anything to follow up on?",
    body: "Optional — a note on what to do next, e.g. \"Ask for a repricing rate by May.\"",
    placement: "bottom",
  },
  {
    id: "save",
    target: "record-save",
    title: "Save it",
    body: "Don't worry about filling in every field — you can always come back and add more later.",
    placement: "top",
  },
  {
    id: "saved",
    target: "record-card",
    title: "Nice — you're set up! 🎉",
    body: "Your loan is saved. This card is where everything about it lives from now on.",
    placement: "bottom",
  },
];

export const EXTRAS_TOUR_STEPS: TourStep[] = [
  {
    id: "status-toggle",
    route: "/loans",
    target: "status-toggle",
    title: "Track progress",
    body: "Tap here to mark something as Needs Review or Settled, so it's easy to see what still needs attention.",
    placement: "top",
  },
  {
    id: "duplicate",
    target: "duplicate-icon",
    title: "Got a similar one?",
    body: "Duplicate copies this entry's details into a new one — handy if you're adding several similar loans.",
    placement: "left",
  },
  {
    id: "expand",
    target: "expand-card",
    title: "More options",
    body: "Tap here to open the card and see notes, reminders, and history.",
    placement: "top",
  },
  {
    id: "reminders-section",
    target: "reminders-section",
    title: "Reminders live here",
    body: "Tap to open the Reminders section.",
    placement: "top",
  },
  {
    id: "reminder-trigger",
    target: "reminder-trigger",
    title: "Set a reminder",
    body: "Tap here if you want an alert to come back to this later.",
    placement: "top",
  },
  {
    id: "reminder-what",
    target: "field-reminder-what",
    title: "What's it about?",
    body: "A short label is enough, e.g. \"Reprice loan.\"",
    placement: "bottom",
  },
  {
    id: "reminder-date",
    target: "field-reminder-date",
    title: "When?",
    body: "Just put today's date for now if you're not sure — you can change it later.",
    placement: "bottom",
  },
  {
    id: "reminder-save",
    target: "reminder-save",
    title: "Save the reminder",
    body: "That's it — it'll show up on your dashboard when it's due.",
    placement: "top",
  },
  {
    id: "nav-home",
    target: "nav-home",
    title: "Back to your dashboard",
    body: "Tap Home to see everything in one place.",
    placement: "top",
  },
  {
    id: "upcoming",
    route: "/",
    target: "upcoming-section",
    title: "There it is",
    body: "Your reminder shows up here, along with anything else coming due across your whole household.",
    placement: "top",
  },
];
