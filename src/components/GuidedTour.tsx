import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useAppStore } from "@/lib/store";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { CORE_TOUR_STEPS, EXTRAS_TOUR_STEPS, markTourSeen, type TourStep } from "@/lib/tourSteps";
import { toast } from "sonner";

// Matches this app's own --radius-xl (styles.css) — NOT Tailwind's default
// 12px, since this app's --radius is 0.875rem, not the default. Keeps the
// spotlight's cutout corners matching the app's own card/button rounding.
const STAGE_RADIUS = 18;

/**
 * Drives the user through a sequence of real UI elements using driver.js
 * (https://driverjs.com — MIT, actively maintained), rather than a
 * hand-rolled overlay. This app's own hand-built version went through
 * several full rebuilds — dimming, click-blocking around the highlighted
 * hole, and a "look here" animation each broke in a different real way on
 * a real phone despite passing every check available in this sandbox
 * (build, types, lint, tests). That's not a coincidence: getting an
 * overlay's hit-testing exactly right across real browsers is a genuinely
 * hard problem, which is why virtually no production app hand-builds it —
 * driver.js exists specifically because thousands of real apps have
 * already exercised this exact problem on real devices. This component's
 * job is just to translate this app's own step list (tourSteps.ts) and a
 * few app-specific needs (route navigation before a step, gating "Next"
 * on a real value) into driver.js's own config, and let it handle the
 * overlay, the hole, the click-blocking, the positioning, and the
 * click-to-advance behavior itself.
 */
