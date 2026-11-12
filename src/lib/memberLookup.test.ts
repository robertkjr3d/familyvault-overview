import { describe, it, expect } from "vitest";
import { findMemberByEmail, normalizeMemberEmail } from "./memberLookup";

const emails: Record<string, string | null> = {
  a: "Owner@Example.com",
  b: "  member@example.com ",
  c: null,
};
const getEmail = async (id: string) => emails[id] ?? null;

describe("findMemberByEmail", () => {
  it("finds a member ignoring case and spaces", async () => {
    expect(await findMemberByEmail(["a", "b", "c"], "MEMBER@example.com", getEmail)).toBe("b");
    expect(await findMemberByEmail(["a", "b", "c"], " owner@example.com ", getEmail)).toBe("a");
  });

  it("returns null for an address that is not a member (and says nothing about other accounts)", async () => {
    expect(await findMemberByEmail(["a", "b"], "stranger@example.com", getEmail)).toBeNull();
  });

  it("returns null for an empty address", async () => {
    expect(await findMemberByEmail(["a", "b"], "   ", getEmail)).toBeNull();
  });

  it("copes with a member that has no email", async () => {
    expect(await findMemberByEmail(["c"], "x@example.com", getEmail)).toBeNull();
  });

  it("does not depend on how many users exist elsewhere: it only looks up the ids it is given", async () => {
    const asked: string[] = [];
    const spy = async (id: string) => (
      asked.push(id),
      id === "user-199" ? "target@example.com" : `u${id}@example.com`
    );
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    expect(await findMemberByEmail(ids, "target@example.com", spy)).toBe("user-199");
    expect(asked).toHaveLength(200);
  });

  it("lets a lookup failure through instead of hiding it", async () => {
    const failing = async () => {
      throw new Error("lookup failed");
    };
    await expect(findMemberByEmail(["a"], "x@example.com", failing)).rejects.toThrow(
      "lookup failed",
    );
  });
});

describe("normalizeMemberEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeMemberEmail("  A@B.com ")).toBe("a@b.com");
  });
});
