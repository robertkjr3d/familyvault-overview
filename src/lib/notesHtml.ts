// Pure helpers for the Notes editor (kept out of the component so they can be tested).
import DOMPurify from "dompurify";

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only what the Notes editor itself can produce. No attributes at all, so there is no place
// for onerror=, onload=, href=javascript: or style= to hide. Everything else is removed.
const ALLOWED_TAGS = ["b", "strong", "i", "em", "u", "p", "br", "div", "span", "ul", "ol", "li"];

/**
 * Cleans note HTML with DOMPurify (an allowlist sanitizer), replacing the old pattern-matching
 * filter that could be bypassed (for example `<img src="x"onerror=...>`). In the browser this is
 * the real protection. On the server there is no DOM, so it fails closed: tags are dropped and
 * only escaped text is returned. That output is never put into a page (the editor only sets
 * innerHTML in the browser).
 */
export function sanitizeHtml(input: string): string {
  if (typeof window === "undefined") {
    return escapeHtml(
      input
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return DOMPurify.sanitize(input, { ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

// A saved note is HTML if it has a tag OR one of the entities the browser's
// editor writes into plain typed text (a trailing space is saved as &nbsp;,
// "&" as &amp;). Before this check, text typed into an empty note had no tag,
// was treated as plain text, and was escaped a second time on reload, so the
// note showed a literal "&nbsp;" / "&amp;".
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>|&(?:nbsp|amp|lt|gt);/i;

export function toEditorHtml(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";

  if (LOOKS_LIKE_HTML.test(v)) {
    return sanitizeHtml(v);
  }

  const lines = (value ?? "").split(/\n/);
  return lines.map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>")).join("");
}

export function htmlToPlainText(html: string): string {
  if (typeof DOMParser !== "undefined") {
    // DOMParser makes an inert document: nothing in it runs and no images load. (The old
    // code put the stored HTML into a div created with document.createElement, which DOES
    // load images and fire onerror handlers, on every record list.)
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body?.textContent ?? "").replace(/\u00a0/g, " ").trim();
  }
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 1 if a saved note has visible text, else 0. Used for the number on a card's Notes header.
 * Looks at the text, not just whether the column is non-null, so a note that was emptied but
 * left behind blank markup (e.g. "<br>") does not show a misleading "1". */
export function noteCount(notes: string | null | undefined): number {
  return htmlToPlainText(notes ?? "") ? 1 : 0;
}
