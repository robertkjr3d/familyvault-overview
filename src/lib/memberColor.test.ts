import { describe, it, expect } from "vitest";
import { readableMemberColor } from "./memberColor";

describe("readableMemberColor", () => {
  it("brightens a dark color for dark mode", () => {
    const result = readableMemberColor("#1a1a3d", true); // dark navy — unreadable on near-black
    expect(result).not.toBe("#1a1a3d");
    // spot-check it's actually lighter now, not just a different color
    const brightness = (hex: string) => {
      const n = parseInt(hex.replace("#", ""), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    expect(brightness(result)).toBeGreaterThan(brightness("#1a1a3d"));
  });

  it("leaves an already-bright color untouched for dark mode", () => {
    expect(readableMemberColor("#ff8844", true)).toBe("#ff8844");
  });

  it("darkens a too-light color for light mode", () => {
    const result = readableMemberColor("#fdf6e3", false); // near-white — unreadable on white
    expect(result).not.toBe("#fdf6e3");
  });

  it("leaves an already-dark color untouched for light mode", () => {
    expect(readableMemberColor("#8b0000", false)).toBe("#8b0000");
  });

  it("passes through non-hex input unchanged rather than guessing", () => {
    expect(readableMemberColor("not-a-color", true)).toBe("not-a-color");
  });
});
