// Fails if someone removes the invite cap from an invite sender, or goes back to listing every
// account in the project when removing a member. Reads the source files, like serverFnGuard.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LIB = path.resolve(__dirname);
const read = (f: string) => readFileSync(path.join(LIB, f), "utf8");

// The text of one exported server function: from its `export const name =` to the next one.
function body(text: string, name: string): string {
  const start = text.indexOf(`export const ${name} =`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = text.indexOf("\nexport const ", start + 10);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("invite senders", () => {
  it.each([
    ["householdInvites.ts", "sendHouseholdInvite", "household_invites"],
    ["advisorAccess.ts", "sendAdvisorInvite", "advisor_invites"],
  ])("%s %s checks the invite cap before it writes anything", (file, fn, table) => {
    const text = body(read(file), fn);
    const cap = text.indexOf("assertInviteCapacity(");
    const insert = text.indexOf(`.from("${table}" as any)`);
    expect(cap).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(insert);
  });
});

describe("removeHouseholdMember", () => {
  const text = body(read("householdInvites.ts"), "removeHouseholdMember");
  it("does not list every account in the project", () => {
    expect(text).not.toMatch(/listUsers\(/);
  });
  it("looks people up among the household's own members", () => {
    expect(text).toMatch(/findMemberByEmail\(/);
  });
});
