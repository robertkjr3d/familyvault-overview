/**
 * Watches elements for size changes and calls `onChange` at most once per
 * animation frame. Returns a function that stops watching.
 *
 * Used by the guided tour for a step whose target can grow or move AFTER the
 * tour has measured it (the dashboard's "Due in the Next 90 Days" list fills in
 * as reminders and other records finish loading). It reacts to real layout
 * events -- it does not wait or poll -- and the caller decides what to do (the
 * tour re-centres the target and asks driver.js to re-measure).
 *
 * The environment pieces are injectable only so the behaviour can be tested
 * without a browser.
 */
export type LayoutWatchEnv = {
  ResizeObserverImpl?: typeof ResizeObserver;
  raf?: (cb: () => void) => number;
  caf?: (id: number) => void;
};

export function watchLayout(
  elements: Array<Element | null | undefined>,
  onChange: () => void,
  env: LayoutWatchEnv = {},
): () => void {
  const RO =
    env.ResizeObserverImpl ?? (typeof ResizeObserver !== "undefined" ? ResizeObserver : undefined);
  if (!RO) return () => {};
  const raf = env.raf ?? ((cb: () => void) => window.requestAnimationFrame(cb));
  const caf = env.caf ?? ((id: number) => window.cancelAnimationFrame(id));

  let stopped = false;
  let scheduled = false;
  let frameId = 0;

  const observer = new RO(() => {
    if (stopped || scheduled) return;
    scheduled = true;
    frameId = raf(() => {
      scheduled = false;
      if (!stopped) onChange();
    });
  });
  for (const el of elements) if (el) observer.observe(el);

  return () => {
    stopped = true;
    observer.disconnect();
    if (scheduled) {
      caf(frameId);
      scheduled = false;
    }
  };
}
