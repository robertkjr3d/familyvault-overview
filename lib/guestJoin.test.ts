import { describe, it, expect } from "vitest";
import { guestJoinPhaseFor } from "./guest";

describe("guestJoinPhaseFor", () => {
  it("keeps the phase for the same guest", () => {
    expect(guestJoinPhaseFor({ userId: "A", phase: "done" }, "A")).toBe("done");
    expect(guestJoinPhaseFor({ userId: "A", phase: "joining" }, "A")).toBe("joining");
  });
  it("starts a NEW guest from idle (the 'Sample family unavailable' bug)", () => {
    expect(guestJoinPhaseFor({ userId: "A", phase: "done" }, "B")).toBe("idle");
    expect(guestJoinPhaseFor({ userId: "A", phase: "failed" }, "B")).toBe("idle");
  });
  it("is idle when nobody is signed in", () => {
    expect(guestJoinPhaseFor({ userId: "A", phase: "done" }, null)).toBe("idle");
    expect(guestJoinPhaseFor({ userId: "A", phase: "done" }, undefined)).toBe("idle");
  });
});
