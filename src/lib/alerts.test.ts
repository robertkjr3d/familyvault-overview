import { describe, it, expect } from "vitest";
import { computeNextOccurrence, computeRecurringAlerts, buildUpcomingItems, reminderHref } from "./alerts";

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

describe("computeRecurringAlerts", () => {
  const today = new Date(2026, 5, 18); // 18 Jun 2026

  it("returns the upcoming occurrence, not overdue, when the due date hasn't passed yet", () => {
    const result = computeRecurringAlerts("2025-07-01", "annual", null, today, 90, false);
    expect(result).toEqual([{ date: "2026-07-01", overdue: false }]);
  });

  it("regression: the exact reported bug — an annual premium 1 day overdue must NOT silently jump to next year; it stays overdue", () => {
    // due 17 Jun 2026, "today" is 18 Jun 2026 — one day overdue
    const result = computeRecurringAlerts("2018-06-17", "annual", null, today, 90, false);
    expect(result).toEqual([{ date: "2026-06-17", overdue: true }]);
  });

  it("a policy neglected for years still shows exactly ONE overdue line — the latest missed occurrence, not one per missed year", () => {
    // today is 1 Aug 2026 — well after the 2026-07-17 due date, and the next
    // occurrence (2027-07-17) is far outside a 90-day horizon
    const laterToday = new Date(2026, 7, 1);
    const result = computeRecurringAlerts("2018-07-17", "annual", null, laterToday, 90, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-07-17", overdue: true });
  });

  it("GIRO items never go overdue — a missed occurrence is silently skipped, and the next upcoming one shows normally", () => {
    // last occurrence 2026-01-17 (passed, but GIRO), next occurrence 2027-01-17 (outside 90-day horizon)
    const result = computeRecurringAlerts("2018-01-17", "annual", null, today, 90, true);
    expect(result).toEqual([]);
  });

  it("GIRO items still show upcoming occurrences within the horizon, same as non-GIRO", () => {
    const result = computeRecurringAlerts("2025-07-01", "annual", null, today, 90, true);
    expect(result).toEqual([{ date: "2026-07-01", overdue: false }]);
  });

  it("a monthly premium shows every upcoming occurrence within the horizon, plus the current overdue one if unpaid", () => {
    const result = computeRecurringAlerts("2026-01-10", "monthly", null, today, 90, false);
    // from 18 Jun 2026: Jun 10 is already 8 days overdue (unpaid); within 90 days
    // (~16 Sep 2026) the upcoming ones are Jul 10, Aug 10, Sep 10
    expect(result).toEqual([
      { date: "2026-06-10", overdue: true },
      { date: "2026-07-10", overdue: false },
      { date: "2026-08-10", overdue: false },
      { date: "2026-09-10", overdue: false },
    ]);
  });

  it("a monthly premium overdue by a few days shows the overdue one AND still lists upcoming future months", () => {
    // due dates land on the 15th; today is 18 Jun, so 15 Jun is 3 days overdue
    const result = computeRecurringAlerts("2026-01-15", "monthly", null, today, 60, false);
    expect(result[0]).toEqual({ date: "2026-06-15", overdue: true });
    expect(result.some((r) => r.date === "2026-07-15" && !r.overdue)).toBe(true);
  });

  it("respects the end date — no occurrences at all once the schedule has fully ended", () => {
    expect(computeRecurringAlerts("2020-01-01", "annual", "2025-01-01", today, 90, false)).toEqual([]);
  });

  it("respects the end date mid-schedule — stops generating occurrences past it, even for upcoming ones", () => {
    const result = computeRecurringAlerts("2026-01-01", "monthly", "2026-07-20", today, 90, false);
    expect(result.every((r) => r.date <= "2026-07-20")).toBe(true);
  });

  it("returns an empty array for a one-off frequency — nothing recurring to alert about", () => {
    expect(computeRecurringAlerts("2024-01-01", "one-off", null, today, 90, false)).toEqual([]);
  });

  it("returns an empty array when there is no start date", () => {
    expect(computeRecurringAlerts(null, "monthly", null, today, 90, false)).toEqual([]);
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

  it("a non-GIRO insurance premium that's overdue by months stays visible as overdue, instead of being silently hidden (this was the actual production bug — see computeRecurringAlerts)", () => {
    const data = {
      ...emptyData,
      // last occurrence was 2026-01-01 — over 5 months overdue relative to today (18 Jun 2026),
      // and the next occurrence (2027-01-01) is far outside a 90-day horizon
      insurance: [{ id: "i1", name: "Term Life", start_date: "2025-01-01", frequency: "annual", end_date: null, premium: 1200, member_id: "m1" }],
    };
    const items = buildUpcomingItems(data, today, 90);
    const overdueItem = items.find((i) => i.sourceType === "insurance_next_due" && i.recordId === "i1");
    expect(overdueItem).toBeDefined();
    expect(overdueItem?.overdue).toBe(true);
    expect(overdueItem?.date).toBe("2026-01-01");
    expect(overdueItem?.daysLeft).toBeLessThan(0);
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

describe("buildUpcomingItems — per-category day thresholds", () => {
  const today = new Date(2026, 5, 18); // 18 Jun 2026
  const emptyData = {
    properties: [], loans: [], insurance: [], investments: [],
    savings: [], inventoryItems: [], reminders: [],
  };

  it("omitting categoryDays entirely behaves exactly like before (no 4th arg)", () => {
    const data = {
      ...emptyData,
      savings: [{ id: "s1", institution: "OCBC", maturity_date: "2026-08-15", member_id: "m1", balance: 1000 }],
    };
    expect(buildUpcomingItems(data, today, 90).some((i) => i.recordId === "s1")).toBe(true);
  });

  it("a category threshold narrows the window — an FD maturing in 80 days is excluded once fd_days is set to 30", () => {
    const data = {
      ...emptyData,
      savings: [{ id: "s1", institution: "OCBC", maturity_date: "2026-09-06", member_id: "m1", balance: 1000 }], // 80 days out
    };
    const withoutThreshold = buildUpcomingItems(data, today, 90);
    expect(withoutThreshold.some((i) => i.recordId === "s1")).toBe(true);

    const withThreshold = buildUpcomingItems(data, today, 90, { fd_days: 30 });
    expect(withThreshold.some((i) => i.recordId === "s1")).toBe(false);
  });

  it("a category threshold cannot widen a view's horizon beyond what the view itself allows (e.g. the 30-day bell stays 30 days even if insurance_days is set to 90)", () => {
    const data = {
      ...emptyData,
      insurance: [{ id: "i1", name: "Term Life", start_date: "2026-08-01", frequency: "annual", end_date: null, premium: 1200, member_id: "m1" }], // ~44 days out
    };
    const items = buildUpcomingItems(data, today, 30, { insurance_days: 90 });
    expect(items.some((i) => i.recordId === "i1")).toBe(false);
  });

  it("category thresholds only affect their own category — a tight fd_days does not also hide insurance", () => {
    const data = {
      ...emptyData,
      savings: [{ id: "s1", institution: "OCBC", maturity_date: "2026-09-06", member_id: "m1", balance: 1000 }], // 80 days out
      insurance: [{ id: "i1", name: "Term Life", start_date: "2026-08-01", frequency: "annual", end_date: null, premium: 1200, member_id: "m1" }], // ~44 days out
    };
    const items = buildUpcomingItems(data, today, 90, { fd_days: 14 });
    expect(items.some((i) => i.recordId === "s1")).toBe(false);
    expect(items.some((i) => i.recordId === "i1")).toBe(true);
  });

  it("categories without a configurable setting (investments, reminders) always use the base horizonDays, unaffected by other category overrides", () => {
    const data = {
      ...emptyData,
      investments: [{ id: "v1", name: "ILP Plan", group_name: "ILP (Investment-Linked Policy)", premium_start_date: "2026-08-01", premium_frequency: "annual", premium_end_date: null, premium_amount: 500, member_id: "m1" }],
    };
    const items = buildUpcomingItems(data, today, 90, { fd_days: 7, insurance_days: 7, mortgage_days: 7, warranty_days: 7 });
    expect(items.some((i) => i.recordId === "v1")).toBe(true);
  });

  it("a null category override is treated the same as not providing one", () => {
    const data = {
      ...emptyData,
      savings: [{ id: "s1", institution: "OCBC", maturity_date: "2026-08-15", member_id: "m1", balance: 1000 }],
    };
    const items = buildUpcomingItems(data, today, 90, { fd_days: null });
    expect(items.some((i) => i.recordId === "s1")).toBe(true);
  });
});

describe("timezone independence (regression, Aug 17 2026)", () => {
  // REAL PRODUCTION BUG: dates were built with a local Date constructor but
  // serialized via .toISOString().slice(0, 10) — a UTC round-trip. The
  // household dashboard runs client-side (the user's own timezone, e.g.
  // Asia/Singapore); the advisor dashboard runs the identical function
  // server-side on Cloudflare Workers (UTC). For the same premium, the two
  // produced different calendar-date strings, which silently broke
  // dismissal-key matching between the household's own view and the FA's
  // view of the exact same alert (confirmed via a real dismissed_dashboard_items
  // row: household recorded 2026-07-16, FA dashboard showed 17 Jul 2026 for
  // the same record). These tests snapshot the exact known-bad case and
  // don't depend on the machine's actual TZ, so they stay meaningful in CI.
  const REPORTED_BUG_START = "2025-07-17";
  const REPORTED_BUG_TODAY = new Date(2026, 6, 18); // 18 Jul 2026, local

  it("computeNextOccurrence for the reported real case lands on the 17th, not the 16th", () => {
    // 2026-07-17 has already passed relative to "today" (18 Jul 2026), so the
    // NEXT upcoming occurrence is a year later — the day-of-month is what
    // this test is really checking, and the bug shifted it to the 16th.
    const next = computeNextOccurrence(REPORTED_BUG_START, "annual", null, REPORTED_BUG_TODAY);
    expect(next).toBe("2027-07-17");
  });

  it("computeRecurringAlerts' overdue occurrence for the reported real case is dated the 17th, not the 16th", () => {
    const occurrences = computeRecurringAlerts(
      REPORTED_BUG_START,
      "annual",
      null,
      REPORTED_BUG_TODAY,
      30,
      false,
    );
    const overdue = occurrences.find((o) => o.overdue);
    expect(overdue?.date).toBe("2026-07-17");
  });

  it("a date landing on the 1st of a month is not pushed back to the last day of the previous month", () => {
    // The specific case a UTC round-trip breaks hardest: local midnight on the
    // 1st converts to the previous day in any timezone behind UTC.
    const next = computeNextOccurrence("2025-08-01", "monthly", null, new Date(2026, 6, 15));
    expect(next).toBe("2026-08-01");
  });
});
