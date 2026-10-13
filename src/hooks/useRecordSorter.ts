import { useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { sortRecords, type SortableRecord } from "@/lib/sort";

/**
 * Returns a function that orders a tab's cards the way the "Sort" button is
 * currently set (urgency by default). Every record tab uses it in place of the
 * old sortByStatus call; the function changes identity only when the choice does.
 */
export function useRecordSorter() {
  const recordSort = useAppStore((s) => s.recordSort);
  return useCallback(
    <T extends SortableRecord>(items: T[]) => sortRecords(items, recordSort),
    [recordSort],
  );
}
