import { describe, it, expect } from "vitest";
import { shouldReloadAfterIdle, IDLE_RELOAD_AFTER_MS } from "./idleReturn";

describe("shouldReloadAfterIdle", () => {
  const now = 10_000_000;
  it("reloads after a long absence", () => {
    expect(shouldReloadAfterIdle({ hiddenAt: now - IDLE_RELOAD_AFTER_MS, now, busy: false })).toBe(
      true,
    );
  });
  it("does not reload after a short absence", () => {
    expect(shouldReloadAfterIdle({ hiddenAt: now - 5 * 60_000, now, busy: false })).toBe(false);
  });
  it("never reloads when the person might be mid-task", () => {
    expect(shouldReloadAfterIdle({ hiddenAt: now - 3 * 3_600_000, now, busy: true })).toBe(false);
  });
  it("does nothing if the tab was never hidden", () => {
    expect(shouldReloadAfterIdle({ hiddenAt: null, now, busy: false })).toBe(false);
  });
});
