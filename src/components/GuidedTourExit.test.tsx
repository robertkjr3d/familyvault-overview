// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Runs the REAL GuidedTour component with the real driver.js in a simulated
// browser and presses the real X button, to prove: (1) skipping asks first,
// (2) Cancel leaves the tour untouched, (3) OK ends it exactly as before,
// (4) a browser that blocks confirm boxes can
// still exit (the last-step rule has its own file). Everything the component talks to outside itself is replaced by a
// stand-in (router, query client, role, toast, the "tour seen" save).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const invalidate = vi.fn();
const toastFn = vi.fn();
const markSeen = vi.fn(() => Promise.resolve());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
vi.mock("@/lib/useCurrentRole", () => ({ useCurrentRole: () => ({ isViewer: false }) }));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toastFn(...a) }));
vi.mock("@/lib/tourSteps", async (orig) => ({
  ...(await orig<typeof import("@/lib/tourSteps")>()),
  markTourSeen: () => markSeen(),
}));

import { GuidedTour } from "@/components/GuidedTour";
import { confirmExitTour, EXIT_TOUR_MESSAGE } from "@/lib/confirmExitTour";
import { useAppStore } from "@/lib/store";
import { CORE_TOUR_STEPS } from "@/lib/tourSteps";

let root: Root;
let host: HTMLDivElement;

async function sleep(ms: number) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function closeButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".driver-popover-close-btn");
}

// driver.js listens for pointer events on its popover and acts on the click.
function pressX() {
  const b = closeButton()!;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    b.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
}

async function startTourAndWait() {
  // The page elements the first step points at.
  document.body.insertAdjacentHTML(
    "beforeend",
    CORE_TOUR_STEPS.map(
      (s) => `<div data-tour="${s.target}" style="width:50px;height:20px">x</div>`,
    ).join(""),
  );
  await act(async () => {
    root.render(<GuidedTour />);
  });
  await act(async () => {
    useAppStore.getState().startTour("core");
  });
  // first step has a 400 ms settle delay
  await sleep(900);
  expect(closeButton()).not.toBeNull();
}

beforeEach(() => {
  localStorage.clear();
  (Element.prototype as any).scrollIntoView = vi.fn();
  (window as any).matchMedia = (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  useAppStore.setState({ activeTour: null, coreTourResolved: false, tourStep: 0 });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  document.body.innerHTML = "";
  document.body.className = "";
  vi.restoreAllMocks();
});

describe("GuidedTour X button", () => {
  it("asks before skipping, and Cancel keeps the tour exactly as it was", async () => {
    const ask = vi.spyOn(window, "confirm").mockImplementation(() => {
      // a person takes a moment to answer
      const end = performance.now() + 250;
      while (performance.now() < end) {
        /* wait */
      }
      return false;
    });
    await startTourAndWait();
    pressX();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(String(ask.mock.calls[0][0])).toContain("Exit the tour?");
    // still running: popover on screen, tour still active, nothing saved, no toast
    expect(closeButton()).not.toBeNull();
    expect(useAppStore.getState().activeTour).toBe("core");
    expect(useAppStore.getState().coreTourResolved).toBe(false);
    expect(markSeen).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
    expect(document.body.classList.contains("driver-active")).toBe(true);
  });

  it("OK ends the tour exactly like the old X did", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    await startTourAndWait();
    pressX();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(closeButton()).toBeNull();
    expect(useAppStore.getState().activeTour).toBeNull();
    expect(useAppStore.getState().coreTourResolved).toBe(true);
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(toastFn).toHaveBeenCalledWith("You can take the tour anytime from Settings.");
    expect(document.body.classList.contains("driver-active")).toBe(false);
    expect(document.body.classList.contains("driver-no-scroll")).toBe(false);
  });

  it("Cancel then X then OK: the second try still works (no stuck state)", async () => {
    const answers = [false, true];
    const ask = vi.spyOn(window, "confirm").mockImplementation(() => {
      const end = performance.now() + 250;
      while (performance.now() < end) {
        /* wait */
      }
      return answers.shift()!;
    });
    await startTourAndWait();
    pressX();
    expect(useAppStore.getState().activeTour).toBe("core");
    pressX();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().activeTour).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it("a browser that blocks confirm boxes (instant Cancel) can still exit", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await startTourAndWait();
    pressX();
    expect(useAppStore.getState().activeTour).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
  });
});

// A fake clock so "how long the person took to answer" is exact.
function clock(...times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe("confirmExitTour", () => {
  it("asks with the exit message", () => {
    let shown = "";
    confirmExitTour(
      (m) => {
        shown = m;
        return true;
      },
      clock(0, 3000),
    );
    expect(shown).toBe(EXIT_TOUR_MESSAGE);
    expect(shown.startsWith("Exit the tour?")).toBe(true);
  });

  it("exits when the person taps OK", () => {
    expect(confirmExitTour(() => true, clock(0, 2500))).toBe(true);
  });

  it("stays in the tour when the person takes a moment and taps Cancel", () => {
    expect(confirmExitTour(() => false, clock(0, 2500))).toBe(false);
  });

  it("still stays when Cancel comes after a fast but human answer (400 ms)", () => {
    expect(confirmExitTour(() => false, clock(0, 400))).toBe(false);
  });

  it("exits (never a dead end) when the browser answers Cancel instantly without showing a box", () => {
    expect(confirmExitTour(() => false, clock(0, 2))).toBe(true);
  });

  it("exits when the confirm box throws or does not exist", () => {
    expect(
      confirmExitTour(() => {
        throw new Error("confirm is not a function");
      }),
    ).toBe(true);
  });
});
