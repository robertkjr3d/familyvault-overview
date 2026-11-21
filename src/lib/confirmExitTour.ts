// Asks "Exit the tour?" before a tour is skipped (used by GuidedTour.tsx's X
// button). Uses the browser's own confirm box on purpose: it sits above
// everything, so it cannot clash with the tour's dark overlay the way a
// custom pop-up could.
//
// Safety net: the tour covers the whole screen, so the X must never become a
// dead end. A browser (or an in-app browser) that has switched confirm boxes
// off answers "Cancel" instantly without showing anything; a real person
// cannot answer in under ~150 ms. So an instant "Cancel", or a confirm box
// that throws, counts as "exit", exactly as the X behaved before this existed.
export const EXIT_TOUR_MESSAGE =
  "Exit the tour?\n\nTap OK to exit, or Cancel to keep going. You can take the tour again anytime from Settings.";

const INSTANT_ANSWER_MS = 150;

export function confirmExitTour(
  ask: (message: string) => boolean = (message) => window.confirm(message),
  now: () => number = () => performance.now(),
): boolean {
  const startedAt = now();
  let answer: boolean;
  try {
    answer = ask(EXIT_TOUR_MESSAGE);
  } catch {
    return true;
  }
  if (answer) return true;
  return now() - startedAt < INSTANT_ANSWER_MS;
}
