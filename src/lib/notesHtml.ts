// Pure helpers for the Notes editor (kept out of the component so they can be tested).

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");
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
  if (typeof document !== "undefined") {
    const node = document.createElement("div");
    node.innerHTML = html;
    return (node.textContent ?? "").replace(/\u00a0/g, " ").trim();
  }
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
