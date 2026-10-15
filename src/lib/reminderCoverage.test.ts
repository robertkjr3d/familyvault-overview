import { describe, it, expect, vi, afterEach } from "vitest";
import { buildUpcomingItems, splitDueThisWeek, DUE_THIS_WEEK_DAYS } from "./alerts";
import type { UpcomingItem } from "./alerts";

// Every kind of record a reminder can be attached to (one per tab). If a new
// tab gets reminders, add it here AND to the lookup in alerts.ts — the guard
// test in alertClock.guard.test.ts fails until you do.
const TYPES = [
  { type: "insurance", key: "insurance", href: "/insurance" },
  { type: "savings", key: "savings", href: "/savings" },
  { type: "loan", key: "loans", href: "/loans" },
  { type: "property", key: "properties", href: "/property" },
  { type: "investment", key: "investments", href: "/investments" },
  { type: "inventory", key: "inventoryItems", href: "/inventory" },
  { type: "other_asset", key: "otherAssets", href: "/other-assets" },
  { type: "credit_card", key: "creditCards", href: "/cards" },
  { type: "health", key: "healthConditions", href: "/health" },
] as const;

const empty = {
  properties: [],
  loans: [],
  insurance: [],
  investments: [],
  savings: [],
  inventoryItems: [],
  otherAssets: [],
  creditCards: [],
  healthConditions: [],
  reminders: [],
} as any;

// Test Mode style "today": a date far from the real clock.
const SIM_TODAY = new Date("2027-09-15T00:00:00");

function reminder(type: string, remindAt: string) {
  return {
    id: "r1",
    entity_type: type,
    entity_id: "e1",
    remind_at: remindAt,
    what: "Check",
    recurrence: null,
  };
}

describe("reminders appear for every record type", () => {
  for (const t of TYPES) {
    it(`${t.type}: shows with the record's name and member, at the 90-day horizon`, () => {
      const data = {
        ...empty,
        [t.key]: [{ id: "e1", name: "My record", member_id: "m1" }],
        reminders: [reminder(t.type, "2027-10-15")],
      };
      const items = buildUpcomingItems(data, SIM_TODAY, 90);
      expect(items).toHaveLength(1);
      expect(items[0].label).toBe("My record — Check");
      expect(items[0].member_id).toBe("m1");
      expect(items[0].href).toBe(t.href);
      expect(items[0].kind).toBe("Reminder");
      expect(items[0].daysLeft).toBe(30);
    });
  }

  it("savings reminders resolve through the institution name (savings have no name field)", () => {
    const data = {
      ...empty,
      savings: [{ id: "e1", institution: "DBS", member_id: "m1" }],
      reminders: [reminder("savings", "2027-10-15")],
    };
    expect(buildUpcomingItems(data, SIM_TODAY, 90)[0].label).toBe("DBS — Check");
  });
});

describe("the alert window follows the date it is given, never the real clock", () => {
  afterEach(() => vi.useRealTimers());

  it("gives the same answer whatever the real clock says", () => {
    const data = { ...empty, reminders: [reminder("savings", "2027-10-15")] };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00"));
    const a = buildUpcomingItems(data, SIM_TODAY, 90);
    vi.setSystemTime(new Date("2035-06-01T00:00:00"));
    const b = buildUpcomingItems(data, SIM_TODAY, 90);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("includes a one-off reminder 89 days out and leaves out one 91 days out (dashboard window)", () => {
    const inside = { ...empty, reminders: [reminder("loan", "2027-12-13")] }; // 89 days
    const outside = { ...empty, reminders: [reminder("loan", "2027-12-15")] }; // 91 days
    expect(buildUpcomingItems(inside, SIM_TODAY, 90)).toHaveLength(1);
    expect(buildUpcomingItems(outside, SIM_TODAY, 90)).toHaveLength(0);
  });

  it("documents the edge: a reminder exactly N days away is outside an N-day window; N-1 is inside", () => {
    const exact = { ...empty, reminders: [reminder("loan", "2027-10-15")] }; // exactly 30 days
    expect(buildUpcomingItems(exact, SIM_TODAY, 30)).toHaveLength(0);
    expect(buildUpcomingItems(exact, new Date("2027-09-16T00:00:00"), 30)).toHaveLength(1);
  });

  it("still lists an overdue one-off reminder", () => {
    const data = { ...empty, reminders: [reminder("loan", "2027-09-10")] };
    const items = buildUpcomingItems(data, SIM_TODAY, 30);
    expect(items).toHaveLength(1);
    expect(items[0].daysLeft).toBeLessThan(0);
  });
});

describe("splitDueThisWeek (bell lists)", () => {
  const item = (daysLeft: number) => ({ daysLeft }) as UpcomingItem;
  it("puts overdue, today and up to 7 days into 'due this week', the rest into 'coming up'", () => {
    const { dueThisWeek, comingUp } = splitDueThisWeek([
      item(-3),
      item(0),
      item(7),
      item(8),
      item(30),
    ]);
    expect(DUE_THIS_WEEK_DAYS).toBe(7);
    expect(dueThisWeek.map((i) => i.daysLeft)).toEqual([-3, 0, 7]);
    expect(comingUp.map((i) => i.daysLeft)).toEqual([8, 30]);
  });
  it("returns two empty lists for no items and keeps the order it was given", () => {
    expect(splitDueThisWeek([])).toEqual({ dueThisWeek: [], comingUp: [] });
    const { comingUp } = splitDueThisWeek([item(20), item(9), item(15)]);
    expect(comingUp.map((i) => i.daysLeft)).toEqual([20, 9, 15]);
  });
});
