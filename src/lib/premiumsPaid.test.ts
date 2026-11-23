/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { countPremiumPayments, effectiveInvested, isPremiumPolicyGroup } from "@/lib/premiumsPaid";
import { computeRecurringAlerts } from "@/lib/alerts";

// Real rows can hold odd values (text amounts, unknown words); tests feed those in on purpose.
const eff = (inv: any, today?: Date) => effectiveInvested(inv, today);

const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const ILP = "ILP (Investment-Linked Policy)";

describe("countPremiumPayments: the basic rules", () => {
  it("counts the first payment on the start date itself", () => {
    expect(countPremiumPayments("2025-01-15", "monthly", null, d("2025-01-15"))).toBe(1);
  });
  it("is 0 the day before the start date and when the start is in the future", () => {
    expect(countPremiumPayments("2025-01-15", "monthly", null, d("2025-01-14"))).toBe(0);
    expect(countPremiumPayments("2027-06-01", "monthly", null, d("2026-11-22"))).toBe(0);
  });
  it("counts a payment due today", () => {
    expect(countPremiumPayments("2025-01-22", "monthly", null, d("2026-11-22"))).toBe(23);
  });
  it("does not count a payment due tomorrow", () => {
    expect(countPremiumPayments("2025-01-23", "monthly", null, d("2026-11-22"))).toBe(22);
  });
  it("the worked example: 1 Jan 2025 monthly, on 22 Nov 2026 = 23 payments", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", null, d("2026-11-22"))).toBe(23);
  });
  it("quarterly, semi-annual and annual", () => {
    expect(countPremiumPayments("2025-01-01", "quarterly", null, d("2026-11-22"))).toBe(8); // Jan Apr Jul Oct x2
    expect(countPremiumPayments("2025-01-01", "semi-annual", null, d("2026-11-22"))).toBe(4); // Jan Jul x2
    expect(countPremiumPayments("2025-01-01", "annual", null, d("2026-11-22"))).toBe(2); // Jan 25, Jan 26
  });
  it("a blank or missing frequency means annual (same as the rest of the app)", () => {
    expect(countPremiumPayments("2025-01-01", null, null, d("2026-11-22"))).toBe(2);
    expect(countPremiumPayments("2025-01-01", "", null, d("2026-11-22"))).toBe(2);
    expect(countPremiumPayments("2025-01-01", undefined, null, d("2026-11-22"))).toBe(2);
  });
  it("is not case sensitive", () => {
    expect(countPremiumPayments("2025-01-01", "MONTHLY", null, d("2026-11-22"))).toBe(23);
  });
  it("ignores the time of day of 'today'", () => {
    expect(
      countPremiumPayments("2025-01-22", "monthly", null, new Date(2026, 10, 22, 0, 0, 1)),
    ).toBe(23);
    expect(
      countPremiumPayments("2025-01-22", "monthly", null, new Date(2026, 10, 22, 23, 59, 59)),
    ).toBe(23);
  });
});

describe("countPremiumPayments: end date", () => {
  it("stops at the end date and counts a payment that falls on it", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", "2025-06-01", d("2026-11-22"))).toBe(6);
  });
  it("an end date between two payments does not add the next payment", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", "2025-06-15", d("2026-11-22"))).toBe(6);
  });
  it("a future end date does not matter yet", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", "2030-01-01", d("2026-11-22"))).toBe(23);
  });
  it("end date today still counts today's payment", () => {
    expect(countPremiumPayments("2025-01-22", "monthly", "2026-11-22", d("2026-11-22"))).toBe(23);
  });
  it("end date on the start date = exactly one payment", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", "2025-01-01", d("2026-11-22"))).toBe(1);
  });
  it("end before start is bad data: cannot estimate", () => {
    expect(countPremiumPayments("2025-06-01", "monthly", "2025-01-01", d("2026-11-22"))).toBeNull();
  });
  it("an unreadable end date is not guessed", () => {
    expect(countPremiumPayments("2025-01-01", "monthly", "soon", d("2026-11-22"))).toBeNull();
  });
});

