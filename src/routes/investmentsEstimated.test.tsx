// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Renders the REAL Investments page with three sample investments and checks what
// is shown for Manual and for Estimated tracking (22 Nov 2026). Only things outside
// the page (data loading, the card frame, other panels) are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let ITEMS: any[] = [];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: any) => ({ options: opts }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (o: any) =>
    String(o.queryKey?.[0]) === "advisor-notes" ? { data: { notes: [] } } : { data: ITEMS },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/useCurrentRole", () => ({
  useCurrentRole: () => ({ canEdit: true, isViewer: false }),
}));
vi.mock("@/components/AddRecordFab", () => ({ AddRecordFab: () => null }));
vi.mock("@/components/MemberFilterBar", () => ({ MemberFilterBar: () => null }));
vi.mock("@/components/SortControl", () => ({ SortControl: () => null }));
vi.mock("@/components/RecordCard", () => ({
  RecordCard: ({ title, rightMeta, children }: any) => (
    <div data-card={title}>
      <div data-meta>{rightMeta}</div>
      <div data-body>{children}</div>
    </div>
  ),
  FieldRow: ({ label, value }: any) => (
    <div data-row>
      <span data-label>{label}</span>
      <span data-value>{value}</span>
    </div>
  ),
  Section: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/lib/mutations", () => ({
  useStatusMutation: () => ({ mutate: vi.fn() }),
  useDeleteMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useRecordSorter", () => ({ useRecordSorter: () => (x: any) => x }));
vi.mock("@/lib/useEntityCounts", () => ({
  useEntityCounts: () => ({
    reminderCounts: {},
    historyCounts: {},
    auditCounts: {},
    documentsCounts: {},
  }),
}));
vi.mock("@/hooks/useFxRates", () => ({ useFxRates: () => ({ data: undefined }) }));
vi.mock("@/components/ForeignCurrencyTotals", () => ({ ForeignCurrencyTotals: () => null }));
vi.mock("@/components/FxInfoNote", () => ({ FxInfoNote: () => null }));
vi.mock("@/components/HashHighlight", () => ({
  HashHighlight: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/EditRecordButton", () => ({
  useEditRecord: () => ({ open: vi.fn() }),
  useDuplicateRecord: () => ({ open: vi.fn() }),
}));
vi.mock("@/components/CollapsibleSection", () => ({ CollapsibleSection: () => null }));
vi.mock("@/components/NotesEditor", () => ({ NotesEditor: () => null }));
vi.mock("@/components/HistoryLog", () => ({ HistoryLog: () => null }));
vi.mock("@/components/AuditTrail", () => ({ AuditTrail: () => null }));
vi.mock("@/components/DocumentsList", () => ({ DocumentsList: () => null }));
vi.mock("@/components/ReminderButton", () => ({ ReminderButton: () => null }));
vi.mock("@/components/RemindersList", () => ({ RemindersList: () => null }));
vi.mock("@/components/LastUpdatedLine", () => ({ LastUpdatedLine: () => null }));
vi.mock("@/lib/advisorAccess", () => ({ getAdvisorNotesForHousehold: vi.fn() }));

import { Route } from "@/routes/investments";
import { fmtMoney } from "@/lib/format";

const Page = (Route as any).options.component as () => any;
const ILP = "ILP (Investment-Linked Policy)";

const manualIlp = {
  id: "a",
  name: "Manual ILP",
  group_name: ILP,
  currency: "SGD",
  status: "review",
  cost_basis: 10000,
  current_value: 12000,
  invested_tracking: "manual",
  premium_amount: 500,
  premium_frequency: "monthly",
  premium_start_date: "2024-01-01",
  is_giro: true,
};
const estimatedIlp = {
  id: "b",
  name: "Estimated ILP",
  group_name: ILP,
  currency: "SGD",
  status: "review",
  cost_basis: 5,
  current_value: 30000,
  invested_tracking: "estimated",
  premium_amount: 1000,
  premium_frequency: "monthly",
  premium_start_date: "2025-01-01",
  is_giro: true,
};
const stock = {
  id: "c",
  name: "A Stock",
  group_name: "Stocks",
  currency: "SGD",
  status: "review",
  cost_basis: 500,
  current_value: 700,
};

let root: Root;
let host: HTMLDivElement;
async function show(items: any[]) {
  ITEMS = items;
  await act(async () => root.render(<Page />));
}
const card = (name: string) => host.querySelector(`[data-card="${name}"]`) as HTMLElement;
const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");
const rowByLabel = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll("[data-row]")).find(
    (r) => text(r.querySelector("[data-label]")) === label,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 22, 12, 0, 0));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Investments page: Manual is exactly as before", () => {
  it("a Manual policy shows 'Amount invested' with the typed figure, no estimate wording, and gain = value - typed", async () => {
    await show([manualIlp]);
    const c = card("Manual ILP");
    expect(text(rowByLabel(c, "Amount invested")!.querySelector("[data-value]"))).toBe(
      fmtMoney(10000, "SGD"),
    );
    expect(text(c)).not.toContain("Estimated premiums paid");
    // the gain line carries no "est." tag in Manual (the header "Value (est.)" is old, unrelated text)
    expect(text(c.querySelector("[data-meta]"))).toContain(fmtMoney(2000, "SGD")); // 12,000 - 10,000
    expect(text(c.querySelector("[data-meta]"))).not.toMatch(/\$2,000\s*est\./);
    const page = text(host);
    expect(page).not.toContain("includes estimates");
    expect(page).toContain(fmtMoney(10000)); // total invested
    expect(page).toContain(fmtMoney(2000)); // gain
  });
  it("a record with no tracking value at all (saved before this feature) behaves as Manual", async () => {
    const { invested_tracking: _drop, ...legacy } = manualIlp as any;
    await show([legacy]);
    expect(
      text(rowByLabel(card("Manual ILP"), "Amount invested")!.querySelector("[data-value]")),
    ).toBe(fmtMoney(10000, "SGD"));
    expect(text(host)).not.toContain("includes estimates");
  });
  it("non-policy investments are unchanged", async () => {
    await show([stock]);
    expect(
      text(rowByLabel(card("A Stock"), "Amount invested")!.querySelector("[data-value]")),
    ).toBe(fmtMoney(500, "SGD"));
  });
});

