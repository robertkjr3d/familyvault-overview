import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { cn } from "@/lib/utils";
import { CORE_TOUR_STEPS, EXTRAS_TOUR_STEPS, markTourSeen, type TourStep } from "@/lib/tourSteps";
import { toast } from "sonner";

const PAD = 8; // px gap between the spotlight hole and the highlighted element
// Kept equal to the app's `rounded-xl` value (--radius-xl in styles.css,
// currently 18px) on purpose — the dimmed hole and the ring drawn on top of
// it must always use the exact same radius or they visibly mismatch. If
// --radius-xl ever changes, update this constant too.
const CORNER_RADIUS = 18;

type Rect = { top: number; left: number; width: number; height: number };

/**
 * Renders on top of the real app (mounted once near the root) and drives
 * the user through a sequence of real UI elements — it does not simulate
 * or mock anything. Each step names a data-tour="..." value; this engine
 * finds that real element wherever it currently lives in the DOM (which
 * may require navigating to a different route or opening a real Sheet
 * first), scrolls it into view, and draws a spotlight + pointer + text
 * card around it. Advancing happens either via the Next button or by
 * actually clicking/tapping the real spotlighted element — both call the
 * same advance() function, so the tour never gets out of sync with what
 * the user actually did.
 */
export function GuidedTour() {
  const activeTour = useAppStore((s) => s.activeTour);
  const tourStep = useAppStore((s) => s.tourStep);
  const advanceTour = useAppStore((s) => s.advanceTour);
  const endTour = useAppStore((s) => s.endTour);
  const navigate = useNavigate();
  const location = useLocation();
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

  const [rect, setRect] = useState<Rect | null>(null);
  const [foundEl, setFoundEl] = useState<HTMLElement | null>(null);

  // Navigate to this step's route if we're not already there. Generic and
  // safe to run on every step (not just the first) — if the user got here
  // via a real link tap (the common case), we're already on the right
  // route and this is a no-op; it only actually navigates when needed,
  // e.g. starting a tour fresh from Settings.
  useEffect(() => {
    if (!step?.route) return;
    if (location.pathname !== step.route) {
      navigate({ to: step.route });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, tourStep]);

  const [stuck, setStuck] = useState(false);

  // Find the target element. Polls rather than assuming it exists yet,
  // since it may only appear after a route change finishes rendering or a
  // Sheet finishes opening. MutationObserver catches most cases instantly;
  // the interval is a defensive fallback. Tracks the element itself (not
  // just its position) so a re-rendered replacement node — even one that
  // lands at the exact same screen position — is detected and re-bound.
  useEffect(() => {
    setFoundEl(null);
    setRect(null);
    setStuck(false);
    if (!step) return;
    let cancelled = false;
    let currentEl: HTMLElement | null = null;

    function tryFind() {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step!.target}"]`);
      if (el && !cancelled && currentEl !== el) {
        currentEl = el;
        setFoundEl(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          if (!cancelled) updateRect();
        }, 350);
      }
    }
    function updateRect() {
      if (!currentEl) return;
      const r = currentEl.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }

    tryFind();
    const observer = new MutationObserver(tryFind);
    observer.observe(document.body, { childList: true, subtree: true });
    const interval = window.setInterval(tryFind, 250);
    const onScrollResize = () => updateRect();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    // Safety net: if this step's target genuinely never shows up, don't
    // leave the person stuck under a dark overlay with no way out.
    const stuckTimer = window.setTimeout(() => {
      if (!cancelled && !currentEl) setStuck(true);
    }, 6000);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(stuckTimer);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [activeTour, tourStep, location.pathname, step]);

  // Advancing the tour is also wired to a real click/tap on the actual
  // spotlighted element — the whole point of this tour is that people
  // interact with the real app, not a copy of it. Depending on foundEl
  // itself (not on rect) means this always attaches to the CURRENT real
  // node, even if a re-render swapped it for a new one at the same spot.
  //
  // Deferred by one tick on purpose (confirmed race, not hypothetical):
  // this listener is attached directly on the target element, so on a
  // plain click it runs in the target phase — BEFORE the event reaches the
  // app's own React root listener (React delegates event handling to the
  // root container in the bubble phase). Calling advance() synchronously
  // here could move the tour to its next step before the real click's own
  // effect (save a record, open a Sheet, navigate) has actually happened.
  // The unmounted-guard covers the case where the user also hits Skip (or
  // the tour otherwise unmounts) inside that single deferred tick.
  useEffect(() => {
    if (!foundEl) return;
    let cancelled = false;
    const handler = () => {
      window.setTimeout(() => {
        if (!cancelled) advance();
      }, 0);
    };
    foundEl.addEventListener("click", handler);
    return () => {
      cancelled = true;
      foundEl.removeEventListener("click", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foundEl]);

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

  if (stuck) {
    const isLastStep = tourStep >= steps.length - 1;
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
                onClick={advanceTour}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Skip this step, keep going
              </button>
            )}
            <button
              onClick={skip}
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
    <div className="fixed inset-0 z-[100]">
      <Spotlight rect={rect} />
      {rect && (
        <TourCard
          key={step.id}
          step={step}
          index={tourStep}
          total={steps.length}
          rect={rect}
          onNext={advance}
          onSkip={skip}
        />
      )}
    </div>
  );
}

