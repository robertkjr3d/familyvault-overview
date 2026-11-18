// @vitest-environment jsdom
// Script-injection checks for the Notes editor's HTML cleaner. These payloads include the ones
// that got past the old pattern-matching filter (no space before onerror=, slash separators).
import { describe, it, expect } from "vitest";
import { sanitizeHtml, htmlToPlainText, toEditorHtml, noteCount } from "./notesHtml";

const ATTACKS: Record<string, string> = {
  "img onerror": '<img src=x onerror="window.__pwned=1">',
  "img onerror, no space before on": '<img src="x"onerror="window.__pwned=1">',
  "img onerror, slash separator": '<img/src="x"/onerror="window.__pwned=1">',
  "svg onload": '<svg/onload="window.__pwned=1">',
  "details ontoggle": "<details open ontoggle=window.__pwned=1>x</details>",
  "input autofocus": "<input autofocus onfocus=window.__pwned=1>",
  "javascript link, entity tab": '<a href="jav&#x09;ascript:window.__pwned=1">x</a>',
  "javascript link, plain": '<a href="javascript:window.__pwned=1">x</a>',
  "iframe srcdoc": '<iframe srcdoc="&lt;img src=x onerror=parent.__pwned=1&gt;"></iframe>',
  "script tag": "<script>window.__pwned=1</script>",
  "style tag": "<style>body{display:none}</style>",
  "object/embed": '<object data="x"></object><embed src="x">',
  "form action": '<form action="javascript:window.__pwned=1"><button>go</button></form>',
  "math mXSS": "<math><mtext><table><mglyph><style><img src=x onerror=window.__pwned=1>",
};

describe("sanitizeHtml blocks script injection", () => {
  for (const [name, payload] of Object.entries(ATTACKS)) {
    it(name, () => {
      const out = sanitizeHtml(payload);
      expect(out).not.toMatch(/<(script|img|svg|iframe|object|embed|form|input|style|math|a)\b/i);
      expect(out).not.toMatch(/\son\w+\s*=/i);
      expect(out).not.toMatch(/javascript:/i);
    });
  }
  it("keeps the formatting the editor produces", () => {
    expect(sanitizeHtml("<b>bold</b> <i>italic</i>")).toBe("<b>bold</b> <i>italic</i>");
    expect(sanitizeHtml("<ul><li>one</li><li>two</li></ul>")).toBe(
      "<ul><li>one</li><li>two</li></ul>",
    );
    expect(sanitizeHtml("<div>line</div><div><br></div>")).toBe("<div>line</div><div><br></div>");
  });
  it("removes every attribute", () => {
    expect(sanitizeHtml('<p style="color:red" class="x" id="y">hi</p>')).toBe("<p>hi</p>");
  });
});

describe("stored notes are cleaned on the way into the editor and read safely for the badge", () => {
  it("toEditorHtml cleans a stored malicious note", () => {
    const out = toEditorHtml('hello <img src="x"onerror="window.__pwned=1">');
    expect(out).not.toMatch(/onerror|<img/i);
  });
  it("htmlToPlainText reads text without executing anything (inert parser)", () => {
    expect(htmlToPlainText('<b>hi</b><img src="x"onerror="window.__pwned=1"> there')).toBe(
      "hi there",
    );
  });
  it("noteCount still counts visible text and ignores empty markup", () => {
    expect(noteCount("<div><br></div>")).toBe(0);
    expect(noteCount("<div>remember this</div>")).toBe(1);
  });
});
