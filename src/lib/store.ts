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
    }),
    {
      name: "familyvault-ui",
      partialize: (state) => {
        const { wizardOpen: _wizardOpen, ...rest } = state;
        return rest;
      },
    },
  ),
);