function Spotlight({ rect }: { rect: Rect | null }) {
  if (!rect) {
    // Nothing found yet (mid-navigation, waiting for a Sheet to open) —
    // dim the screen so it's clear something is happening, no hole yet.
    return <div className="absolute inset-0 bg-black/55 transition-opacity duration-300" />;
  }
  const top = rect.top - PAD;
  const left = rect.left - PAD;
  const width = rect.width + PAD * 2;
  const height = rect.height + PAD * 2;
  const bottom = top + height;
  const right = left + width;
  // Real, plain rectangles — the only spotlight-hole technique guaranteed
  // to work for click-through on every real browser. An earlier version
  // used a single element with a clip-path "hole" instead: visually
  // identical, much less code, but on iOS Safari it silently blocked every
  // tap on the real target underneath — clip-path's effect on hit-testing
  // isn't reliable across browsers the way plain non-overlapping elements
  // are. Confirmed on a real deployed build, not a hypothetical. Kept
  // deliberately dumb: these 4 are fully transparent and do none of the
  // visual work — the box-shadow div below draws the entire dim + rounded
  // hole appearance on its own, correctly, in every browser.
  return (
    <>
      <div className="absolute" style={{ top: 0, left: 0, right: 0, height: Math.max(0, top) }} />
      <div className="absolute" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="absolute" style={{ top, left: 0, width: Math.max(0, left), height }} />
      <div className="absolute" style={{ top, left: right, right: 0, height }} />
      {/* Pure visual: pointer-events-none, so it can never affect clicking
          either way. A box-shadow's spread naturally follows its own
          element's border-radius, so this always renders a correctly
          rounded dim hole with no path/geometry math needed. */}
      <div
        className="pointer-events-none absolute animate-in fade-in-0 zoom-in-95 duration-300 transition-all"
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
        className="pointer-events-none absolute ring-4 ring-primary transition-all duration-300"
        style={{ top, left, width, height, borderRadius: CORNER_RADIUS }}
      />
      <span
        className="pointer-events-none absolute text-4xl leading-none drop-shadow-[0_2px_5px_rgba(0,0,0,0.45)] animate-tour-point"
        style={{ top: bottom - 8, left: left + 2 }}
        aria-hidden="true"
      >
        👆
      </span>
    </>
  );
}

function TourCard({
  step,
  index,
  total,
  rect,
  onNext,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  rect: Rect;
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

  return (
    <div
      className="absolute rounded-2xl bg-card p-4 shadow-2xl border border-border animate-in fade-in-0 zoom-in-95 duration-200"
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
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <h3 className="text-sm font-bold">{step.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
      <div className="mt-3 flex justify-end">
        <button
          onClick={onNext}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          {index === total - 1 ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}
