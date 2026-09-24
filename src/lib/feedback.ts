import { toast } from "sonner";

// TODO: replace with the real published Google Form URL before deploying.
// Every entry point below (Settings, the persistent feedback tab) reads
// from this one constant, so updating it here updates it everywhere.
export const FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf-yj_CnXgi9fCeytclhTWvLZeB_CaiyVlRrlqbbIaPSJHCoQ/viewform?usp=publish-editor";

// Shared onClick for every "give feedback" link in the app. The link itself
// still does the actual navigation (a real <a href target="_blank"> tag,
// kept everywhere for accessibility and right-click/middle-click-to-open —
// this only runs alongside it, never instead of it). Two things happen
// here: (1) log which entry point was actually used, tagged by source, so
// it's possible to tell later whether the persistent tab or the Settings
// link is doing the work — same pattern-finding instinct as the rest of
// this app's beta feedback setup; (2) a short thank-you toast, since
// submitting a Google Form gives no acknowledgment inside the app itself.
// Overrides the app's global 1s toast duration on purpose (same precedent
// already used for error toasts) — a thank-you worth reading needs more
// than a second on screen.
export function feedbackClickHandler(source: "settings" | "global_tab") {
  return () => {
    (window as any).posthog?.capture("feedback_form_opened", { source });
    toast.success(
      "Thank you so much — genuinely appreciated. We're still in beta, so feedback like this directly shapes what gets built next.",
      { duration: 5000 },
    );
  };
}
