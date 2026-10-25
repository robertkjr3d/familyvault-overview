/**
 * idleReturn.ts
 *
 * Oct 25 2026. A tab left in the background for a long time can come back
 * stuck on "loading" (the browser pauses the app's timers, including the one
 * that renews the sign-in, and the page waits for something that never comes).
 * Refreshing fixes it, so we refresh automatically when the person returns
 * after a long absence.
 *
 * Safety: we never refresh while the person might be mid-task: a dialog is
 * open, they are typing in a field, or the guided tour is showing.
 */

export const IDLE_RELOAD_AFTER_MS = 30 * 60 * 1000;

export function shouldReloadAfterIdle(params: {
  hiddenAt: number | null;
  now: number;
  busy: boolean;
  minMs?: number;
}): boolean {
  const { hiddenAt, now, busy, minMs = IDLE_RELOAD_AFTER_MS } = params;
  if (hiddenAt === null || busy) return false;
  return now - hiddenAt >= minMs;
}

function personMightBeMidTask(): boolean {
  const el = document.activeElement;
  const typing =
    !!el &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
  const dialogOpen = !!document.querySelector(
    '[role="dialog"], [role="alertdialog"], .driver-popover',
  );
  return typing || dialogOpen;
}

let _installed = false;

export function setupIdleReturnReload(): void {
  if (typeof window === "undefined" || _installed) return;
  _installed = true;
  let hiddenAt: number | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const reload = shouldReloadAfterIdle({
      hiddenAt,
      now: Date.now(),
      busy: personMightBeMidTask(),
    });
    hiddenAt = null;
    if (reload) window.location.reload();
  });
}