export function GuidedTour() {
  const activeTour = useAppStore((s) => s.activeTour);
  const endTour = useAppStore((s) => s.endTour);
  const navigate = useNavigate();
  const location = useLocation();
  // Kept fresh across renders without re-running the effect below on every
  // route change — only activeTour/isViewer should restart the tour engine.
  const locationRef = useRef(location);
  locationRef.current = location;

  // Defensive, in addition to the Settings/welcome-screen entry points not
  // offering the tour to Viewers: if a tour is somehow already active when
  // the role resolves to viewer (e.g. a role change mid-tour), bail out
  // rather than walking them into a step that can't exist for their role.
  const { isViewer } = useCurrentRole();

  useEffect(() => {
    if (!activeTour || isViewer) return;

    const tourSteps: TourStep[] = activeTour === "core" ? CORE_TOUR_STEPS : EXTRAS_TOUR_STEPS;
    let finished = false;

    function finish(skippedEarly: boolean) {
      if (finished) return;
      finished = true;
      if (activeTour === "core") void markTourSeen();
      endTour();
      if (skippedEarly) toast("You can take the tour anytime from Settings.");
    }

    const driveSteps: DriveStep[] = tourSteps.map((step) => ({
      element: `[data-tour="${step.target}"]`,
      popover: {
        title: step.title,
        description: step.body,
        side: step.placement,
        // A step marked advanceOnClick is only ever completed by the
        // real tap — showing Next as an alternative lets someone skip
        // past it WITHOUT doing the real action, and the step right
        // after often depends on that action having actually happened
        // (e.g. skipping the "+" FAB step means no record exists, so
        // every field step after it can never find its target). Close
        // stays available either way, so the tour is never a dead end.
        showButtons: step.advanceOnClick ? ["close" as const] : ["next" as const, "close" as const],
        // For a requireValue step (a required field), start with Next
        // hidden and reveal it once the real input actually has
        // something in it — implemented here rather than as a
        // driver.js built-in, since driver.js has no concept of "wait
        // for a value" (it only knows about the element existing).
        onPopoverRender: step.requireValue
          ? (popover, opts) => {
              const target = opts.driver.getActiveElement();
              const control = target?.querySelector<
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
              >("input, select, textarea");
              const update = () => {
                const has = !!control && !!String(control.value ?? "").trim();
                popover.nextButton.style.display = has ? "" : "none";
              };
              update();
              control?.addEventListener("input", update);
              control?.addEventListener("change", update);
            }
          : undefined,
      },
      advanceOnClick: !!step.advanceOnClick,
      disableActiveInteraction: !!step.disableInteraction,
      // driver.js measures the target's position once when a step first
      // highlights. If that target only just finished navigating to, or
      // sits inside a Sheet still mid-open-animation, that first
      // measurement can be taken before the layout has actually settled
      // — confirmed cause of the stage/popover appearing cut off or far
      // from the real element on some steps. refresh() re-measures and
      // repositions everything; running it again ~400ms later (past any
      // normal CSS transition) corrects that without needing to guess
      // which specific steps are affected.
      onHighlighted: (_element, _step, opts) => {
        window.setTimeout(() => opts.driver.refresh(), 400);
      },
    }));

    const driverObj: Driver = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      overlayOpacity: 0.55,
      stagePadding: 8,
      stageRadius: STAGE_RADIUS,
      smoothScroll: true,
      allowClose: true,
      // driver.js's own default here is "close" — a stray tap anywhere on
      // the dimmed background, not just the X button, silently ends the
      // whole tour. Confirmed exactly this happening around the bank
      // field, where an accidental tap near (not on) the target looked
      // like the tour randomly quitting. A no-op keeps a background tap
      // harmless instead: nothing happens, the tour just stays put.
      overlayClickBehavior: () => {},
      // A target that genuinely never appears (something upstream didn't
      // set up the way the step expects) skips forward automatically
      // after waiting, rather than leaving the tour stuck with no way
      // out. waitForElement is generous (5s) on purpose: it also has to
      // cover this app's own route navigation below finishing, not just
      // the element itself settling into place.
      waitForElement: 5000,
      skipMissingElement: true,
      steps: driveSteps,
      // Intercepts advancing to the next step — for BOTH the Next button
      // AND a real tap on an advanceOnClick target, confirmed by reading
      // driver.js's own source: both paths resolve to this same handler
      // when it's set, not two separate ones. This is deliberately NOT
      // implemented via onHighlightStarted, which looked like the right
      // hook at first — it actually fires only once driver.js has ALREADY
      // finished searching for the next step's element, which is too
      // late to navigate there first. onNextClick fires before that
      // search begins, so navigating here means driver.js's own element
      // search (which already retries for up to waitForElement) starts
      // only after the route change has been kicked off.
      onNextClick: (_element, _step, opts) => {
        const idx = opts.index ?? 0;
        // The core tour's first step deliberately lets the person tap
        // either "All" or a specific member chip — that's the step's
        // whole point. But if they land on a specific member, the loan
        // this tour creates later can end up filtered OUT of view by the
        // time the "saved" step looks for its card — confirmed cause of
        // the tour appearing to break at Save for some people and not
        // others. Reset to "All" the moment this step is left (not
        // before it's shown, which wouldn't catch whatever gets tapped
        // during it), so the rest of the tour always has an unfiltered
        // view regardless of what was picked.
        if (activeTour === "core" && idx === 0) {
          useAppStore.getState().setMemberFilter("all");
        }
        const nextTourStep = tourSteps[idx + 1];
        if (nextTourStep?.route && locationRef.current.pathname !== nextTourStep.route) {
          navigate({ to: nextTourStep.route });
        }
        opts.driver.moveNext();
      },
      onCloseClick: () => {
        const idx = driverObj.getActiveIndex() ?? 0;
        finish(idx < tourSteps.length - 1);
        driverObj.destroy();
      },
      onDestroyed: () => {
        const idx = driverObj.getActiveIndex() ?? 0;
        finish(idx < tourSteps.length - 1);
      },
    });

    const first = tourSteps[0];
    if (first?.route && locationRef.current.pathname !== first.route) {
      navigate({ to: first.route });
    }
    driverObj.drive();

    return () => {
      if (driverObj.isActive()) driverObj.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, isViewer]);

  return null;
}
