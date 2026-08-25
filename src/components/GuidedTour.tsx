import { useEffect, useState, type CSSProperties } from "react";
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
  const [hasValue, setHasValue] = useState(false);

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
  // Resets both rect and foundEl to null at the start of every step, on
  // purpose: the ring/dim (Spotlight) and the text card both go away for
  // the brief moment between steps, then pop back in together, freshly,
  // once the new target is actually found and measured — the same "gone,
  // then a clean fade-in at the right spot" behavior the card already had.
  // An earlier version kept the previous step's rect on screen and glided
  // the ring across to the new position instead — technically smoother,
  // but it reads as the highlight visibly flying across the screen, which
  // is worse, not better.
  useEffect(() => {
    setFoundEl(null);
    setRect(null);
    setHasValue(false);
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
      // which renders as a ring pinned to the top-left corner pointing at
      // nothing. Keep polling instead; a genuinely-missing target still
      // falls through to the stuck-screen safety net below.
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      currentEl = el;
      setFoundEl(el);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function updateRect() {
      if (!currentEl) return;
      const r = currentEl.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return; // same zero-size guard, on every re-measure
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

    tryFind();
    updateRect();
    const observer = new MutationObserver(tryFind);
    observer.observe(document.body, { childList: true, subtree: true });
    // Re-measures on every tick, not just once after first finding the
    // element — a scroll-into-view or a Sheet still mid-open-animation
    // when first found can report a wrong, still-settling position; this
    // makes any such mismatch self-correct within one tick (250ms) instead
    // of staying wrong for the rest of the step. Also doubles as the
    // live poll for hasValue, above, so Next can appear the moment a
    // required field actually gets a value.
    const interval = window.setInterval(() => {
      tryFind();
      updateRect();
    }, 250);
    const onScrollResize = () => updateRect();
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    // Safety net: if this step's target genuinely never shows up, don't
    // leave the person stuck under a dark overlay with no way out. Kept
    // short (3s, not longer) deliberately — if this fires, it's useful
    // diagnostic information (confirms the target genuinely isn't being
    // found at all, versus some other problem), and there's no reason to
    // make someone wait longer than that to find out and get the recovery
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
      <Spotlight key={step.id} rect={rect} />
      {rect && (
        <TourCard
          key={step.id}
          step={step}
          index={tourStep}
          total={steps.length}
          rect={rect}
          hasValue={hasValue}
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
    // pointer-events-none here too: see the long comment below for why.
    return (
      <div className="pointer-events-none absolute inset-0 bg-black/55 transition-opacity duration-300" />
    );
  }
  const top = rect.top - PAD;
  const left = rect.left - PAD;
  const width = rect.width + PAD * 2;
  const height = rect.height + PAD * 2;
  const bottom = top + height;
  const right = left + width;
  // Click-blocking is back to 4 real, invisible rectangles framing the
  // hole — explicitly pointer-events-auto, which OVERRIDES the "none"
  // they'd otherwise inherit from the full-screen parent wrapper (see
  // GuidedTour's own return, above). This isn't a return to an earlier,
  // supposedly-failed version of this same technique — it's that version
  // COMBINED with the wrapper fix, which is the piece it was actually
  // missing: without pointer-events-none on the wrapper, the wrapper's own
  // box (spanning the full screen) was independently catching clicks over
  // the hole too, regardless of what the 4 rectangles did — so the
  // rectangle technique itself was likely never the problem. Removing
  // background-blocking entirely (the version right before this one) traded
  // that bug for a worse one: with NOTHING blocking the dimmed area, an
  // errant tap near — but not exactly on — a field reached the real page
  // underneath, and for any tap that landed outside an open Sheet's own
  // content, the Sheet's own default "tap outside closes me" behavior
  // fired and silently closed the whole form. Confirmed cause of "the
  // whole form disappeared." These 4 rectangles are what stop that: they
  // block every tap in the dimmed area precisely everywhere EXCEPT the
  // hole itself, which nothing here covers, so the real target underneath
  // stays tappable.
  return (
    <>
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
        className="pointer-events-none absolute animate-in fade-in-0 zoom-in-95 duration-300"
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
        className="pointer-events-none absolute animate-in fade-in-0 zoom-in-95 duration-300 ring-4 ring-primary"
        style={{ top, left, width, height, borderRadius: CORNER_RADIUS }}
      />
      {/* "Look here" pulse — grown via per-axis CSS custom properties
          (--tsx/--tsy), computed below from the target's own real width
          and height so the growth is the same fixed pixel amount on every
          side regardless of the box's shape (a wide-short bar and a
          square button both grow by ~10px per side, not by the same
          percentage — the earlier version scaled both axes by the same
          percentage, which is exactly what made a wide box "radiate
          sideways but not top/bottom": 18% of a wide box's width is a lot
          more absolute pixels than 18% of its short height). Uses
          transform + opacity specifically, not box-shadow — box-shadow
          isn't GPU-accelerated, and animating it looks janky/flickery on
          a real phone rather than a smooth pulse; transform and opacity
          are the two properties browsers can always animate smoothly. */}
      <div
        className="pointer-events-none absolute animate-tour-point bg-primary/40"
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
  // target). Confirmed cause of the tour breaking partway through, not a
  // hypothetical. A requireValue step similarly stays without Next until
  // the real field actually has something in it.
  const waitingOnTap = !!step.advanceOnClick;
  const waitingOnValue = !!step.requireValue && !hasValue;
  const showNext = !waitingOnTap && !waitingOnValue;

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
      <div className="mt-3 flex min-h-[26px] items-center justify-end">
        {showNext ? (
          <button
            onClick={onNext}
            className="pointer-events-auto rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
          >
            {index === total - 1 ? "Done" : "Next"}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {waitingOnTap ? "Tap the highlighted item to continue" : "Fill this in to continue"}
          </span>
        )}
      </div>
    </div>
  );
}
