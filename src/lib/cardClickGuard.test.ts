import { describe, expect, it } from "vitest";
import { isHighlightingInside } from "./cardClickGuard";

const inside = {};
const outside = {};
const container = { contains: (n: unknown) => n === inside };
const sel = (over: Partial<{ isCollapsed: boolean; text: string; anchorNode: unknown }> = {}) => ({
  isCollapsed: over.isCollapsed ?? false,
  anchorNode: "anchorNode" in over ? over.anchorNode : inside,
  toString: () => over.text ?? "some text",
});

describe("isHighlightingInside", () => {
  it("true when text is highlighted and started inside the card header", () => {
    expect(isHighlightingInside(sel(), container)).toBe(true);
  });
  it("false for a plain tap (nothing highlighted)", () => {
    expect(isHighlightingInside(null, container)).toBe(false);
    expect(isHighlightingInside(sel({ isCollapsed: true, text: "" }), container)).toBe(false);
  });
  it("false when the highlight is only whitespace", () => {
    expect(isHighlightingInside(sel({ text: "  \n " }), container)).toBe(false);
  });
  it("false when the highlight is somewhere else on the page (must not block a normal tap)", () => {
    expect(isHighlightingInside(sel({ anchorNode: outside }), container)).toBe(false);
    expect(isHighlightingInside(sel({ anchorNode: null }), container)).toBe(false);
  });
});
