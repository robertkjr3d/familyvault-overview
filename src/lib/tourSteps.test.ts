import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CORE_TOUR_STEPS, EXTRAS_TOUR_STEPS } from "./tourSteps";

// Guards for the Sep 30 2026 tour fixes (step 3 pinned top-left on a slow
// first visit to Loans; tour ending mid-save on a slow save).

function targetsByRoute(steps: typeof CORE_TOUR_STEPS, startRoute: string | null) {
  const seen = new Map<string, string>(); // target -> route it was first used on
  const clashes: string[] = [];
  let route = startRoute;
  for (const step of steps) {
    route = step.route ?? route;
    if (!route) continue;
    const first = seen.get(step.target);
    if (first === undefined) seen.set(step.target, route);
    else if (first !== route) clashes.push(`${step.id}: "${step.target}" on ${route} and ${first}`);
  }
  return clashes;
}

describe("tour step targets", () => {
  it("core tour: no target name is used on two different pages", () => {
    expect(targetsByRoute(CORE_TOUR_STEPS, "/")).toEqual([]);
  });

  it("extras tour: no target name is used on two different pages", () => {
    expect(targetsByRoute(EXTRAS_TOUR_STEPS, null)).toEqual([]);
  });

  it("the Loans page gives its filter bar the exact name the tour looks for", () => {
    const step = CORE_TOUR_STEPS.find((s) => s.id === "member-confirm")!;
    expect(step.target).toBe("member-filter-loans");
    const loansPage = readFileSync("src/routes/loans.tsx", "utf8");
    expect(loansPage).toContain(`tourTarget="${step.target}"`);
  });
});

describe("tour steps that depend on something slow", () => {
  it("wait long enough for a first page load and for a slow save", () => {
    for (const id of ["member-confirm", "saved"]) {
      const step = CORE_TOUR_STEPS.find((s) => s.id === id)!;
      expect(step.waitForElement ?? 0).toBeGreaterThanOrEqual(10_000);
    }
  });
});

describe("steps that keep their highlight in step with the page", () => {
  it("the last step of tour 2 re-measures when the page around it changes size", () => {
    const last = EXTRAS_TOUR_STEPS[EXTRAS_TOUR_STEPS.length - 1];
    expect(last.id).toBe("upcoming");
    expect(last.trackLayout).toBe(true);
  });

  it("no other step opts in (keeps the extra re-measuring limited to where it is needed)", () => {
    const optedIn = [...CORE_TOUR_STEPS, ...EXTRAS_TOUR_STEPS]
      .filter((s) => s.trackLayout)
      .map((s) => s.id);
    expect(optedIn).toEqual(["upcoming"]);
  });

  it("the dashboard marks its Upcoming section with the name the step looks for", () => {
    const last = EXTRAS_TOUR_STEPS[EXTRAS_TOUR_STEPS.length - 1];
    const dashboard = readFileSync("src/routes/index.tsx", "utf8");
    expect(dashboard).toContain(`data-tour="${last.target}"`);
  });
});
