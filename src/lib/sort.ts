const order: Record<string, number> = { urgent: 0, review: 1, settled: 2 };
export function sortByStatus<T extends { status?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (order[a.status || "review"] ?? 1) - (order[b.status || "review"] ?? 1));
}

/**
 * The "Sort" button on the record tabs. "urgency" is the original red -> orange
 * -> green order (sortByStatus above, unchanged); the other two order cards by
 * date, newest first. It only changes the ORDER cards are shown in: nothing is
 * hidden, so search, alert links and the guided tour can still find every card.
 */
export type RecordSort = "urgency" | "edited" | "created";

export const RECORD_SORT_LABELS: Record<RecordSort, string> = {
  urgency: "Urgency",
  edited: "Last edited",
  created: "Date created",
};

export type SortableRecord = {
  id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

// A missing or unreadable date counts as "oldest" instead of breaking the sort.
function ms(value: string | null | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Newest first. Cards with the same time (several records are saved or edited
 * in one go) fall back to newest-created, then to id, so the order is always
 * the same instead of shuffling between refreshes.
 */
export function sortRecords<T extends SortableRecord>(items: T[], mode: RecordSort): T[] {
  if (mode === "urgency") return sortByStatus(items);
  const key = mode === "edited" ? "updated_at" : "created_at";
  return [...items].sort(
    (a, b) =>
      ms(b[key]) - ms(a[key]) ||
      ms(b.created_at) - ms(a.created_at) ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
}
