import { describe, expect, it } from "vitest";
import { toEditorHtml, sanitizeHtml, htmlToPlainText } from "./notesHtml";

// What the browser's editor really stores for text typed into an EMPTY note:
// no tags, with a trailing space as &nbsp; and "&" as &amp;.
describe("toEditorHtml", () => {
  it("does not double-escape &nbsp; from plain typed text (the reported bug)", () => {
    const saved = "Call the agent&nbsp;";
    expect(toEditorHtml(saved)).toBe("Call the agent&nbsp;");
    expect(toEditorHtml(saved)).not.toContain("&amp;nbsp;");
  });

  it("does not double-escape & from plain typed text", () => {
    expect(toEditorHtml("R&amp;D budget")).toBe("R&amp;D budget");
  });

  it("is stable: loading what was just saved gives back exactly what was saved", () => {
    for (const saved of ["a&nbsp;", "x &lt; y", "<p>hi&nbsp;</p>", "<ul><li>a</li></ul>"]) {
      expect(toEditorHtml(saved)).toBe(sanitizeHtml(saved));
    }
  });

  it("still escapes genuine old plain-text notes", () => {
    expect(toEditorHtml("Tom & Jerry")).toBe("<p>Tom &amp; Jerry</p>");
    expect(toEditorHtml("line one\nline two")).toBe("<p>line one</p><p>line two</p>");
    expect(toEditorHtml("<b not html")).toBe("<p>&lt;b not html</p>");
  });

  it("handles empty values", () => {
    expect(toEditorHtml(null)).toBe("");
    expect(toEditorHtml("   ")).toBe("");
  });
});

describe("htmlToPlainText (no document)", () => {
  it("treats &nbsp; as a space", () => {
    expect(htmlToPlainText("a&nbsp;b")).toBe("a b");
  });
});

import { noteCount } from "./notesHtml";
describe("noteCount", () => {
  it("is 0 for empty / blank-markup notes", () => {
    for (const v of [null, undefined, "", "   ", "<br>", "<div><br></div>", "<p>&nbsp;</p>"])
      expect(noteCount(v)).toBe(0);
  });
  it("is 1 for notes with visible text (html or legacy plain text)", () => {
    for (const v of ["<p>Call agent</p>", "plain legacy note", "<ul><li>a</li></ul>", "<b>x</b>"])
      expect(noteCount(v)).toBe(1);
  });
});
