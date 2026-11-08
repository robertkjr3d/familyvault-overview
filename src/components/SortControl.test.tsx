import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RECORD_SORT_LABELS, type RecordSort } from "@/lib/sort";

// Server-side rendering always reads a store's initial state, so the store is
// replaced by a tiny fake that lets each test pick the current sort order.
let current: RecordSort = "urgency";
vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: { recordSort: RecordSort; setRecordSort: () => void }) => unknown) =>
    selector({ recordSort: current, setRecordSort: () => {} }),
}));

import { SortControl } from "@/components/SortControl";

function render(): string {
  return renderToStaticMarkup(<SortControl />);
}

describe("SortControl", () => {
  beforeEach(() => {
    current = "urgency";
  });

  it("is a small icon-only button while the default order is used", () => {
    const html = render();
    expect(html).toContain("w-8");
    expect(html).not.toContain(`>${RECORD_SORT_LABELS.urgency}<`);
    // Screen readers and the hover label still say what it does and what is chosen.
    expect(html).toContain("Sort cards. Currently sorted by");
    expect(html).toContain('title="Sort cards"');
  });

  it("becomes a labelled pill when another order is chosen", () => {
    current = "name";
    const html = render();
    expect(html).toContain(`>${RECORD_SORT_LABELS.name}<`);
    expect(html).toContain("px-3");
    expect(html).not.toContain("w-8");
  });

  it("keeps the button the same height in both states so nothing below it moves", () => {
    const a = render();
    current = "edited";
    const b = render();
    expect(a).toContain("h-8");
    expect(b).toContain("h-8");
  });
});
