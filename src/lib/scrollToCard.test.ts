import { describe, expect, it } from "vitest";
import { centerDelta, isInView } from "./scrollToCard";

// Visible area: below an 85px header, above a 64px bottom bar, on a 720px-high window.
const view = { top: 85, bottom: 656 };

describe("centerDelta", () => {
  it("is 0 when the card is already centred", () => {
    // card 130px high centred in 571px: top = 85 + (571-130)/2 = 305.5
    expect(centerDelta({ top: 305.5, bottom: 435.5 }, view)).toBeCloseTo(0, 5);
  });
  it("scrolls down (positive) when the card is below the centre", () => {
    expect(centerDelta({ top: 505.5, bottom: 635.5 }, view)).toBeCloseTo(200, 5);
  });
  it("scrolls up (negative) when the card is above the centre", () => {
    expect(centerDelta({ top: 105.5, bottom: 235.5 }, view)).toBeCloseTo(-200, 5);
  });
  it("for a card taller than the visible area, puts its top just under the header", () => {
    expect(centerDelta({ top: 900, bottom: 1500 }, view)).toBeCloseTo(900 - (85 + 12), 5);
  });
});

describe("isInView", () => {
  it("accepts a card fully inside the visible area", () => {
    expect(isInView({ top: 200, bottom: 330 }, view)).toBe(true);
  });
  it("rejects a card cut off by the bottom bar", () => {
    expect(isInView({ top: 560, bottom: 690 }, view)).toBe(false);
  });
  it("rejects a card hidden under the header", () => {
    expect(isInView({ top: 40, bottom: 170 }, view)).toBe(false);
  });
  it("rejects a card that is off screen", () => {
    expect(isInView({ top: 2000, bottom: 2130 }, view)).toBe(false);
  });
  it("accepts a card sitting right at the comfortable edge", () => {
    expect(isInView({ top: 93, bottom: 223 }, view)).toBe(true);
  });
  it("for a tall card, accepts its top being just under the header and rejects it being off screen", () => {
    expect(isInView({ top: 100, bottom: 700 }, view)).toBe(true);
    expect(isInView({ top: 900, bottom: 1500 }, view)).toBe(false);
  });
});
