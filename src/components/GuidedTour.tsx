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
  //
  // Deliberately does NOT reset `rect` to null at the start of every step
  // (only `foundEl`) — it keeps showing the PREVIOUS step's spotlight,
  // right where it already is, until the new target is actually found and
  // measured, then updates in place. The CSS transition on the ring/dim
  // (below) then glides smoothly from the old spot to the new one. An
  // earlier version reset rect to null on every step change, which
  // unmounted and remounted the spotlight each time (a real target, sure,
  // but a jarring "pop out, pop back in" instead of a glide) and was the
  // actual cause of the ring visibly "flying in" to each new spot.
  useEffect(() => {
    setFoundEl(null);
    setStuck(false);
    if (!step) return;
    let cancelled = false;
    let currentEl: HTMLElement | null = null;

    function tryFind() {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step!.target}"]`);
      if (!el || cancelled || currentEl === el) return;
      // Reject a match that exists in the DOM but isn't actually visible
      // yet (display:none, not yet laid out, zero-size) — accepting it
      // would collapse the whole spotlight down to a 0×0 rect at (0,0),
      // which renders as a ring/pointer pinned to the top-left corner
      // pointing at nothing. Keep polling instead; a genuinely-missing
      // target still falls through to the stuck-screen safety net below.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      currentEl = el;
      setFoundEl(el);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (!cancelled) updateRect();
      }, 350);
    }
    function updateRect() {
      if (!currentEl) return;
      const r = currentEl.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // same zero-size guard, on every re-measure
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
  // spotlighted element, but ONLY for steps explicitly marked
  // advanceOnClick — see the type's own comment in tourSteps.ts for why
  // that's opt-in, not automatic. Depending on foundEl itself (not on
  // rect) means this always attaches to the CURRENT real node, even if a
  // re-render swapped it for a new one at the same spot.
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
    if (!foundEl || !step?.advanceOnClick) return;
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
  }, [foundEl, step?.advanceOnClick]);

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
    <div className="pointer-events-none fixed inset-0 z-[100]">
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
    return (
      <div className="pointer-events-none absolute inset-0 bg-black/55 transition-opacity duration-300" />
    );
  }
  const top = rect.top - PAD;
  const left = rect.left - PAD;
  const width = rect.width + PAD * 2;
  const height = rect.height + PAD * 2;
  // Everything the tour draws — the dim, the ring, the pulse — is
  // pointer-events-none, and so is this whole component's full-screen
  // parent wrapper (GuidedTour's return, above). That last part is the
  // actual fix: an earlier version made every element IN here inert but
  // left the full-screen wrapper DIV that contains them at its default
  // pointer-events (auto) — a parent element is its own independent
  // hit-test target regardless of what its children are set to, so that
  // forgotten wrapper alone was blocking every tap on the entire screen.
  // This is ordinary, well-defined CSS box-model behavior, not a
  // browser-specific quirk — unlike the two earlier click-blocking
  // techniques this replaced (clip-path, then a 4-rectangle frame), both
  // of which relied on hit-testing behavior that turned out not to be
  // reliable in practice and were dropped for that reason. Trade-off,
  // stated plainly: with no active blocking layer at all, tapping the
  // dimmed area away from the target now also reaches whatever's beneath
  // it, instead of being inertly blocked like before. Given the target
  // being tappable is the entire point of this tour, that trade is right.
  return (
    <>
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
      {/* "Look here" indicator — a second ring, same size and position,
          that loops through a gentle expand-and-fade pulse. This is the
          standard pattern for this exact job (Notion, Linear, and most
          fintech onboarding all use some version of a pulsing highlight
          rather than a literal hand-cursor icon) — chosen deliberately
          after repeated attempts at a hand-drawn glyph came out wrong
          (an icon's own internal detail lines showing through, an
          asymmetric outline, and once, an unintentionally rude gesture).
          A ring can't have any of those problems: it's the same shape as
          the highlight it belongs to, always centered exactly on it, and
          "pulsing" is one CSS animation on one element — nothing to draw,
          nothing to get wrong. */}
      <div
        className="pointer-events-none absolute animate-tour-point ring-4 ring-primary transition-all duration-300"
        style={{ top, left, width, height, borderRadius: CORNER_RADIUS }}
      />
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
      className="pointer-events-none absolute rounded-2xl bg-card p-4 shadow-2xl border border-border animate-in fade-in-0 zoom-in-95 duration-200"
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
      <div className="mt-3 flex justify-end">
        <button
          onClick={onNext}
          className="pointer-events-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          {index === total - 1 ? "Done" : "Next"}
        </button>
      </div>
    </div>
  );
}
