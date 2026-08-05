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
    }),
    { name: "familyvault-ui" },
  ),
);
