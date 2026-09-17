import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MemberFilter = "all" | string; // "all" or member id
export type TourId = "core" | "extras";

type AppStore = {
  memberFilter: MemberFilter;
  setMemberFilter: (m: MemberFilter) => void;
  activeHouseholdId: string | null;
  setActiveHouseholdId: (id: string | null) => void;
  shareOpen: boolean;
  setShareOpen: (v: boolean) => void;
  activeTour: TourId | null;
  tourStep: number;
  startTour: (tour: TourId) => void;
  advanceTour: () => void;
  endTour: () => void;
  // Closing the wizard any way OTHER than its explicit "Don't show this
  // again" link doesn't persist onboarding_dismissed to the database (that's
  // intentional — a soft "not now" shouldn't be permanent). But without
  // SOME memory of that close, navigating away and back to "/" remounts the
  // dashboard, resets its local ref, and the wizard pops back up — this
  // flag is that memory. Persisted (survives reload, same browser only) so
  // it never nags again this browser once you've closed it once.
  onboardingSoftDismissed: boolean;
  setOnboardingSoftDismissed: (v: boolean) => void;
  // Live "is the onboarding wizard actually on screen right now" signal —
  // the wizard itself only mounts on the dashboard route (index.tsx), but
  // the tour welcome popup is mounted globally (__root.tsx) and has no
  // other way to know the wizard is currently up. Deliberately NOT
  // persisted (see partialize below): unlike onboardingSoftDismissed, a
  // stale `true` surviving a reload would permanently block the tour
  // welcome popup for no reason.
  wizardOpen: boolean;
  setWizardOpen: (v: boolean) => void;
  // Bug fix (Sep 2026): invalidateQueries doesn't update the cached
  // hasSeenTour value synchronously — it just marks the query for
  // refetching, which is a real network round trip. In the gap between
  // finish() ending the tour and that refetch actually completing,
  // TourWelcomeScreen was still reading the OLD cached `false`, so it
  // could flash back on screen for that window. This flag is set the
  // instant the tour finishes, synchronously, with zero network
  // dependency — TourWelcomeScreen checks this FIRST, so it can't reopen
  // during that gap regardless of how long the refetch takes. Not
  // persisted: it only needs to bridge one in-session race, and by the
  // time of any later reload the real DB value has long since caught up.
  coreTourResolved: boolean;
  setCoreTourResolved: (v: boolean) => void;
  // True while the "Want more tips & tricks?" toast is up and undecided.
  // The passkey prompt was gated only on hasSeenTour === true, which (now
  // that it updates promptly instead of staying stale) fires at almost the
  // exact moment this toast appears — two full-screen-feeling things at
  // once. This flag lets the passkey prompt wait until the person has
  // actually answered the tour-2 question, matching what was asked for.
  extrasOfferPending: boolean;
  setExtrasOfferPending: (v: boolean) => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      memberFilter: "all",
      setMemberFilter: (memberFilter) => set({ memberFilter }),
      activeHouseholdId: null,
      setActiveHouseholdId: (activeHouseholdId) => set({ activeHouseholdId }),
      shareOpen: false,
      setShareOpen: (shareOpen) => set({ shareOpen }),
      activeTour: null,
      tourStep: 0,
      startTour: (activeTour) => set({ activeTour, tourStep: 0 }),
      advanceTour: () => set((s) => ({ tourStep: s.tourStep + 1 })),
      endTour: () => set({ activeTour: null, tourStep: 0 }),
      onboardingSoftDismissed: false,
      setOnboardingSoftDismissed: (onboardingSoftDismissed) => set({ onboardingSoftDismissed }),
      wizardOpen: false,
      setWizardOpen: (wizardOpen) => set({ wizardOpen }),
      coreTourResolved: false,
      setCoreTourResolved: (coreTourResolved) => set({ coreTourResolved }),
      extrasOfferPending: false,
      setExtrasOfferPending: (extrasOfferPending) => set({ extrasOfferPending }),
    }),
    {
      name: "familyvault-ui",
      partialize: (state) => {
        const { wizardOpen: _wizardOpen, coreTourResolved: _coreTourResolved, extrasOfferPending: _extrasOfferPending, ...rest } = state;
        return rest;
      },
    },
  ),
);
