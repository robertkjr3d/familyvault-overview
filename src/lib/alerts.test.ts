import { describe, it, expect } from "vitest";
import { computeNextOccurrence, buildUpcomingItems, reminderHref } from "./alerts";

describe("computeNextOccurrence", () => {
  const today = new Date(2026, 5, 18); // 18 Jun 2026

  it("returns null when there is no start date", () => {
    expect(computeNextOccurrence(null, "monthly", null, today)).toBeNull();
  });

  it("returns null for a one-off frequency — a single payment has no recurring 'next due'", () => {
    expect(computeNextOccurrence("2024-01-01", "one-off", null, today)).toBeNull();
  });

  it("treats a missing/unrecognised frequency as annual", () => {
    expect(computeNextOccurrence("2024-01-01", "", null, today)).not.toBeNull();
    expect(computeNextOccurrence("2024-01-01", undefined, null, today)).not.toBeNull();
  });

  it("returns null once the recurring schedule has already ended", () => {
    expect(computeNextOccurrence("2020-01-01", "annual", "2025-01-01", today)).toBeNull();
  });

  it("regression: a yearly premium with a start date years in the past and NO end date still produces a next occurrence — this was the real production bug (it used to alert zero times, ever)", () => {
    const next = computeNextOccurrence("2024-03-15", "annual", null, today);
    expect(next).toBe("2027-03-15");
  });

  it("advances a monthly premium to the correct next occurrence", () => {
    expect(computeNextOccurrence("2026-01-10", "monthly", null, today)).toBe("2026-07-10");
  });

  it("advances a quarterly premium correctly", () => {
    expect(computeNextOccurrence("2026-01-01", "quarterly", null, today)).toBe("2026-07-01");
  });

  it("returns the start date itself if it is already on/after today", () => {
    expect(computeNextOccurrence("2026-07-01", "annual", null, today)).toBe("2026-07-01");
  });

  it("regression: a start date of the 31st with monthly frequency does not drift forward — Jan 31 + 1 month must be Feb 28, not Mar 3 (found and fixed while writing this test — the previous setMonth-based loop produced Mar 3)", () => {
    const next = computeNextOccurrence("2026-01-31", "monthly", null, new Date(2026, 1, 1)); // 1 Feb 2026
    expect(next).toBe("2026-02-28");
  });

  it("does not let a clamped short month permanently shrink later, longer months", () => {
    // Jan 31 -> Feb (clamped to 28) -> Mar should go back to 31, not stay at 28.
    const next = computeNextOccurrence("2026-01-31", "monthly", null, new Date(2026, 2, 1)); // 1 Mar 2026
    expect(next).toBe("2026-03-31");
  });

  it("clamps correctly into a leap-year February", () => {
    const next = computeNextOccurrence("2026-01-31", "monthly", null, new Date(2028, 0, 30)); // late Jan 2028 (leap year)
    expect(next).toBe("2028-01-31");
    const nextAfterThat = computeNextOccurrence("2026-01-31", "monthly", null, new Date(2028, 1, 1)); // 1 Feb 2028
    expect(nextAfterThat).toBe("2028-02-29");
  });

  it("returns null if the next occurrence would fall after the end date", () => {
    const next = computeNextOccurrence("2020-01-01", "annual", "2026-12-01", new Date(2027, 0, 1));
    expect(next).toBeNull();
  });
});

describe("reminderHref", () => {
  it("maps known entity types to their tab route", () => {
    expect(reminderHref("loan")).toBe("/loans");
    expect(reminderHref("investment")).toBe("/investments");
    expect(reminderHref("other_assets")).toBe("/other-assets");
    expect(reminderHref("other_asset")).toBe("/other-assets");
  });

  it("falls back to home for unknown or missing entity types", () => {
    expect(reminderHref(null)).toBe("/");
    expect(reminderHref("something-unrecognised")).toBe("/");
  });
});

describe("buildUpcomingItems", () => {
  const today = new Date(2026, 5, 18); // 18 Jun 2026
  const emptyData = {
    properties: [], loans: [], insurance: [], investments: [],
    savings: [], inventoryItems: [], reminders: [],
  };

  it("returns an empty array when there is no data", () => {
    expect(buildUpcomingItems(emptyData, today, 90)).toEqual([]);
  });

  it("includes an insurance premium due within the horizon", () => {
    const data = {
      ...emptyData,
      insurance: [{ id: "i1", name: "Term Life", start_date: "2025-07-01", frequency: "annual", end_date: null, premium: 1200, member_id: "m1" }],
    };
    const items = buildUpcomingItems(data, today, 90);
    expect(items.some((i) => i.sourceType === "insurance_next_due" && i.recordId === "i1")).toBe(true);
  });

  it("excludes an insurance premium that falls outside the horizon", () => {
    const data = {
      ...emptyData,
      // next occurrence is 2027-01-01 — well past a 90-day horizon from 18 Jun 2026
      insurance: [{ id: "i1", name: "Term Life", start_date: "2025-01-01", frequency: "annual", end_date: null, premium: 1200, member_id: "m1" }],
    };
    const items = buildUpcomingItems(data, today, 90);
    expect(items.some((i) => i.sourceType === "insurance_next_due")).toBe(false);
  });

  it("regression: only ILP/Endowment investments generate premium alerts, not regular investments", () => {
    const data = {
      ...emptyData,
      investments: [
        { id: "v1", name: "ILP Plan", group_name: "ILP (Investment-Linked Policy)", premium_start_date: "2025-07-01", premium_frequency: "annual", premium_end_date: null, premium_amount: 500, member_id: "m1" },
        { id: "v2", name: "Index Fund", group_name: "Stocks", premium_start_date: "2025-07-01", premium_frequency: "annual", premium_end_date: null, premium_amount: 500, member_id: "m1" },
      ],
    };
    const items = buildUpcomingItems(data, today, 90);
    expect(items.some((i) => i.recordId === "v1")).toBe(true);
    expect(items.some((i) => i.recordId === "v2")).toBe(false);
  });

  it("sorts items from every source together by date, ascending", () => {
    const data = {
      ...emptyData,
      loans: [{ id: "l1", bank: "DBS", reprice_date: "2026-08-01", member_id: "m1" }],
      savings: [{ id: "s1", institution: "OCBC", maturity_date: "2026-07-01", member_id: "m1", balance: 1000 }],
    };
    const items = buildUpcomingItems(data, today, 90);
    const dates = items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("maps a reminder's entity_type to the correct tab href", () => {
    const data = {
      ...emptyData,
      reminders: [{ id: "r1", what: "Renew passport", remind_at: "2026-07-01T00:00:00Z", entity_type: "property", entity_id: "p1" }],
    };
    const items = buildUpcomingItems(data, today, 90);
    const item = items.find((i) => i.sourceType === "reminder");
    expect(item?.href).toBe("/property");
  });
});
