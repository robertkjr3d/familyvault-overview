// Scrolls a record card into the middle of the screen's VISIBLE area (the part
// not covered by the sticky header or the bottom tab bar), then checks twice
// that it really ended up there. The check matters because content above the
// card (totals, notes) can finish loading while the smooth scroll is running,
// which used to leave the card partly hidden.

export type Band = { top: number; bottom: number };

const PEEK_PX = 12; // gap kept under the header when a card is taller than the screen
const MARGIN_PX = 8; // a card this close to the edge of the visible area counts as "in view"

/** How many px to scroll (positive = down) to centre the card in the visible area. */
export function centerDelta(card: Band, view: Band): number {
  const cardH = card.bottom - card.top;
  const viewH = view.bottom - view.top;
  if (cardH >= viewH - 2 * PEEK_PX) return card.top - (view.top + PEEK_PX); // too tall to centre: show its top
  return card.top - (view.top + (viewH - cardH) / 2);
}

/** True when the card is fully inside the visible area (or, if taller, its top is). */
export function isInView(card: Band, view: Band): boolean {
  const cardH = card.bottom - card.top;
  const viewH = view.bottom - view.top;
  if (cardH >= viewH - 2 * PEEK_PX) {
    return card.top >= view.top - 1 && card.top <= view.top + 3 * PEEK_PX;
  }
  return card.top >= view.top + MARGIN_PX - 1 && card.bottom <= view.bottom - MARGIN_PX + 1;
}

/** The part of the window not covered by the sticky header or the fixed bottom bar. */
export function visibleBand(): Band {
  let top = 0;
  let bottom = window.innerHeight;
  const header = document.querySelector("body header");
  if (header) {
    const pos = getComputedStyle(header).position;
    if (pos === "sticky" || pos === "fixed")
      top = Math.max(0, header.getBoundingClientRect().bottom);
  }
  const bar = document.querySelector("nav.fixed.bottom-0");
  if (bar) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
  return { top, bottom: Math.max(bottom, top + 1) };
}

const RECHECK_AT_MS = [900, 1700];

/** Smooth-scrolls to the card, then corrects it if it is not in view. Returns a cancel function. */
export function scrollCardIntoView(el: HTMLElement): () => void {
  const place = (behavior: ScrollBehavior, onlyIfNeeded: boolean) => {
    const card = el.getBoundingClientRect();
    const view = visibleBand();
    if (onlyIfNeeded && isInView(card, view)) return;
    const delta = centerDelta(card, view);
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior });
  };
  place("smooth", false);
  const timers = RECHECK_AT_MS.map((ms) => setTimeout(() => place("auto", true), ms));
  return () => timers.forEach(clearTimeout);
}
