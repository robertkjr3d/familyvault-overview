import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { cn } from "@/lib/utils";
import { CORE_TOUR_STEPS, EXTRAS_TOUR_STEPS, markTourSeen, type TourStep } from "@/lib/tourSteps";
import { toast } from "sonner";

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8; // px gap between the spotlight hole and the highlighted element
// Kept equal to the app's `rounded-xl` value (--radius-xl in styles.css,
// currently 18px) on purpose — the dimmed hole and the ring drawn on top of
// it must always use the exact same radius or they visibly mismatch. If
// --radius-xl ever changes, update this constant too.
const CORNER_RADIUS = 18;

/**
 * Renders on top of the real app (mounted once near the root) and drives
 * the user through a sequence of real UI elements — it does not simulate
 * or mock anything. Each step names a data-tour="..." value; this engine
 * finds that real element wherever it currently lives in the DOM (which
 * may require navigating to a different route or opening a real Sheet
 * first), scrolls it into view, and draws a spotlight around it: the rest
 * of the screen dims and only the highlighted element stays tappable —
 * everywhere else is genuinely blocked, not just visually dark, so a
 * stray tap can't land on something behind the overlay by accident.
 *
 * That last part — blocking everywhere except the hole — was the source
 * of nearly every hard bug this component had, across several rebuilds:
 * a clip-path-based hole silently failed hit-testing on iOS Safari,
 * dropping blocking altogether let a stray tap dismiss an open Sheet
 * (Sheets close themselves on an outside tap by default), and a plain
 * full-screen wrapper div left at its default pointer-events blocked the
 * hole too, regardless of what was drawn inside it. The version here
 * combines the two pieces that were each separately confirmed correct
 * but never shipped together: the full-screen wrapper is explicitly
 * pointer-events-none, and the four rectangles that frame the hole are
 * explicitly pointer-events-auto, overriding that inherited "none" only
 * where they actually are — never over the hole itself, which nothing
 * here covers.
 */
