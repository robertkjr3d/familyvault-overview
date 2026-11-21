// Guards the "Delete Demo Household" fix (22 Nov 2026). The household must be
// deleted while the person is still its owner. If their membership row is
// removed first, the database's clean-up trigger deletes the empty household by
// itself, the app's own delete then finds nothing, and a false "Nothing was
// deleted" error appears even though the household is gone (proved in a scratch
// database). Reads the source, like insertHouseholdGuard.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "settings.tsx"), "utf8");
const start = src.indexOf("async function deleteDemoHousehold()");
const end = src.indexOf("const currency = settings?.currency", start);
const body = src.slice(start, end);

describe("deleteDemoHousehold order", () => {
  it("found the function", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("never removes the person's membership before deleting the household", () => {
    const householdDelete = body.search(/\.from\("households" as any\)\s*\.delete\(\)/);
    expect(householdDelete).toBeGreaterThan(0);
    const before = body.slice(0, householdDelete);
    expect(before).not.toMatch(/\.from\("household_users" as any\)\s*\.delete\(\)/);
  });

  it("still reports a real failure when no household row comes back", () => {
    expect(body).toMatch(/\.select\("id"\)\s*\.maybeSingle\(\)/);
    expect(body).toContain("Nothing was deleted");
  });
});
