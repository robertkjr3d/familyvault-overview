import { describe, it, expect } from "vitest";
import {
  assertInviteCapacity,
  makeInviteCounter,
  MAX_INVITES_PER_HOUSEHOLD_PER_DAY,
  MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS,
  type InviteCounter,
  type InviteTable,
} from "./inviteLimits";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const HOUSEHOLD = "11111111-1111-4111-8111-111111111111";

// A counter that returns fixed numbers: per-household-per-day, and everyone-per-hour.
function counter(
  day: Record<InviteTable, number>,
  hour: Record<InviteTable, number>,
): InviteCounter {
  return async (table, _since, householdId) => (householdId ? day[table] : hour[table]);
}
const none = { household_invites: 0, advisor_invites: 0 };

describe("assertInviteCapacity", () => {
  it("allows an invite when nothing has been sent", async () => {
    await expect(
      assertInviteCapacity(counter(none, none), HOUSEHOLD, NOW),
    ).resolves.toBeUndefined();
  });

  it("allows an invite just under both caps", async () => {
    const day = { household_invites: MAX_INVITES_PER_HOUSEHOLD_PER_DAY - 1, advisor_invites: 0 };
    const hour = { household_invites: MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS - 1, advisor_invites: 0 };
    await expect(assertInviteCapacity(counter(day, hour), HOUSEHOLD, NOW)).resolves.toBeUndefined();
  });

  it("blocks a household that has reached its daily cap", async () => {
    const day = { household_invites: MAX_INVITES_PER_HOUSEHOLD_PER_DAY, advisor_invites: 0 };
    await expect(assertInviteCapacity(counter(day, none), HOUSEHOLD, NOW)).rejects.toThrow(
      /tomorrow/,
    );
  });

  it("counts household and adviser invites together for the daily cap", async () => {
    const day = {
      household_invites: MAX_INVITES_PER_HOUSEHOLD_PER_DAY - 3,
      advisor_invites: 3,
    };
    await expect(assertInviteCapacity(counter(day, none), HOUSEHOLD, NOW)).rejects.toThrow(
      /tomorrow/,
    );
  });

  it("blocks everyone once the hourly cap across all households is reached", async () => {
    const hour = { household_invites: 5, advisor_invites: MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS - 5 };
    await expect(assertInviteCapacity(counter(none, hour), HOUSEHOLD, NOW)).rejects.toThrow(
      /in an hour/,
    );
  });

  it("keeps the hourly cap below the 30-an-hour auth email allowance so sign-in codes still get through", () => {
    expect(MAX_INVITES_PER_HOUR_ALL_HOUSEHOLDS).toBeLessThanOrEqual(15);
  });

  it("asks for the right time windows (24 hours for the household, 1 hour for everyone)", async () => {
    const calls: Array<{ table: string; since: string; household?: string }> = [];
    const spy: InviteCounter = async (table, since, household) => {
      calls.push({ table, since, household });
      return 0;
    };
    await assertInviteCapacity(spy, HOUSEHOLD, NOW);
    const day = calls.filter((c) => c.household === HOUSEHOLD);
    const hour = calls.filter((c) => c.household === undefined);
    expect(day.map((c) => c.table).sort()).toEqual(["advisor_invites", "household_invites"]);
    expect(hour.map((c) => c.table).sort()).toEqual(["advisor_invites", "household_invites"]);
    for (const c of day) expect(c.since).toBe("2026-11-11T10:00:00.000Z");
    for (const c of hour) expect(c.since).toBe("2026-11-12T09:00:00.000Z");
  });
});

describe("makeInviteCounter", () => {
  type Chain = {
    select: (...a: unknown[]) => Chain;
    gte: (...a: unknown[]) => Chain;
    eq: (...a: unknown[]) => Chain;
    then: (resolve: (v: unknown) => unknown) => unknown;
  };
  function fakeClient(result: { count: number | null; error: unknown }) {
    const log: Array<[string, ...unknown[]]> = [];
    const chain: Chain = {
      select: (...a) => (log.push(["select", ...a]), chain),
      gte: (...a) => (log.push(["gte", ...a]), chain),
      eq: (...a) => (log.push(["eq", ...a]), chain),
      then: (resolve) => resolve(result),
    };
    return { client: { from: (t: string) => (log.push(["from", t]), chain) }, log };
  }

  it("counts rows for one household since a time", async () => {
    const { client, log } = fakeClient({ count: 4, error: null });
    const n = await makeInviteCounter(client)(
      "household_invites",
      "2026-11-12T00:00:00.000Z",
      HOUSEHOLD,
    );
    expect(n).toBe(4);
    expect(log).toContainEqual(["from", "household_invites"]);
    expect(log).toContainEqual(["gte", "created_at", "2026-11-12T00:00:00.000Z"]);
    expect(log).toContainEqual(["eq", "household_id", HOUSEHOLD]);
  });

  it("does not filter by household when none is given", async () => {
    const { client, log } = fakeClient({ count: 2, error: null });
    await makeInviteCounter(client)("advisor_invites", "2026-11-12T00:00:00.000Z");
    expect(log.some((l) => l[0] === "eq")).toBe(false);
  });

  it("treats a missing count as zero", async () => {
    const { client } = fakeClient({ count: null, error: null });
    expect(await makeInviteCounter(client)("household_invites", "x")).toBe(0);
  });

  it("refuses to carry on if the count cannot be read (fails closed)", async () => {
    const { client } = fakeClient({ count: null, error: { message: "boom" } });
    await expect(makeInviteCounter(client)("household_invites", "x")).rejects.toThrow(
      /invite limit/,
    );
  });
});