export function GuidedTour() {
  const activeTour = useAppStore((s) => s.activeTour);
  const tourStep = useAppStore((s) => s.tourStep);
  const advanceTour = useAppStore((s) => s.advanceTour);
  const endTour = useAppStore((s) => s.endTour);
  // Defensive, in addition to the Settings/welcome-screen entry points not
  // offering the tour to Viewers: if a tour is somehow already active when
  // the role resolves to viewer (e.g. a role change mid-tour), bail out
  // rather than walking them into a step that can't exist for their role.
  const { isViewer } = useCurrentRole();

  const steps: TourStep[] =
    activeTour === "core" ? CORE_TOUR_STEPS : activeTour === "extras" ? EXTRAS_TOUR_STEPS : [];
  const step = steps[tourStep];

  // Lock background scroll for the whole time a tour is on screen.
  useEffect(() => {
    if (!activeTour) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [activeTour]);

  useEffect(() => {
    if (activeTour && isViewer) endTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, isViewer]);

  function advance() {
    if (tourStep >= steps.length - 1) {
      if (activeTour === "core") void markTourSeen();
      endTour();
    } else {
      advanceTour();
    }
  }

  function skip() {
    if (activeTour === "core") void markTourSeen();
    endTour();
    toast("You can take the tour anytime from Settings.");
  }

  if (!step) return null;

  // Keyed by tour + step index: forces a full unmount of the previous
  // step's runner (running its cleanup completely — every listener,
  // observer, and timer torn down) and a full fresh mount of the next
  // one, on every step change, guaranteed by React itself. An earlier
  // version reset several separate pieces of state (the found element,
  // its measured position, whether it had a value) by hand inside an
  // effect keyed on the step changing — logically equivalent in theory,
  // but it showed a real bug in practice: sometimes the PREVIOUS step's
  // highlight and position kept showing through the next one or two
  // steps, self-correcting only on a full page refresh. A manual reset
  // has to get every piece of related state right every time; a key
  // change can't partially apply.
  return (
    <TourStepRunner
      key={`${activeTour}-${tourStep}`}
      step={step}
      index={tourStep}
      total={steps.length}
      onNext={advance}
      onSkip={skip}
    />
  );
}

function TourStepRunner({
  step,
  index,
  total,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [rect, setRect] = useState<Rect | null>(null);
  const [hasValue, setHasValue] = useState(false);
  const [stuck, setStuck] = useState(false);

  // Navigate to this step's route once, on mount, if we're not already
  // there. Runs only once per step (this whole component remounts on
  // every step change, so "on mount" already means "once per step").
  useEffect(() => {
    if (step.route && location.pathname !== step.route) {
      navigate({ to: step.route });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Find the target element, scroll it into view, wire up click-to-advance
  // if this step allows it, and track the target's rect (for positioning
  // the spotlight and the text card) and value (for a requireValue step).
  // Polls rather than assuming the target exists yet, since it may only
  // appear after the route above finishes rendering or a Sheet finishes
  // opening — MutationObserver catches most cases instantly, the interval
  // is a defensive fallback that also keeps re-measuring for the rest of
  // the step, so a still-settling Sheet-open animation self-corrects
  // within one tick instead of staying wrong.
  useEffect(() => {
    let cancelled = false;
    let currentEl: HTMLElement | null = null;
    let clickHandler: (() => void) | null = null;

    function updateRect() {
      if (!currentEl) return;
      const r = currentEl.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // hidden/mid-transition — keep whatever we last had
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      // For a field step, currentEl is the data-tour wrapper div (label +
      // control together, so the whole field gets spotlighted, not just
      // the input) — the real <input>/<select> with a .value lives inside
      // it, not on the wrapper itself.
      const control = currentEl.querySelector<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea");
      setHasValue(!!control && !!String(control.value ?? "").trim());
    }

    function tryFind() {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el || cancelled || currentEl === el) return;
      // Reject a match that exists in the DOM but isn't actually visible
      // yet (display:none, not yet laid out, zero-size) — accepting it
      // would collapse the whole spotlight down to a 0×0 rect at (0,0),
      // pinned to the top-left corner. Keep polling; a genuinely-missing
      // target still falls through to the stuck screen below.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      currentEl = el;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Advancing the tour is also wired to a real click/tap on the
      // actual target, but ONLY for steps explicitly marked
      // advanceOnClick — see that field's own comment in tourSteps.ts for
      // why that's opt-in, not automatic (a dropdown or a text field
      // isn't "done" the moment it's tapped, only when a value is
      // eventually picked or typed).
      //
      // Deferred by one tick on purpose (confirmed race, not
      // hypothetical): this listener is attached directly on the target,
      // so on a plain click it runs in the target phase — BEFORE the
      // event reaches the app's own React root listener (React delegates
      // event handling to the root container in the bubble phase).
      // Calling onNext() synchronously here could advance the tour
      // before the real click's own effect (save a record, open a Sheet,
      // navigate) has actually happened.
      if (step.advanceOnClick) {
        clickHandler = () => {
          window.setTimeout(() => {
            if (!cancelled) onNext();
          }, 0);
        };
        el.addEventListener("click", clickHandler);
      }
      updateRect();
    }

    tryFind();
    const observer = new MutationObserver(tryFind);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(() => {
      tryFind();
      updateRect();
    }, 250);
    const onScrollResize = () => updateRect();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    // Safety net: if this step's target genuinely never shows up, don't
    // leave the person stuck with no way out. Kept short (3s) on purpose
    // — if it fires, that itself is useful diagnostic information, and
    // there's no reason to make someone wait longer to see the recovery
    // buttons.
    const stuckTimer = window.setTimeout(() => {
      if (!cancelled && !currentEl) setStuck(true);
    }, 3000);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(stuckTimer);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      if (currentEl && clickHandler) currentEl.removeEventListener("click", clickHandler);
    };
    // step, index and total don't change for the lifetime of this
    // component (it remounts fresh on every step via the key above), so
    // this effect intentionally runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (stuck) {
    const isLastStep = index >= total - 1;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 animate-in fade-in-0 duration-200">
        <div className="w-full max-w-sm rounded-2xl bg-card p-5 text-center shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
          <p className="text-sm text-muted-foreground">
            Couldn't find what to show next here — maybe it's already done, or this step needs
            something set up first.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {!isLastStep && (
              <button
                onClick={onNext}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Skip this step, keep going
              </button>
            )}
            <button
              onClick={onSkip}
              className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground"
            >
              Close tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      <Spotlight rect={rect} />
      {rect && (
        <TourCard
          step={step}
          index={index}
          total={total}
          rect={rect}
          hasValue={hasValue}
          onNext={onNext}
          onSkip={onSkip}
        />
      )}
    </div>
  );
}

function Spotlight({ rect }: { rect: Rect | null }) {
  if (!rect) {
    // Nothing found yet (mid-navigation, waiting for a Sheet to open) —
    // dim the screen so it's clear something is happening, no hole yet.
    // Blocking taps everywhere in this state is correct too: there's no
    // real target to protect yet, so nothing should be reachable.
    return (
      <div className="pointer-events-auto absolute inset-0 bg-black/55 transition-opacity duration-300" />
    );
  }
  const top = rect.top - PAD;
  const left = rect.left - PAD;
  const width = rect.width + PAD * 2;
  const height = rect.height + PAD * 2;
  const bottom = top + height;
  const right = left + width;
  return (
    <>
      {/* Click-blocking: 4 real, invisible rectangles framing the hole,
          explicitly pointer-events-auto — overriding the "none" they'd
          otherwise inherit from the full-screen parent wrapper. Nothing
          here covers the hole itself, so the real target underneath it
          stays exactly as tappable as it already was; everywhere else is
          genuinely blocked, not just visually dark. */}
      <div
        className="pointer-events-auto absolute"
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }}
      />
      <div
        className="pointer-events-auto absolute"
        style={{ top: bottom, left: 0, right: 0, bottom: 0 }}
      />
      <div
        className="pointer-events-auto absolute"
        style={{ top, left: 0, width: Math.max(0, left), height }}
      />
      <div
        className="pointer-events-auto absolute"
        style={{ top, left: right, right: 0, height }}
      />
      {/* Pure visual, pointer-events-none — a box-shadow's spread grows
          the dim by a fixed number of pixels evenly on every side,
          correctly following the box's own border-radius, so it always
          renders a clean rounded hole with no separate geometry needed. */}
      <div
        className="pointer-events-none absolute animate-in fade-in-0 zoom-in-95 duration-200"
        style={{
          top,
          left,
          width,
          height,
          borderRadius: CORNER_RADIUS,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
      />
      <div
        className="pointer-events-none absolute animate-in fade-in-0 zoom-in-95 duration-200 ring-4 ring-primary"
        style={{ top, left, width, height, borderRadius: CORNER_RADIUS }}
      />
      {/* "Look here" pulse — grown via per-element --tsx/--tsy custom
          properties computed from the target's own real width/height, so
          the growth is the same fixed pixel amount on every side
          regardless of the box's shape (a wide-short bar and a small
          square button both grow by ~10px per side, not by the same
          percentage — a uniform percentage scale is what made a wide box
          radiate sideways much more than vertically). Animates transform
          + opacity only, never box-shadow — box-shadow isn't
          GPU-accelerated and visibly flickers rather than pulsing
          smoothly on a real phone; transform and opacity are the two
          properties every browser can animate smoothly. */}
      <div
        className="pointer-events-none absolute animate-tour-point bg-primary/35"
        style={
          {
            top,
            left,
            width,
            height,
            borderRadius: CORNER_RADIUS,
            "--tsx": (width + 20) / width,
            "--tsy": (height + 20) / height,
          } as CSSProperties
        }
      />
    </>
  );
}

function TourCard({
  step,
  index,
  total,
  rect,
  hasValue,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  rect: Rect;
  hasValue: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const CARD_W = 300;
  const MARGIN = 12;
  const vw = typeof window !== "undefined" ? window.innerWidth : 400;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const placement = step.placement ?? "bottom";
  const spotBottom = rect.top + rect.height + PAD;
  const spotTop = rect.top - PAD;
  const spotRight = rect.left + rect.width + PAD;
  const spotLeft = rect.left - PAD;

  let top: number | undefined;
  let bottom: number | undefined;
  let left: number;

  if (placement === "left" || placement === "right") {
    // Side placement: keep the card vertically level with the target,
    // offset horizontally — this is what actually keeps it clear of a
    // corner element like the FAB, instead of centering on top of it.
    const desiredTop = rect.top + rect.height / 2 - 90;
    top = Math.min(Math.max(desiredTop, MARGIN), vh - 200);
    const fitsLeft = spotLeft - CARD_W - MARGIN > 0;
    if (placement === "left" && fitsLeft) {
      left = spotLeft - CARD_W - MARGIN;
    } else if (placement === "right" && spotRight + CARD_W + MARGIN < vw) {
      left = spotRight + MARGIN;
    } else {
      // Doesn't fit on the requested side (e.g. a narrow phone) — fall
      // back to centered above/below rather than running off-screen.
      left = Math.min(
        Math.max(rect.left + rect.width / 2 - CARD_W / 2, MARGIN),
        vw - CARD_W - MARGIN,
      );
      const spaceBelow = vh - spotBottom;
      if (spaceBelow > 140) {
        top = spotBottom + 16;
      } else {
        top = undefined;
        bottom = Math.max(vh - spotTop + 16, 16);
      }
    }
  } else {
    const preferBelow = placement === "bottom";
    const spaceBelow = vh - spotBottom;
    const spaceAbove = spotTop;
    const placeBelow = preferBelow
      ? spaceBelow > 140 || spaceBelow > spaceAbove
      : spaceBelow > spaceAbove;
    top = placeBelow ? Math.min(spotBottom + 16, vh - 200) : undefined;
    bottom = !placeBelow ? Math.max(vh - spotTop + 16, 16) : undefined;
    left = Math.min(
      Math.max(rect.left + rect.width / 2 - CARD_W / 2, MARGIN),
      vw - CARD_W - MARGIN,
    );
  }

  // A step marked advanceOnClick is only ever completed by the real tap —
  // showing Next as an alternative lets someone skip past it WITHOUT doing
  // the real action, and the step right after often depends on that
  // action having actually happened (e.g. skipping the "+" FAB step means
  // no record exists, so every field step after it can never find its
  // target). A requireValue step similarly stays without Next until the
  // real field actually has something in it. No hint text for the
  // advanceOnClick case — the pulsing spotlight already says "tap here"
  // on its own; a redundant caption under it just adds clutter.
  const waitingOnTap = !!step.advanceOnClick;
  const waitingOnValue = !!step.requireValue && !hasValue;
  const showNext = !waitingOnTap && !waitingOnValue;
  const showFooter = showNext || waitingOnValue;

  return (
    <div
      className="pointer-events-none absolute rounded-2xl bg-card p-4 shadow-2xl border border-border animate-in fade-in-0 zoom-in-95 duration-200 transition-[top,left,bottom]"
      style={{ width: CARD_W, left, top, bottom }}
    >
      <div className="mb-2.5 flex items-center gap-3">
        <div
          className="flex flex-1 gap-1"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Step ${index + 1} of ${total}`}
        >
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-300",
                i <= index ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <button
          onClick={onSkip}
          aria-label="Skip tour"
          className="pointer-events-auto shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h3 className="text-sm font-bold">{step.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
      {showFooter && (
        <div className="mt-3 flex justify-end">
          {showNext ? (
            <button
              onClick={onNext}
              className="pointer-events-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              {index === total - 1 ? "Done" : "Next"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Fill this in to continue</span>
          )}
        </div>
      )}
    </div>
  );
}
