// Guard: every app insert into a household table must name its household.
//
// Why: 16 tables have `household_id DEFAULT default_household_id()`, which returns the signed-in
// user's FIRST household. An insert that leaves household_id out lands in that household, not the one
// on screen, whenever a user belongs to more than one. The app still says "added" but the row is in
// the wrong household and the list shows nothing (the "Item added but 0 items" bug, Nov 2026).
// This test fails if an insert into one of those tables does not mention household_id.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const schema = readFileSync("supabase/schema.sql", "utf8");
const defaultTables: string[] = [];
for (const m of schema.matchAll(/CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g)) {
  if (/household_id uuid DEFAULT default_household_id\(\)/.test(m[2])) defaultTables.push(m[1]);
}

describe("inserts into household tables name their household", () => {
  it("finds the tables that rely on the default", () => {
    expect(defaultTables.length).toBeGreaterThan(10);
    expect(defaultTables).toContain("inventory_items");
  });

  const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
  it("every insert includes household_id", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const table of defaultTables) {
        const re = new RegExp(`from\\(\\s*["']${table}["']\\s*\\)\\s*\\.insert\\(`, "g");
        for (const m of text.matchAll(re)) {
          const start = Math.max(0, (m.index ?? 0) - 600);
          const window = text.slice(start, (m.index ?? 0) + 900);
          if (!window.includes("household_id")) {
            const line = text.slice(0, m.index).split("\n").length;
            offenders.push(`${f}:${line} (${table})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