describe("countPremiumPayments: month ends follow the reminder rule", () => {
  it("31 Jan monthly: 31 Jan, 28 Feb, 31 Mar, 30 Apr ...", () => {
    // by 31 Mar 2026: Jan 31, Feb 28, Mar 31 = 3
    expect(countPremiumPayments("2026-01-31", "monthly", null, d("2026-03-31"))).toBe(3);
    // the day before 31 Mar the March payment is not yet due
    expect(countPremiumPayments("2026-01-31", "monthly", null, d("2026-03-30"))).toBe(2);
    // 28 Feb is a payment date (Feb has no 31st)
    expect(countPremiumPayments("2026-01-31", "monthly", null, d("2026-02-28"))).toBe(2);
    expect(countPremiumPayments("2026-01-31", "monthly", null, d("2026-02-27"))).toBe(1);
    // April has 30 days: 30 Apr is the payment date
    expect(countPremiumPayments("2026-01-31", "monthly", null, d("2026-04-30"))).toBe(4);
  });
  it("29 Feb start in a leap year: next annual payment is 28 Feb, then back to 29 Feb in 2028", () => {
    expect(countPremiumPayments("2024-02-29", "annual", null, d("2025-02-27"))).toBe(1);
    expect(countPremiumPayments("2024-02-29", "annual", null, d("2025-02-28"))).toBe(2);
    expect(countPremiumPayments("2024-02-29", "annual", null, d("2028-02-28"))).toBe(4);
    expect(countPremiumPayments("2024-02-29", "annual", null, d("2028-02-29"))).toBe(5);
  });
});

describe("countPremiumPayments: cannot be estimated", () => {
  it("no start date", () => {
    expect(countPremiumPayments(null, "monthly", null, d("2026-11-22"))).toBeNull();
    expect(countPremiumPayments("", "monthly", null, d("2026-11-22"))).toBeNull();
  });
  it("impossible or unreadable start dates", () => {
    expect(countPremiumPayments("2025-02-31", "monthly", null, d("2026-11-22"))).toBeNull();
    expect(countPremiumPayments("not a date", "monthly", null, d("2026-11-22"))).toBeNull();
  });
  it("one-off and unrecognised frequencies", () => {
    expect(countPremiumPayments("2025-01-01", "one-off", null, d("2026-11-22"))).toBeNull();
    expect(countPremiumPayments("2025-01-01", "weekly", null, d("2026-11-22"))).toBeNull();
    expect(countPremiumPayments("2025-01-01", "yearly", null, d("2026-11-22"))).toBeNull();
  });
});

// An independent way of working out the same thing, written differently (compare
// "year*10000+month*100+day" numbers, own days-in-month table) so a mistake in
// one is unlikely to be repeated in the other.
function referenceCount(start: string, freq: string, end: string | null, today: string): number {
  const months = { monthly: 1, quarterly: 3, "semi-annual": 6, annual: 12 }[freq]!;
  const [sy, sm, sd] = start.split("-").map(Number);
  const key = (s: string) => {
    const [y, m, day] = s.split("-").map(Number);
    return y * 10000 + m * 100 + day;
  };
  const dim = (y: number, m: number) =>
    [
      31,
      y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ][m - 1];
  const limit = Math.min(key(today), end ? key(end) : Infinity);
  let n = 0;
  for (let k = 0; ; k++) {
    const total = sm - 1 + k * months;
    const y = sy + Math.floor(total / 12);
    const m = (total % 12) + 1;
    const day = Math.min(sd, dim(y, m));
    if (y * 10000 + m * 100 + day > limit) break;
    n++;
    if (k > 5000) throw new Error("runaway");
  }
  return n;
}

