// Runs in the plain Node environment (no DOM), like server rendering does.
import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./notesHtml";

describe("sanitizeHtml without a DOM (server side) fails closed", () => {
  it("returns escaped text only, never HTML", () => {
    const out = sanitizeHtml('<b>hi</b><img src="x"onerror="window.__pwned=1">');
    expect(out).not.toContain("<");
    expect(out).toContain("hi");
  });
});
