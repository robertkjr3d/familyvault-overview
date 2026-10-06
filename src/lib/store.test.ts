import { describe, it, expect, beforeEach } from "vitest";

// The store saves through window.localStorage; tests run in Node, which has
// neither, so give it an in-memory version BEFORE the store module is loaded.
const saved = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, String(v)),
    removeItem: (k: string) => void saved.delete(k),
  },
};
const { useAppStore } = await import("./store");

const clean = {
  uiOwnerUserId: null,
  activeHouseholdId: null,
  memberFilter: "all",
  onboardingSoftDismissed: false,
  activeTour: null,
  tourStep: 0,
  tourRecordId: null,
  shareOpen: false,
  wizardOpen: false,
  coreTourResolved: false,
  extrasOfferPending: false,
};

function leaveSomeoneElsesState() {
  useAppStore.setState({
    uiOwnerUserId: "user-a",
    activeHouseholdId: "household-of-a",
    memberFilter: "member-1",
    onboardingSoftDismissed: true,
    activeTour: "core",
    tourStep: 3,
    tourRecordId: "loan-of-a",
    shareOpen: true,
    wizardOpen: true,
    coreTourResolved: true,
    extrasOfferPending: true,
  });
}

describe("claimUiForUser (no account inherits another account's UI state)", () => {
  beforeEach(() => {
    saved.clear();
    useAppStore.setState(clean);
  });

  it("resets everything account-specific when a different user signs in", () => {
    leaveSomeoneElsesState();
    useAppStore.getState().claimUiForUser("user-b");
    const s = useAppStore.getState();
    expect(s.uiOwnerUserId).toBe("user-b");
    expect(s.activeHouseholdId).toBeNull();
    expect(s.memberFilter).toBe("all");
    expect(s.onboardingSoftDismissed).toBe(false);
    expect(s.activeTour).toBeNull();
    expect(s.tourStep).toBe(0);
    expect(s.tourRecordId).toBeNull();
    expect(s.shareOpen).toBe(false);
    expect(s.wizardOpen).toBe(false);
    expect(s.coreTourResolved).toBe(false);
    expect(s.extrasOfferPending).toBe(false);
  });

  it("keeps the state when the same user signs in again", () => {
    useAppStore.getState().claimUiForUser("user-a");
    useAppStore.setState({ activeHouseholdId: "household-of-a", onboardingSoftDismissed: true });
    useAppStore.getState().claimUiForUser("user-a");
    const s = useAppStore.getState();
    expect(s.activeHouseholdId).toBe("household-of-a");
    expect(s.onboardingSoftDismissed).toBe(true);
  });

  it("treats state saved before this fix (no owner recorded) as someone else's", () => {
    useAppStore.setState({
      activeHouseholdId: "old-household",
      onboardingSoftDismissed: true,
      activeTour: "extras",
    });
    useAppStore.getState().claimUiForUser("user-b");
    const s = useAppStore.getState();
    expect(s.activeHouseholdId).toBeNull();
    expect(s.onboardingSoftDismissed).toBe(false);
    expect(s.activeTour).toBeNull();
    expect(s.uiOwnerUserId).toBe("user-b");
  });
});

describe("what is saved to the browser", () => {
  beforeEach(() => {
    saved.clear();
    useAppStore.setState(clean);
  });

  it("never saves a running tour, tour step, share sheet or live wizard flags", () => {
    leaveSomeoneElsesState();
    const stored = JSON.parse(saved.get("familyvault-ui")!).state;
    for (const key of [
      "activeTour",
      "tourStep",
      "shareOpen",
      "wizardOpen",
      "coreTourResolved",
      "extrasOfferPending",
    ]) {
      expect(stored).not.toHaveProperty(key);
    }
  });

  it("still saves the owner stamp, household choice, member filter and onboarding dismissal", () => {
    leaveSomeoneElsesState();
    const stored = JSON.parse(saved.get("familyvault-ui")!).state;
    expect(stored.uiOwnerUserId).toBe("user-a");
    expect(stored.activeHouseholdId).toBe("household-of-a");
    expect(stored.memberFilter).toBe("member-1");
    expect(stored.onboardingSoftDismissed).toBe(true);
  });
});

describe("tourRecordId (the loan the core tour created)", () => {
  beforeEach(() => {
    saved.clear();
    useAppStore.setState(clean);
  });

  it("is cleared when a new core tour starts, kept when the extras tour starts", () => {
    useAppStore.getState().setTourRecordId("loan-1");
    useAppStore.getState().startTour("extras");
    expect(useAppStore.getState().tourRecordId).toBe("loan-1");
    useAppStore.getState().startTour("core");
    expect(useAppStore.getState().tourRecordId).toBeNull();
  });

  it("survives the core tour ending (the extras tour is offered right after)", () => {
    useAppStore.getState().startTour("core");
    useAppStore.getState().setTourRecordId("loan-1");
    useAppStore.getState().endTour();
    expect(useAppStore.getState().tourRecordId).toBe("loan-1");
  });

  it("is not written to the browser", () => {
    useAppStore.getState().setTourRecordId("loan-1");
    const stored = [...saved.values()].join("");
    expect(stored).not.toContain("loan-1");
  });
});
