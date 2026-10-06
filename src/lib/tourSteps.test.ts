import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CORE_TOUR_STEPS, EXTRAS_TOUR_STEPS, tourSelector } from "./tourSteps";

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

describe("card steps aim at the card the tour created (Oct 5 2026)", () => {
  const all = [...CORE_TOUR_STEPS, ...EXTRAS_TOUR_STEPS];

  it("exactly the steps whose target sits inside a record card are marked", () => {
    const marked = all.filter((s) => s.inRecordCard).map((s) => s.id);
    expect(marked).toEqual([
      "saved",
      "status-toggle",
      "duplicate",
      "expand",
      "reminders-section",
      "reminder-trigger",
    ]);
  });

  it("a marked step is limited to the created card's own wrapper", () => {
    const step = all.find((s) => s.id === "status-toggle")!;
    expect(tourSelector(step, "abc-123")).toBe('[id="record-abc-123"] [data-tour="status-toggle"]');
  });

  it("falls back to the plain name when no card is known (tour started later)", () => {
    const step = all.find((s) => s.id === "status-toggle")!;
    expect(tourSelector(step, null)).toBe('[data-tour="status-toggle"]');
  });

  it("never narrows a step that is not marked, even when a card is known", () => {
    const step = all.find((s) => s.id === "add-entry")!;
    expect(tourSelector(step, "abc-123")).toBe('[data-tour="add-record-fab"]');
  });

  it("every card on the Loans page sits inside a wrapper with the id the selector uses", () => {
    const loans = readFileSync("src/routes/loans.tsx", "utf8");
    expect(loans).toContain("<HashHighlight id={`record-${l.id}`}>");
  });

  it("saving a new record during the core tour remembers its id", () => {
    const form = readFileSync("src/components/RecordFormSheet.tsx", "utf8");
    expect(form).toContain('activeTour === "core"');
    expect(form).toContain("setTourRecordId(savedId)");
  });
});
