import { describe, expect, it } from "vitest";
import { buildRecentList, timeAgo, RECENT_LIMIT } from "./recentChanges";

const src = [
  { key: "loans", title: (r: any) => `${r.bank} · ${r.purpose ?? ""}` },
  { key: "investments", title: (r: any) => r.name },
];
const iso = (s: string) => new Date(s).toISOString();

describe("buildRecentList", () => {
  it("merges tables and sorts newest first", () => {
    const list = buildRecentList(src, {
      loans: [
        {
          id: "l1",
          bank: "DBS",
          purpose: "Car",
          updated_at: iso("2026-10-01T10:00:00Z"),
          created_at: iso("2026-09-01T10:00:00Z"),
        },
      ],
      investments: [
        {
          id: "i1",
          name: "Fund A",
          updated_at: iso("2026-10-02T09:00:00Z"),
          created_at: iso("2026-08-01T00:00:00Z"),
        },
        {
          id: "i2",
          name: "Fund B",
          updated_at: iso("2026-09-15T09:00:00Z"),
          created_at: iso("2026-08-01T00:00:00Z"),
        },
      ],
    });
    expect(list.map((e) => e.row.id)).toEqual(["i1", "l1", "i2"]);
    expect(list[1].title).toBe("DBS · Car");
  });

  it("flags never-edited records as new, and edited ones as not new", () => {
    const [a, b] = buildRecentList(src, {
      investments: [
        {
          id: "n",
          name: "New",
          updated_at: "2026-10-02T09:00:00.500Z",
          created_at: "2026-10-02T09:00:00.100Z",
        },
        {
          id: "e",
          name: "Edited",
          updated_at: "2026-10-01T09:00:00Z",
          created_at: "2026-09-01T09:00:00Z",
        },
      ],
    });
    expect([a.isNew, b.isNew]).toEqual([true, false]);
  });

  it("skips rows with a missing or invalid date, and handles missing tables", () => {
    const list = buildRecentList(src, {
      investments: [
        { id: "x", name: "No date" },
        { id: "y", name: "Bad", updated_at: "nonsense" },
        { id: "z", name: "OK", updated_at: iso("2026-10-01T00:00:00Z") },
      ],
    });
    expect(list.map((e) => e.row.id)).toEqual(["z"]);
  });

  it("uses a placeholder for blank titles and never throws on null titles", () => {
    const list = buildRecentList([{ key: "investments", title: () => null as any }], {
      investments: [{ id: "a", updated_at: iso("2026-10-01T00:00:00Z") }],
    });
    expect(list[0].title).toBe("(untitled)");
  });

  it("caps the list and keeps a stable order for equal timestamps", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: `r${String(i).padStart(2, "0")}`,
      name: "n",
      updated_at: iso("2026-10-01T00:00:00Z"),
    }));
    const a = buildRecentList(src, { investments: rows });
    const b = buildRecentList(src, { investments: [...rows].reverse() });
    expect(a).toHaveLength(RECENT_LIMIT);
    expect(a.map((e) => e.row.id)).toEqual(b.map((e) => e.row.id));
  });

  it("returns an empty list when nothing is loaded", () => {
    expect(buildRecentList(src, {})).toEqual([]);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  it("formats each range", () => {
    expect(timeAgo(now - 20_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3 hr ago");
    expect(timeAgo(now - 30 * 3_600_000, now)).toBe("Yesterday");
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe("4 days ago");
    expect(timeAgo(Date.parse("2026-09-01T12:00:00Z"), now)).toMatch(/^1 Sep\w* 2026$/);
  });
  it("never shows negative time if the phone clock is behind the server", () => {
    expect(timeAgo(now + 5 * 60_000, now)).toBe("just now");
  });
});