function randomDate(rng: () => number, fromY: number, toY: number): string {
  const y = fromY + Math.floor(rng() * (toY - fromY + 1));
  const m = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 31);
  const maxDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, maxDay)).padStart(2, "0")}`;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("countPremiumPayments: matches an independent calculation", () => {
  it("5,000 random schedules agree (every frequency, with and without end dates, month ends, leap days)", () => {
    const rng = mulberry32(20261122);
    const freqs = ["monthly", "quarterly", "semi-annual", "annual"];
    let compared = 0;
    for (let i = 0; i < 5000; i++) {
      const start = randomDate(rng, 2000, 2026);
      const freq = freqs[Math.floor(rng() * freqs.length)];
      const today = randomDate(rng, 2000, 2032);
      let end: string | null = null;
      if (rng() < 0.5) {
        end = randomDate(rng, 2000, 2040);
        if (end < start) continue; // bad data is covered by its own test
      }
      const got = countPremiumPayments(start, freq, end, d(today));
      expect(got, `${start} ${freq} end=${end} today=${today}`).toBe(
        referenceCount(start, freq, end, today),
      );
      compared++;
    }
    expect(compared).toBeGreaterThan(3500);
  });
});

// The reminder code is the app's own definition of "when is a premium due". Its
// due dates must be the very days on which this count goes up by one.
const negativeOffsetZone = new Date().getTimezoneOffset() > 0;
describe.skipIf(negativeOffsetZone)(
  "countPremiumPayments: agrees with the premium reminders (alerts.ts)",
  () => {
    it("every due date the reminders produce is a day the count steps up by exactly one", () => {
      const rng = mulberry32(777);
      const freqs = ["monthly", "quarterly", "semi-annual", "annual"];
      let checked = 0;
      for (let i = 0; i < 400; i++) {
        const start = randomDate(rng, 2022, 2026);
        const freq = freqs[Math.floor(rng() * freqs.length)];
        const today = d(randomDate(rng, 2025, 2027));
        const occ = computeRecurringAlerts(start, freq, null, today, 400, false);
        for (const o of occ) {
          const dueDay = d(o.date);
          const dayBefore = new Date(dueDay.getFullYear(), dueDay.getMonth(), dueDay.getDate() - 1);
          const onDay = countPremiumPayments(start, freq, null, dueDay)!;
          const before = countPremiumPayments(start, freq, null, dayBefore)!;
          expect(onDay - before, `${start} ${freq} due ${o.date}`).toBe(1);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(300);
    });
  },
);

describe("effectiveInvested: Manual mode is exactly as before", () => {
  it("returns the stored Amount invested untouched, whatever it is", () => {
    for (const cost of [5000, 0, null, undefined, "1200.50"]) {
      const r = eff({
        group_name: ILP,
        cost_basis: cost,
        premium_amount: 500,
        premium_start_date: "2025-01-01",
        premium_frequency: "monthly",
      });
      expect(r.mode).toBe("manual");
      expect(r.amount).toBe(cost);
    }
  });
  it("a missing or unknown tracking value is Manual (e.g. rows saved before this feature)", () => {
    const base = {
      group_name: ILP,
      cost_basis: 100,
      premium_amount: 500,
      premium_start_date: "2025-01-01",
      premium_frequency: "monthly",
    };
    expect(eff({ ...base }).mode).toBe("manual");
    expect(eff({ ...base, invested_tracking: null }).mode).toBe("manual");
    expect(eff({ ...base, invested_tracking: "manual" }).mode).toBe("manual");
    expect(eff({ ...base, invested_tracking: "banana" }).mode).toBe("manual");
  });
  it("works on non-policy investments and on empty input", () => {
    expect(eff({ group_name: "Stocks", cost_basis: 42 })).toEqual({
      amount: 42,
      mode: "manual",
    });
    expect(eff(null).mode).toBe("manual");
    expect(eff(undefined).amount).toBeUndefined();
  });
});

describe("effectiveInvested: Estimated mode", () => {
  const today = d("2026-11-22");
  const policy = {
    group_name: ILP,
    invested_tracking: "estimated",
    cost_basis: 99999,
    current_value: 12345,
    premium_amount: 1000,
    premium_start_date: "2025-01-01",
    premium_frequency: "monthly",
    premium_end_date: null,
  };
  it("premium x payments, e.g. $1,000 monthly from 1 Jan 2025 = 23 payments = $23,000", () => {
    expect(eff(policy, today)).toEqual({
      amount: 23000,
      mode: "estimated",
      payments: 23,
    });
  });
  it("uses the premium end date", () => {
    expect(eff({ ...policy, premium_end_date: "2025-12-01" }, today).amount).toBe(12000);
  });
  it("works for an Endowment as well", () => {
    expect(eff({ ...policy, group_name: "Endowment" }, today).amount).toBe(23000);
  });
  it("a policy that starts in the future has paid nothing yet (0, not a fallback)", () => {
    expect(eff({ ...policy, premium_start_date: "2027-03-01" }, today)).toEqual({
      amount: 0,
      mode: "estimated",
      payments: 0,
    });
  });
  it("keeps cents tidy", () => {
    const r = eff({ ...policy, premium_amount: 833.33 }, today);
    expect(r.amount).toBe(19166.59);
  });
  it("accepts a premium that arrives as text", () => {
    expect(eff({ ...policy, premium_amount: "1000" }, today).amount).toBe(23000);
  });
  it("never changes the record: the typed Amount invested and the value are left alone", () => {
    const copy = JSON.parse(JSON.stringify(policy));
    eff(policy, today);
    expect(policy).toEqual(copy);
    expect(policy.cost_basis).toBe(99999);
    expect(policy.current_value).toBe(12345);
  });
  it("the result does not depend on the current value", () => {
    expect(eff({ ...policy, current_value: 1 }, today).amount).toBe(
      eff({ ...policy, current_value: 9e9 }, today).amount,
    );
  });
});

describe("effectiveInvested: cannot estimate falls back to the typed figure", () => {
  const today = d("2026-11-22");
  const base = {
    group_name: ILP,
    invested_tracking: "estimated",
    cost_basis: 7777,
    premium_amount: 1000,
    premium_start_date: "2025-01-01",
    premium_frequency: "monthly",
  };
  it.each([
    ["no premium amount", { premium_amount: null }],
    ["zero premium", { premium_amount: 0 }],
    ["negative premium", { premium_amount: -5 }],
    ["premium is not a number", { premium_amount: "abc" }],
    ["no start date", { premium_start_date: null }],
    ["one-off premium", { premium_frequency: "one-off" }],
    ["unrecognised frequency", { premium_frequency: "weekly" }],
    ["end before start", { premium_end_date: "2024-01-01" }],
  ])("%s", (_label, change) => {
    const r = eff({ ...base, ...change }, today);
    expect(r.mode).toBe("fallback");
    expect(r.amount).toBe(7777);
  });
  it("fallback with no typed figure stays empty (not 0)", () => {
    const r = eff({ ...base, premium_amount: null, cost_basis: null }, today);
    expect(r.mode).toBe("fallback");
    expect(r.amount).toBeNull();
  });
});

describe("effectiveInvested: only for ILP and Endowment", () => {
  it("a stale 'estimated' on a record whose type was later changed to something else is ignored", () => {
    const r = eff(
      {
        group_name: "Stocks",
        invested_tracking: "estimated",
        cost_basis: 500,
        premium_amount: 100,
        premium_start_date: "2025-01-01",
        premium_frequency: "monthly",
      },
      d("2026-11-22"),
    );
    expect(r).toEqual({ amount: 500, mode: "manual" });
  });
  it("isPremiumPolicyGroup", () => {
    expect(isPremiumPolicyGroup(ILP)).toBe(true);
    expect(isPremiumPolicyGroup("Endowment")).toBe(true);
    expect(isPremiumPolicyGroup("Stocks")).toBe(false);
    expect(isPremiumPolicyGroup(null)).toBe(false);
  });
});

// The form field, the database column and this calculation must agree on the two words.
import { INVESTED_TRACKING_ESTIMATED, INVESTED_TRACKING_MANUAL } from "@/lib/premiumsPaid";
import { recordConfigs } from "@/lib/recordConfigs";

describe("the 'Amount invested: manual or estimated' form field", () => {
  const field = (recordConfigs as any).investments.fields.find(
    (f: any) => f.key === "invested_tracking",
  );
  it("exists, is a select, and offers exactly the two words the database allows", () => {
    expect(field).toBeTruthy();
    expect(field.type).toBe("select");
    expect(field.options.map((o: any) => o.value)).toEqual(["manual", "estimated"]);
    expect(INVESTED_TRACKING_MANUAL).toBe("manual");
    expect(INVESTED_TRACKING_ESTIMATED).toBe("estimated");
  });
  it("new records start as Manual", () => {
    expect(field.default).toBe("manual");
  });
  it("is only offered for ILP and Endowment", () => {
    expect(field.showIf({ group_name: ILP })).toBe(true);
    expect(field.showIf({ group_name: "Endowment" })).toBe(true);
    expect(field.showIf({ group_name: "Stocks" })).toBe(false);
    expect(field.showIf({})).toBe(false);
  });
  it("is not required (a blank choice means Manual)", () => {
    expect(field.required).toBeFalsy();
  });
});
