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
