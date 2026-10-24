const order: Record<string, number> = { urgent: 0, review: 1, settled: 2 };
export function sortByStatus<T extends { status?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (order[a.status || "review"] ?? 1) - (order[b.status || "review"] ?? 1));
}

/**
 * The "Sort" button on the record tabs. "urgency" (shown as "Priority") is red -> orange -> green, then
 * A to Z by name inside each colour (sortByStatusThenName below); "name" is A to Z by
 * name only, ignoring colour; the other two order cards by date, newest first. It only changes the ORDER cards are shown in: nothing is
 * hidden, so search, alert links and the guided tour can still find every card.
 */
// "urgency" is the saved key; it is shown to people as "Priority".
export type RecordSort = "urgency" | "name" | "edited" | "created";

export const RECORD_SORT_LABELS: Record<RecordSort, string> = {
  urgency: "Priority",
  name: "Name A to Z",
  edited: "Last edited",
  created: "Date created",
};

export type SortableRecord = {
  id?: string | null;
  status?: string | null;
  // Whichever of these a tab shows as the card's main name (savings: institution,
  // loans: bank, everything else: name). Only used to keep same-named cards together.
  institution?: string | null;
  bank?: string | null;
  name?: string | null;
  // Second-level name, so e.g. two StanChart cards also sit in a steady order.
  account_type?: string | null;
  purpose?: string | null;
  provider?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

// A missing or unreadable date counts as "oldest" instead of breaking the sort.
function ms(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

const nameCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function mainName(r: SortableRecord): string {
  return String(r.institution ?? r.bank ?? r.name ?? "").trim();
}
function subName(r: SortableRecord): string {
  return String(r.account_type ?? r.purpose ?? r.provider ?? "").trim();
}

/** Name A to Z only, colour ignored, so every card of one bank sits together. */
export function sortByName<T extends SortableRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const an = mainName(a);
    const bn = mainName(b);
    if (!an !== !bn) return an ? -1 : 1;
    return nameCollator.compare(an, bn) || nameCollator.compare(subName(a), subName(b));
  });
}

/**
 * Urgency order: red, then orange, then green (same as sortByStatus). Cards with the
 * SAME colour are then listed A to Z by name, so all StanChart cards sit together
 * instead of StanChart, UOB, StanChart. A card with no name goes last in its colour.
 * Anything still tied keeps its original (database) order.
 */
export function sortByStatusThenName<T extends SortableRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byStatus = (order[a.status || "review"] ?? 1) - (order[b.status || "review"] ?? 1);
    if (byStatus !== 0) return byStatus;
    const an = mainName(a);
    const bn = mainName(b);
    if (!an !== !bn) return an ? -1 : 1;
    return nameCollator.compare(an, bn) || nameCollator.compare(subName(a), subName(b));
  });
}

/**
 * Newest first. Cards with the same time (several records are saved or edited
 * in one go) fall back to newest-created, then to id, so the order is always
 * the same instead of shuffling between refreshes.
 */
export function sortRecords<T extends SortableRecord>(items: T[], mode: RecordSort): T[] {
  if (mode === "urgency") return sortByStatusThenName(items);
  if (mode === "name") return sortByName(items);
  const key = mode === "edited" ? "updated_at" : "created_at";
  return [...items].sort(
    (a, b) =>
      ms(b[key]) - ms(a[key]) ||
      ms(b.created_at) - ms(a.created_at) ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
}
