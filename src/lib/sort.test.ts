import { describe, expect, it } from "vitest";
import { RECORD_SORT_LABELS, sortByStatus, sortRecords } from "./sort";

type R = {
  id: string;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
const ids = (xs: R[]) => xs.map((x) => x.id);

const rows: R[] = [
  {
    id: "green-old",
    status: "settled",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-10-09T00:00:00Z",
  },
  {
    id: "red-new",
    status: "urgent",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
  },
  {
    id: "orange-mid",
    status: "review",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "red-old",
    status: "urgent",
    created_at: "2026-06-15T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z",
  },
];

describe("sortRecords - urgency (the default)", () => {
  it("is exactly the original sortByStatus order, red then orange then green", () => {
    expect(ids(sortRecords(rows, "urgency"))).toEqual(ids(sortByStatus(rows)));
    expect(sortRecords(rows, "urgency").map((r) => r.status)).toEqual([
      "urgent",
      "urgent",
      "review",
      "settled",
    ]);
  });

  it("matches sortByStatus on many random lists, including missing/odd statuses", () => {
    const statuses = ["urgent", "review", "settled", null, undefined, "weird"];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const list: R[] = Array.from({ length: Math.floor(rnd() * 12) }, (_, i) => ({
        id: `x${i}`,
        status: statuses[Math.floor(rnd() * statuses.length)],
        created_at: new Date(1.7e12 + rnd() * 1e10).toISOString(),
        updated_at: new Date(1.7e12 + rnd() * 1e10).toISOString(),
      }));
      expect(ids(sortRecords(list, "urgency"))).toEqual(ids(sortByStatus(list)));
    }
  });
});

describe("sortRecords - urgency groups same-named cards together", () => {
  type N = R & { institution?: string; account_type?: string; name?: string };
  const names = (xs: N[]) => xs.map((x) => x.id);

  it("all green: StanChart cards sit together, A to Z, not mixed with UOB", () => {
    const list: N[] = [
      { id: "sc1", status: "settled", institution: "StanChart", account_type: "Savings" },
      { id: "uob1", status: "settled", institution: "UOB", account_type: "Savings" },
      { id: "sc2", status: "settled", institution: "Standard Chartered", account_type: "Savings" },
      { id: "dbs", status: "settled", institution: "DBS", account_type: "Savings" },
      { id: "sc3", status: "settled", institution: "stanchart", account_type: "Savings" },
    ];
    // Case is ignored, so "StanChart" and "stanchart" count as the same bank and keep their
    // original order. "Standard Chartered" is spelled differently, so it is a different name
    // and lands just after them (it does NOT merge with StanChart).
    expect(names(sortRecords(list, "urgency"))).toEqual(["dbs", "sc1", "sc3", "sc2", "uob1"]);
  });

  it("colour still comes first: a red card goes above green ones", () => {
    const list: N[] = [
      { id: "g-a", status: "settled", institution: "Alpha" },
      { id: "r-z", status: "urgent", institution: "Zeta" },
      { id: "o-m", status: "review", institution: "Mid" },
    ];
    expect(names(sortRecords(list, "urgency"))).toEqual(["r-z", "o-m", "g-a"]);
  });

  it("uses name for tabs without institution/bank, numbers in natural order, blank names last", () => {
    const list: N[] = [
      { id: "blank", status: "settled", name: "" },
      { id: "p10", status: "settled", name: "Plan 10" },
      { id: "p2", status: "settled", name: "Plan 2" },
      { id: "a", status: "settled", name: "Aviva" },
    ];
    expect(names(sortRecords(list, "urgency"))).toEqual(["a", "p2", "p10", "blank"]);
  });

  it("does not change the input list", () => {
    const list: N[] = [
      { id: "b", status: "settled", name: "B" },
      { id: "a", status: "settled", name: "A" },
    ];
    sortRecords(list, "urgency");
    expect(names(list)).toEqual(["b", "a"]);
  });
});

describe("sortRecords - dates, newest first", () => {
  it("last edited: most recently edited card first", () => {
    expect(ids(sortRecords(rows, "edited"))).toEqual([
      "green-old",
      "orange-mid",
      "red-new",
      "red-old",
    ]);
  });

  it("date created: most recently created card first", () => {
    expect(ids(sortRecords(rows, "created"))).toEqual([
      "red-new",
      "orange-mid",
      "red-old",
      "green-old",
    ]);
  });

  it("gives the same cards back, none hidden or duplicated, and does not change the input", () => {
    const before = ids(rows);
    for (const mode of ["urgency", "edited", "created"] as const) {
      const out = sortRecords(rows, mode);
      expect(out).toHaveLength(rows.length);
      expect([...ids(out)].sort()).toEqual([...before].sort());
    }
    expect(ids(rows)).toEqual(before);
  });

  it("same edit time: falls back to newest created, then id, the same every time", () => {
    const tied: R[] = [
      { id: "b", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { id: "a", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { id: "c", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
    ];
    expect(ids(sortRecords(tied, "edited"))).toEqual(["c", "a", "b"]);
    expect(ids(sortRecords([...tied].reverse(), "edited"))).toEqual(["c", "a", "b"]);
  });

  it("same creation time: falls back to id", () => {
    const tied: R[] = [
      { id: "z", created_at: "2026-06-01T00:00:00Z" },
      { id: "m", created_at: "2026-06-01T00:00:00Z" },
    ];
    expect(ids(sortRecords(tied, "created"))).toEqual(["m", "z"]);
  });

  it("missing or unreadable dates count as oldest and never throw", () => {
    const odd: R[] = [
      { id: "none" },
      { id: "bad", updated_at: "not a date", created_at: null },
      { id: "ok", updated_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" },
    ];
    expect(ids(sortRecords(odd, "edited"))[0]).toBe("ok");
    expect(() => sortRecords(odd, "created")).not.toThrow();
    expect(sortRecords([], "edited")).toEqual([]);
  });
});

describe("labels", () => {
  it("never uses the word Updated, which already means 'figure last confirmed' on some cards", () => {
    for (const label of Object.values(RECORD_SORT_LABELS)) expect(label).not.toMatch(/updated/i);
    expect(RECORD_SORT_LABELS).toEqual({
      urgency: "Urgency",
      edited: "Last edited",
      created: "Date created",
    });
  });
});
