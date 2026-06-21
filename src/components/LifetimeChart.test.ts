import { describe, it, expect } from "vitest";
import { freqTimesPerYear } from "../lib/lifetimeChartMath";

describe("freqTimesPerYear", () => {
  it("maps monthly to 12", () => {
    expect(freqTimesPerYear("monthly")).toBe(12);
  });

  it("maps quarterly to 4", () => {
    expect(freqTimesPerYear("quarterly")).toBe(4);
  });

  it("maps semi-annual and half-yearly variants to 2", () => {
    expect(freqTimesPerYear("semi-annual")).toBe(2);
    expect(freqTimesPerYear("half-yearly")).toBe(2);
  });

  it("maps annual to 1", () => {
    expect(freqTimesPerYear("annual")).toBe(1);
  });

  it("treats one-off, unrecognised, or missing frequency as 1x (a single occurrence this year)", () => {
    expect(freqTimesPerYear("one-off")).toBe(1);
    expect(freqTimesPerYear(null)).toBe(1);
    expect(freqTimesPerYear(undefined)).toBe(1);
    expect(freqTimesPerYear("")).toBe(1);
  });

  it("is case-insensitive", () => {
    expect(freqTimesPerYear("MONTHLY")).toBe(12);
    expect(freqTimesPerYear("Quarterly")).toBe(4);
  });
});
