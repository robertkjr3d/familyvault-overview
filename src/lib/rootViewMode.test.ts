import { describe, it, expect } from "vitest";
import { computeRootViewMode } from "./rootViewMode";

const base = {
  initialized: true,
  hasSession: true,
  inviteCheckDone: true,
  membershipsLoading: false,
  membershipsCount: 0,
  advisorClientsLoading: false,
  advisorClientsCount: 0,
};

describe("computeRootViewMode", () => {
  it("shows loading before initialized", () => {
    expect(computeRootViewMode({ ...base, initialized: false })).toBe("loading");
  });

  it("shows sign-in with no session", () => {
    expect(computeRootViewMode({ ...base, hasSession: false })).toBe("sign-in");
  });

  it("shows loading while memberships are still loading", () => {
    expect(computeRootViewMode({ ...base, membershipsLoading: true })).toBe("loading");
  });

  it("shows family for an ordinary family user", () => {
    expect(computeRootViewMode({ ...base, membershipsCount: 1 })).toBe("family");
  });

  it("shows no-access for a signed-in user with nothing", () => {
    expect(computeRootViewMode(base)).toBe("no-access");
  });

  it("shows advisor-only for a pure-FA user (no family memberships) once their client count resolves", () => {
    expect(computeRootViewMode({ ...base, advisorClientsCount: 3 })).toBe("advisor-only");
  });

  it("shows loading (not no-access) for a pure-FA user while their client count is still loading", () => {
    expect(
      computeRootViewMode({ ...base, advisorClientsLoading: true, advisorClientsCount: null }),
    ).toBe("loading");
  });

  it("ignores wantsAdvisorView for a family-only user with no advisor clients", () => {
    expect(computeRootViewMode({ ...base, membershipsCount: 1, wantsAdvisorView: true })).toBe(
      "family",
    );
  });

  it("shows advisor-only for a dual-role user once both queries have resolved", () => {
    expect(
      computeRootViewMode({
        ...base,
        membershipsCount: 1,
        wantsAdvisorView: true,
        advisorClientsCount: 2,
      }),
    ).toBe("advisor-only");
  });

  it("REGRESSION (Aug 17, 2026): a dual-role user must NOT flash 'family' while the advisor-clients query is still loading — this was the real reported bug (Settings -> Advisor Dashboard briefly showed the home page)", () => {
    const result = computeRootViewMode({
      ...base,
      membershipsCount: 1,
      wantsAdvisorView: true,
      advisorClientsLoading: true,
      advisorClientsCount: null, // not yet resolved
    });
    expect(result).toBe("loading");
    expect(result).not.toBe("family");
  });

  it("a dual-role user who asked for the advisor view but genuinely has none falls back to family, not stuck loading", () => {
    expect(
      computeRootViewMode({
        ...base,
        membershipsCount: 1,
        wantsAdvisorView: true,
        advisorClientsLoading: false,
        advisorClientsCount: 0,
      }),
    ).toBe("family");
  });
});