describe("Investments page: Estimated", () => {
  it("shows 'Estimated premiums paid' = 23 payments x $1,000, with the warning note and the typed figure kept aside", async () => {
    await show([estimatedIlp]);
    const c = card("Estimated ILP");
    const row = rowByLabel(c, "Estimated premiums paid")!;
    expect(text(row.querySelector("[data-value]"))).toContain(fmtMoney(23000, "SGD"));
    expect(text(row.querySelector("[data-value]"))).toContain("23 payments");
    expect(rowByLabel(c, "Amount invested")).toBeUndefined();
    const t = text(c);
    expect(t).toContain("assumes every scheduled payment");
    expect(t).toContain("premium increases or decreases");
    expect(t).toContain("premium holidays");
    expect(t).toContain("missed payments");
    expect(t).toContain("top-ups");
    expect(t).toContain("withdrawals");
    expect(t).toContain("choose Manual");
    expect(
      text(rowByLabel(c, "Amount invested you typed (not used)")!.querySelector("[data-value]")),
    ).toContain(fmtMoney(5, "SGD"));
  });
  it("the gain uses the estimate (30,000 - 23,000 = 7,000) and is marked est.; the value is untouched", async () => {
    await show([estimatedIlp]);
    const meta = text(card("Estimated ILP").querySelector("[data-meta]"));
    expect(meta).toContain(fmtMoney(7000, "SGD"));
    expect(meta).toMatch(/\$7,000\s*est\./);
    expect(meta).toContain(fmtMoney(30000, "SGD"));
    expect(
      text(
        rowByLabel(card("Estimated ILP"), "Current value (est.)")!.querySelector("[data-value]"),
      ),
    ).toBe(fmtMoney(30000, "SGD"));
  });
  it("a mix: totals add the estimate for Estimated, the typed figure for the rest, and say 'includes estimates'", async () => {
    await show([manualIlp, estimatedIlp, stock]);
    const page = text(host);
    expect(page).toContain(fmtMoney(33500)); // 10,000 + 23,000 + 500
    expect(page).toContain(fmtMoney(42700)); // 12,000 + 30,000 + 700 (values are never estimated)
    expect(page).toContain(fmtMoney(9200)); // 42,700 - 33,500
    expect((page.match(/includes estimates/g) ?? []).length).toBe(2); // beside Total invested and Gain / Loss
  });
  it("same three investments with the estimated one switched back to Manual: totals use the typed 5", async () => {
    await show([manualIlp, { ...estimatedIlp, invested_tracking: "manual" }, stock]);
    const page = text(host);
    expect(page).toContain(fmtMoney(10505)); // 10,000 + 5 + 500
    expect(page).not.toContain("includes estimates");
    expect(
      text(rowByLabel(card("Estimated ILP"), "Amount invested")!.querySelector("[data-value]")),
    ).toBe(fmtMoney(5, "SGD"));
  });
  it("cannot be estimated (no start date): shows the typed figure with a plain explanation, never 0", async () => {
    await show([{ ...estimatedIlp, premium_start_date: null }]);
    const c = card("Estimated ILP");
    expect(text(rowByLabel(c, "Amount invested")!.querySelector("[data-value]"))).toBe(
      fmtMoney(5, "SGD"),
    );
    expect(text(c)).toContain("Estimated tracking is on, but it needs");
    expect(text(host)).not.toContain("includes estimates");
  });
  it("a policy that starts in the future has paid $0 so far", async () => {
    await show([{ ...estimatedIlp, premium_start_date: "2027-03-01" }]);
    const row = rowByLabel(card("Estimated ILP"), "Estimated premiums paid")!;
    expect(text(row.querySelector("[data-value]"))).toContain("0 payments");
  });
  it("ignores a stale 'estimated' on an investment that is no longer a policy type", async () => {
    await show([{ ...estimatedIlp, group_name: "Stocks" }]);
    const c = card("Estimated ILP");
    expect(rowByLabel(c, "Estimated premiums paid")).toBeUndefined();
    expect(text(rowByLabel(c, "Amount invested")!.querySelector("[data-value]"))).toBe(
      fmtMoney(5, "SGD"),
    );
  });
});
