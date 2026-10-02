// Pure helpers for the "Recently edited" list (header clock icon).
// No database access: the list is built from the per-table data the app has
// already loaded and cached (householdRecordQueries.ts).

export const RECENT_LIMIT = 15;

export type RecentSource<K extends string = string> = {
  key: K;
  title: (row: any) => string;
};

export type RecentEntry<K extends string = string> = {
  key: K;
  row: any;
  title: string;
  at: number; // updated_at as a timestamp
  isNew: boolean; // added, never edited since
};

// updated_at is set by the database on every edit (and equals created_at on a
// brand-new record), so "within 2 seconds of created_at" means "never edited".
const NEW_WINDOW_MS = 2000;

export function buildRecentList<K extends string>(
  sources: readonly RecentSource<K>[],
  dataByKey: Record<string, any[] | undefined>,
  limit: number = RECENT_LIMIT,
): RecentEntry<K>[] {
  const out: RecentEntry<K>[] = [];
  for (const s of sources) {
    for (const row of dataByKey[s.key] ?? []) {
      const at = Date.parse(row?.updated_at ?? "");
      if (!Number.isFinite(at)) continue; // no usable date: leave it out rather than guess
      const created = Date.parse(row?.created_at ?? "");
      const title = (s.title(row) ?? "").toString().trim() || "(untitled)";
      out.push({
        key: s.key,
        row,
        title,
        at,
        isNew: Number.isFinite(created) && Math.abs(at - created) < NEW_WINDOW_MS,
      });
    }
  }
  // Newest first; ties broken by id so the order never flickers between renders.
  out.sort((a, b) => b.at - a.at || String(a.row?.id).localeCompare(String(b.row?.id)));
  return out.slice(0, Math.max(0, limit));
}

// "just now", "5 min ago", "3 hr ago", "Yesterday", "4 days ago", then a plain date.
export function timeAgo(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
