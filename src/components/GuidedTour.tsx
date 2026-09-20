import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();

  // Defensive, in addition to the Settings/welcome-screen entry points not
  // offering the tour to Viewers: if a tour is somehow already active when
  // the role resolves to viewer (e.g. a role change mid-tour), bail out
  // rather than walking them into a step that can't exist for their role.
  const { isViewer } = useCurrentRole();

  useEffect(() => {
    if (!activeTour || isViewer) return;

    const tourSteps: TourStep[] = activeTour === "core" ? CORE_TOUR_STEPS : EXTRAS_TOUR_STEPS;
    let finished = false;
    // Bug fix (Aug 28, 2026): confirmed by reading driver.js's own destroy
    // sequence directly — it calls its internal resetState() BEFORE firing
    // onDestroyed, so a fresh driverObj.getActiveIndex() call from INSIDE
    // onDestroyed always reads back undefined (defaulted to 0 below), no
    // matter which step the tour actually finished on. That silently made
    // every natural completion look like "skippedEarly" — which is why the
    // Tour 2 prompt never appeared, even though the code for it was
    // correct and genuinely deployed. onNextClick's own opts.index is
    // still reliable (driver.js hasn't reset anything yet when it fires),
    // so track it here instead of trusting a post-destroy read.
    let lastActiveIndex = 0;
    // Sep 18 2026, later same night: user flagged that none of this
    // session's mobile-only fixes (the keyboard auto-focus cancel below,
    // and the now-reverted keyboard-repositioning attempt) were actually
    // scoped to mobile — they ran on desktop too, unnoticed only because
    // desktop has no on-screen keyboard to visibly react to them. Using
    // "is the primary pointer a finger, not a mouse" rather than a
    // screen-width guess, since a resized browser window shouldn't be
    // able to flip this by accident the way a width check could.
    const isTouchDevice =
      typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

    function finish(skippedEarly: boolean) {
      if (finished) return;
      finished = true;
      if (activeTour === "core") {
        useAppStore.getState().setCoreTourResolved(true);
        void markTourSeen().then(() => {
          queryClient.invalidateQueries({ queryKey: ["household-memberships"] });
        });
      }
      endTour();
      if (skippedEarly) {
        toast("You can take the tour anytime from Settings.");
      } else if (activeTour === "core") {
        // Requested (Aug 28, 2026): offer Tour 2 immediately on finishing
        // Tour 1, instead of making the person find it in Settings
        // themselves. Uses sonner's own action/cancel buttons (confirmed
        // real fields on its toast() options, not a custom component) —
        // "Later" just dismisses, "Yes" starts the extras tour directly.
        // No longer auto-dismisses (Sep 2026 — "it disappeared too fast"):
        // stays up until the person actually answers Yes/Later/closes it.
        useAppStore.getState().setExtrasOfferPending(true);
        const clearPending = () => useAppStore.getState().setExtrasOfferPending(false);
        toast("Want more tips & tricks?", {
          duration: Infinity,
          cancel: { label: "Later", onClick: clearPending },
          action: {
            label: "Yes",
            onClick: () => {
              clearPending();
              useAppStore.getState().startTour("extras");
            },
          },
          onDismiss: clearPending,
          onAutoClose: clearPending,
        });
      }
    }

    const driveSteps: DriveStep[] = tourSteps.map((step) => {
      // Bug fix (Sep 2026): onPopoverRender's requireValue/requireChange
      // branches were attaching real DOM listeners (to the actual page's
      // input, or a MutationObserver on the actual page's element) and
      // never removing them when the step was left — driver.js only
      // destroys its OWN popover/overlay between steps, not the real app
      // elements it was pointed at, so a still-open Sheet (true for the
      // reminder flow, where "when" and "save" are two steps inside the
      // same open Sheet) meant that listener just kept sitting on the
      // real date input indefinitely. Leading suspect for the native
      // calendar re-opening a step later than where it was picked.
      // driver.js has a real onDeselected hook for exactly this, that
      // nothing in this file was using — cleanupListeners closes over
      // this one step's own listener/observer so onDeselected can
      // release it the moment the tour moves off this step.
      let cleanupListeners: (() => void) | undefined;
      return {
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
                cleanupListeners = () => {
                  control?.removeEventListener("input", update);
                  control?.removeEventListener("change", update);
                };
              }
            : step.requireChange
              ? (popover, opts) => {
                  const target = opts.driver.getActiveElement();
                  if (!target) return;
                  const initialText = target.textContent;
                  popover.nextButton.style.display = "none";
                  const observer = new MutationObserver(() => {
                    if (target.textContent !== initialText) {
                      popover.nextButton.style.display = "";
                      observer.disconnect();
                    }
                  });
                  observer.observe(target, { childList: true, subtree: true, characterData: true });
                  cleanupListeners = () => observer.disconnect();
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
          // Bug fix (Sep 18 2026): confirmed by reading driver.js's own
          // compiled source (its internal x() function, run every time a
          // step highlights) — it deliberately auto-focuses the first
          // focusable element it finds inside the popover or the target
          // itself, for accessibility (so keyboard/screen-reader users land
          // on the right control). That's driver.js's own built-in behavior,
          // not this app's code or anything added by a previous fix. The
          // side effect on a phone: whenever a step's target is a real
          // <input> or <textarea> (the money/text fields, "what"), that
          // auto-focus opens the on-screen keyboard the instant the step
          // appears — before the person has tapped anything — confirmed as
          // the cause of the keyboard popping open unprompted on several
          // steps, and of it still being open (and blocking the next
          // step's dialogue box) on the step right after. Blurring
          // whatever driver.js just force-focused, once, right as each
          // step finishes highlighting, cancels that without touching
          // anything the person does afterward — if they then tap the
          // field themselves a moment later, that's a fresh, real focus
          // event this code never sees or interferes with.
          // Two refinements, Sep 18 2026 later same night, both from a real
          // device video:
          // - Scoped to touch devices only. Desktop has no on-screen
          //   keyboard for this to protect against, and undoing driver.js's
          //   own focus is arguably a small accessibility regression there
          //   (it's what lets keyboard/screen-reader users land on the
          //   control) — so only step in where the problem actually exists.
          // - Skip native date/time-type inputs specifically. Confirmed on
          //   video: after picking a date, that field can still be the
          //   logically-focused element even once its native calendar
          //   closes, and calling .blur() on an iOS date input in that
          //   state can make Safari flash the calendar open again — this
          //   was the direct cause of "the calendar popped up a second
          //   time" on the very next step. Every other field type doesn't
          //   have this quirk, so excluding just date-like inputs keeps
          //   the original fix intact everywhere it was actually needed.
          if (isTouchDevice) {
            const active = document.activeElement as HTMLElement | null;
            const isDateLikeInput =
              active instanceof HTMLInputElement &&
              ["date", "time", "datetime-local", "month", "week"].includes(active.type);
            if (active && !isDateLikeInput) active.blur();
          }
        },
        onDeselected: () => {
          cleanupListeners?.();
          cleanupListeners = undefined;
        },
      };
    });

    const driverObj: Driver = driver({
      showProgress: true,
      progressText: "{{current}} of {{total}}",
      overlayOpacity: 0.55,
      // Bug fix (Sep 18 2026): confirmed by reading driver.js's own source —
      // its default (animate: true, duration: 400) animates the spotlight
      // sliding to each new step's target over 400ms, AND deliberately
      // withholds the popover text box until that slide is more than half
      // finished. That's the real cause of the reported "highlight moves
      // first, popover follows a split second later" stagger on several
      // steps — it's driver.js's own built-in default behavior, not a bug
      // in this app's code, just never tuned. Turning animation off makes
      // every highlight snap into place instantly instead, so there's
      // nothing left to visibly lag behind. Trade-off, accepted: this also
      // removes a one-time fade-in when the tour first opens — a small
      // cosmetic loss in exchange for a snappier, more consistent feel.
      animate: false,
      // Bug fix (Aug 28, 2026): 8px was bleeding into tightly-packed
      // neighbors — confirmed as the shared cause of two separately
      // reported bugs: Tour 2 Step 2's "duplicate" icon highlight
      // showing a sliver of the adjacent pencil/edit icon to its left,
      // and Step 9's highlight box (the actual spotlight, not the
      // popover — that one already got its own separate mt-2 fix in
      // loans.tsx) still catching part of "Total Owed" below the
      // just-saved card. driver.js has no per-step override for this
      // (confirmed earlier via its own type defs — global only), so a
      // uniform reduction is the only real lever available; a few px
      // less padding on every highlight in both tours is a safe,
      // consistent tightening, not a special case for just these two.
      stagePadding: 4,
      stageRadius: STAGE_RADIUS,
      smoothScroll: true,
      allowClose: true,
      // Defaults to true in driver.js — confirmed the actual cause of
      // being able to scroll the real page while the tour was open, with
      // the spotlight visibly lagging behind trying to keep up. The tour
      // already covers everything with an overlay; there's nothing useful
      // to scroll to underneath it anyway.
      allowScroll: false,
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
        lastActiveIndex = idx;
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
        // window.location, not React's own location state (which was here
        // before): confirmed real bug — React's location hook lags one
        // render behind an actual navigation (the browser's History API
        // updates window.location synchronously; React's own re-render
        // with the new value follows a moment later). That lag meant a
        // step like member-confirm, whose route matched where the
        // PREVIOUS step's own real tap (a nav link) already sent the
        // page, saw a stale "still on the old route" reading here and
        // fired a second, redundant navigate() call — racing the
        // first one already in flight. That's what was landing the
        // popover pinned in the corner over a dummy placeholder: the
        // real target was never actually found, because the page was
        // mid-collision between two navigations instead of settled on
        // one.
        if (nextTourStep?.route && window.location.pathname !== nextTourStep.route) {
          navigate({ to: nextTourStep.route });
        }
        // Correction (Aug 28, 2026): scrollToTarget used to run here,
        // BEFORE the settleDelay wait below. That was fine for a step like
        // "upcoming" whose target already exists on the page regardless of
        // timing — but wrong for "reminders-section", confirmed as the
        // REAL cause of that step's "flies from top to middle" glitch
        // (two earlier attempts at this fixed the wrong thing — see that
        // step's own comment in tourSteps.ts). Expanding the card can push
        // reminders-section below the fold, exactly like the already-fixed
        // Step 10 bug: allowScroll:false locks <body> scroll, silently
        // defeating driver.js's own scroll-into-view for anything
        // off-screen. But reminders-section ALSO doesn't exist in the DOM
        // at all until React re-renders the expanded card — so scrolling
        // to it here, before that render happens, would find nothing.
        // Moved inside the settleDelay callback below, so it only runs
        // once the real element is guaranteed to exist.
        function scrollToTargetIfNeeded() {
          if (nextTourStep?.scrollToTarget) {
            document.body.classList.remove("driver-no-scroll");
            const el = document.querySelector(`[data-tour="${nextTourStep.target}"]`);
            el?.scrollIntoView({ behavior: "auto", block: "center" });
            document.body.classList.add("driver-no-scroll");
          }
        }
        // See settleDelay's own comment in tourSteps.ts — waiting here,
        // BEFORE driver.js starts looking for the next target, is what
        // actually fixes the "appears wrong, then visibly snaps into
        // place" look: driver.js's own first measurement only happens
        // once moveNext() is called, so delaying that call means the
        // Sheet/route transition has already finished by the time it
        // measures, instead of needing a correction afterward.
        // Reverted (Sep 2026): the "wait for stable position" version below
        // was tried across two rounds and made things worse or unchanged
        // on a real device, not better — clear enough signal to stop
        // experimenting on this and go back to what was actually working.
        if (nextTourStep?.settleDelay) {
          window.setTimeout(() => {
            scrollToTargetIfNeeded();
            opts.driver.moveNext();
          }, nextTourStep.settleDelay);
        } else {
          scrollToTargetIfNeeded();
          opts.driver.moveNext();
        }
      },
      onCloseClick: () => {
        const idx = driverObj.getActiveIndex() ?? 0;
        finish(idx < tourSteps.length - 1);
        driverObj.destroy();
      },
      onDestroyed: () => {
        finish(lastActiveIndex < tourSteps.length - 1);
      },
    });

    const first = tourSteps[0];
    if (first?.route && window.location.pathname !== first.route) {
      navigate({ to: first.route });
    }
    if (first?.settleDelay) {
      window.setTimeout(() => driverObj.drive(), first.settleDelay);
    } else {
      driverObj.drive();
    }

    // Bug fix (Aug 28, 2026): reported as the tour app becoming completely
    // frozen/unresponsive on an iPhone Home Screen web app after being
    // backgrounded mid-tour, surviving a force-quit and reopen, only
    // clearing itself after roughly a minute. Real, confirmed mechanism:
    // settleDelay (and the scrollToTarget fix above) both depend on
    // window.setTimeout to eventually call moveNext() — but iOS aggressively
    // suspends/throttles JS timers for a backgrounded tab or installed web
    // app. If that timer never fires, nothing is left to ever advance or
    // clean up driver.js's full-screen overlay, which blocks every click on
    // the page by design — exactly the reported symptom. This isn't
    // something the app can make reliable (iOS owns that scheduling), so
    // instead of trying to fix backgrounded timers, force a clean recovery
    // on resume: if the page was hidden for more than a few seconds and
    // driver.js is still nominally active when it becomes visible again,
    // don't trust whatever state it's in — end the tour outright.
    // Threshold raised from 3s to 20s (Sep 2026): the original 3s assumed
    // ending the tour was low-cost, since reloading the page was always an
    // easy recovery. On a PWA added to the Home Screen, there's no visible
    // reload button or pull-to-refresh — reported as the tour disappearing
    // just from a brief few-second app switch, with no easy way back in.
    // 20s still catches genuinely extended backgrounding (the real
    // iOS-timer-suspension failure this guards against), just without
    // punishing a quick notification check or app switch.
    let hiddenAt: number | null = null;
    function handleVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 20000 && driverObj.isActive()) {
        driverObj.destroy();
        document.body.classList.remove(
          "driver-active",
          "driver-fade",
          "driver-simple",
          "driver-no-scroll",
        );
        finish(true);
      }
      hiddenAt = null;
    }
    document.addEventListener("visibilitychange", handleVisibility);

    // Sep 18 2026 — Option A (hide highlight+popover on focus/blur, wait a
    // fixed pause, reposition, reveal) tried here and reverted same night.
    // Confirmed on a real device video it made things worse, not better:
    // while a field was actively being typed into, the popover stayed
    // hidden and the highlight stayed frozen on the wrong fields for the
    // ENTIRE time typing continued (evidence pointed to the reveal timer
    // never getting a clean run — something about typing kept resetting
    // it), not just briefly as intended. That's a bigger loss of
    // information than the original bug being replaced. Also flagged: it
    // ran unconditionally on desktop too, which was never actually needed
    // there — this file had no touch-device gating at all before tonight.
    // Reverted rather than tuned again: this is now four attempts at this
    // specific bug (three before tonight, plus this one) — no fifth blind
    // attempt without new evidence pointing at a specific different
    // mechanism. Current state: no custom keyboard-repositioning code
    // remains. The underlying bug (driver.js's highlight freezing at its
    // pre-keyboard screen position while the real page scrolls under it)
    // is UNSOLVED, not fixed — known, accepted for now, not silently
    // dropped. The keyboard-auto-popping-open fix above (a different,
    // confirmed-working mechanism, now scoped to touch devices only) is
    // unaffected by this revert.

    // Sep 20 2026 — re-measure on touch devices when the keyboard opens/closes.
    // Found by comparing against the Aug 31 version of this file: that version
    // had a visualViewport listener calling refresh(); the Sep 18 revert of
    // "Option A" removed it too, even though it was a separate, simpler
    // mechanism (it never hid anything). Real iPhone Safari screenshot after
    // typing a balance: highlight left behind on the wrong field once the
    // keyboard closed. Nothing here hides or freezes anything (that was what
    // went wrong with Option A) — it only asks driver.js to re-measure. Touch
    // devices only, per the Sep 18 scoping rule.
    let refreshRaf = 0;
    let refreshTimers: number[] = [];
    function refreshNow() {
      if (refreshRaf) return;
      refreshRaf = window.requestAnimationFrame(() => {
        refreshRaf = 0;
        if (driverObj.isActive()) driverObj.refresh();
      });
    }
    // focusin/focusout are reliable on iOS even when visualViewport events
    // are not (e.g. Home Screen app). The keyboard slides for roughly 300ms,
    // so re-measure a few times across that window, not just once.
    function refreshAfterFocusChange() {
      refreshTimers.forEach((t) => window.clearTimeout(t));
      refreshTimers = [150, 400, 800].map((ms) => window.setTimeout(refreshNow, ms));
    }
    const vv = window.visualViewport;
    if (isTouchDevice) {
      vv?.addEventListener("resize", refreshNow);
      vv?.addEventListener("scroll", refreshNow);
      document.addEventListener("focusin", refreshAfterFocusChange);
      document.addEventListener("focusout", refreshAfterFocusChange);
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      vv?.removeEventListener("resize", refreshNow);
      vv?.removeEventListener("scroll", refreshNow);
      document.removeEventListener("focusin", refreshAfterFocusChange);
      document.removeEventListener("focusout", refreshAfterFocusChange);
      refreshTimers.forEach((t) => window.clearTimeout(t));
      if (refreshRaf) window.cancelAnimationFrame(refreshRaf);
      if (driverObj.isActive()) driverObj.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour, isViewer]);

  return null;
}
