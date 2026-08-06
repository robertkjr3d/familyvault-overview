import { useState } from "react";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useAppStore } from "@/lib/store";
import { markTourSeen } from "@/lib/tourSteps";

/**
 * Shown once per new user (has_seen_tour on their household_users row is
 * false) — including someone newly invited into an existing, already-set-up
 * household, since this is tracked per person, not per household. Cancelling
 * marks it seen too (so it doesn't nag every login) — the tour is always
 * still reachable afterward from Settings, separately from this flag.
 */
export function TourWelcomeScreen() {
  const { hasSeenTour, isLoading } = useCurrentRole();
  const activeTour = useAppStore((s) => s.activeTour);
  const startTour = useAppStore((s) => s.startTour);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  if (isLoading || hasSeenTour === undefined || hasSeenTour || activeTour || dismissedThisSession) {
    return null;
  }

  function cancel() {
    setDismissedThisSession(true);
    void markTourSeen();
    toast("You can take the tour anytime from Settings.");
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-2xl">
        <div className="mb-3 text-4xl">👋</div>
        <h2 className="text-lg font-bold">Welcome to FamilyHub!</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Want a quick 2-minute tour of how to add your first record and set a reminder?
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={() => startTour("core")}
            className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Take me on a tour
          </button>
          <button onClick={cancel} className="rounded-full px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
