import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EntityCounts = {
  reminderCounts: Record<string, number>;
  historyCounts: Record<string, number>;
  documentsCounts: Record<string, number>;
};

/**
 * Fetches reminder/history/document counts for every record of a given entity type
 * in one query each (3 total), grouped client-side by entity_id. Used so the collapsed
 * card can show "2 documents" etc. without firing a query per card.
 *
 * entityType must match the entity_type value used by RemindersList/HistoryLog/DocumentsList
 * for this tab (e.g. "loan", "property", "insurance", "investment", "savings", "other_asset").
 */
export function useEntityCounts(entityType: string, householdId: string | null): EntityCounts {
  const { data } = useQuery({
    queryKey: ["entity-counts", entityType, householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const [reminders, history, docs] = await Promise.all([
        supabase.from("reminders").select("entity_id").eq("household_id", householdId!).eq("entity_type", entityType as any).eq("dismissed", false),
        supabase.from("record_history").select("entity_id").eq("entity_type", entityType as any),
        supabase.from("record_documents").select("entity_id").eq("entity_type", entityType as any),
      ]);

      function group(rows: any[] | null): Record<string, number> {
        const out: Record<string, number> = {};
        for (const r of rows ?? []) {
          out[r.entity_id] = (out[r.entity_id] || 0) + 1;
        }
        return out;
      }

      return {
        reminderCounts: group(reminders.data),
        historyCounts: group(history.data),
        documentsCounts: group(docs.data),
      };
    },
  });

  return data ?? { reminderCounts: {}, historyCounts: {}, documentsCounts: {} };
}
