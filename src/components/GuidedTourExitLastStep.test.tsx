// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The last step of a tour: pressing X there just closes a FINISHED tour, so it
// must not ask "Exit the tour?" and must not say the tour was skipped. A
// one-step tour makes the active step the last step.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const toastFn = vi.fn();
const markSeen = vi.fn(() => Promise.resolve());

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/useCurrentRole", () => ({ useCurrentRole: () => ({ isViewer: false }) }));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toastFn(...a) }));
vi.mock("@/lib/tourSteps", async (orig) => ({
  ...(await orig<typeof import("@/lib/tourSteps")>()),
  CORE_TOUR_STEPS: [
    {
      id: "only",
      target: "only-target",
      title: "Last",
      body: "The only step",
      placement: "bottom",
    },
  ],
  markTourSeen: () => markSeen(),
}));

import { GuidedTour } from "@/components/GuidedTour";
import { useAppStore } from "@/lib/store";

let root: Root;

describe("GuidedTour X on the last step", () => {
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
    document.body.insertAdjacentHTML("beforeend", '<div data-tour="only-target">x</div>');
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    document.body.className = "";
    vi.restoreAllMocks();
  });

  it("closes without asking and without the 'skipped' message", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => root.render(<GuidedTour />));
    await act(async () => useAppStore.getState().startTour("core"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const x = document.querySelector<HTMLButtonElement>(".driver-popover-close-btn")!;
    expect(x).not.toBeNull();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      x.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    expect(ask).not.toHaveBeenCalled();
    expect(useAppStore.getState().activeTour).toBeNull();
    expect(markSeen).toHaveBeenCalledTimes(1);
    // finished (not skipped): no "You can take the tour anytime" toast, but the "more tips" offer
    expect(toastFn).not.toHaveBeenCalledWith("You can take the tour anytime from Settings.");
    expect(toastFn).toHaveBeenCalledWith("Want more tips & tricks?", expect.anything());
  });
});
