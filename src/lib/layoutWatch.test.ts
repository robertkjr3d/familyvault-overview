import { describe, it, expect } from "vitest";
import { watchLayout } from "./layoutWatch";

// A stand-in for the browser's ResizeObserver that lets a test trigger it.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: unknown) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.callback();
  }
}

function setup() {
  FakeResizeObserver.instances = [];
  const frames = new Map<number, () => void>();
  let nextId = 1;
  const cancelled: number[] = [];
  const env = {
    ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
    raf: (cb: () => void) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    },
  };
  const runFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb());
  };
  return { env, frames, runFrames, cancelled };
}

describe("watchLayout", () => {
  it("watches every element it is given and ignores missing ones", () => {
    const { env } = setup();
    const a = {} as Element;
    const b = {} as Element;
    watchLayout([a, null, b, undefined], () => {}, env);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0].observed).toEqual([a, b]);
  });

  it("calls onChange once per frame, however many resizes happen in it", () => {
    const { env, runFrames } = setup();
    let calls = 0;
    watchLayout([{} as Element], () => calls++, env);
    const ro = FakeResizeObserver.instances[0];
    ro.fire();
    ro.fire();
    ro.fire();
    expect(calls).toBe(0); // nothing until the frame runs
    runFrames();
    expect(calls).toBe(1);
    ro.fire();
    runFrames();
    expect(calls).toBe(2); // a later resize is picked up again
  });

  it("stops: disconnects, cancels a waiting frame and never calls back", () => {
    const { env, runFrames, cancelled } = setup();
    let calls = 0;
    const stop = watchLayout([{} as Element], () => calls++, env);
    const ro = FakeResizeObserver.instances[0];
    ro.fire(); // a frame is now waiting
    stop();
    expect(ro.disconnected).toBe(true);
    expect(cancelled.length).toBe(1);
    runFrames();
    ro.fire();
    runFrames();
    expect(calls).toBe(0);
  });

  it("does nothing, safely, where ResizeObserver does not exist", () => {
    const stop = watchLayout([{} as Element], () => {}, {
      ResizeObserverImpl: undefined,
      raf: () => 1,
      caf: () => {},
    });
    // In Node there is no global ResizeObserver, so this is the fallback path.
    expect(() => stop()).not.toThrow();
  });
});
