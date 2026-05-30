import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MemberFilter = "all" | string; // "all" or member id

type AppStore = {
  memberFilter: MemberFilter;
  setMemberFilter: (m: MemberFilter) => void;
  activeHouseholdId: string | null;
  setActiveHouseholdId: (id: string | null) => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      memberFilter: "all",
      setMemberFilter: (memberFilter) => set({ memberFilter }),
      activeHouseholdId: null,
      setActiveHouseholdId: (activeHouseholdId) => set({ activeHouseholdId }),
    }),
    { name: "familyvault-ui" },
  ),
);
