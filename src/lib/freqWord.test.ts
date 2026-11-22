import { describe, it, expect } from "vitest";
import { freqLabel, freqWord } from "@/lib/options";

describe("freqWord (words for the Premium/Payout frequency rows)", () => {
  it("maps every stored value to a standalone word", () => {
    expect(freqWord("annual")).toBe("Yearly");
    expect(freqWord("semi-annual")).toBe("Half-yearly");
    expect(freqWord("quarterly")).toBe("Quarterly");
    expect(freqWord("monthly")).toBe("Monthly");
    expect(freqWord("one-off")).toBe("One-off");
  });
  it("ignores capital letters and falls back to a capitalised word", () => {
    expect(freqWord("ANNUAL")).toBe("Yearly");
    expect(freqWord("weekly")).toBe("Weekly");
  });
  it("returns nothing for empty values", () => {
    expect(freqWord(null)).toBe("");
    expect(freqWord(undefined)).toBe("");
  });
  it("leaves freqLabel (the '/year' unit used on insurance cards) unchanged", () => {
    expect(freqLabel("annual")).toBe("year");
    expect(freqLabel("monthly")).toBe("month");
    expect(freqLabel("semi-annual")).toBe("half-year");
  });
});
