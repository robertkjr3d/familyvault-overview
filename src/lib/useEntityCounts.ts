import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EntityCounts = {
  reminderCounts: Record<string, number>;
  historyCounts: Record<string, number>;
  documentsCounts: Record<string, number>;
  auditCounts: Record<string, number>;
};

// audit_log (see migration 20260910130000_financial_audit_log.sql) uses the real table
// name, not the shorter entityType alias every other count here uses — e.g. "savings" here
// vs "savings_accounts" there. Only the 6 tables the audit trigger is actually attached to
// have an entry; entityType values with no audit trail (e.g. "credit_card") simply get 0,
// which is correct, not a bug — that table isn't audited.
const ENTITY_TYPE_TO_AUDITED_TABLE: Record<string, string> = {
  insurance: "insurance_policies",
  investment: "investments",
  loan: "loans",
  other_asset: "other_assets",
  property: "properties",
  savings: "savings_accounts",
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
      const auditedTable = ENTITY_TYPE_TO_AUDITED_TABLE[entityType];
      const [reminders, history, docs, audits] = await Promise.all([
        supabase
          .from("reminders")
          .select("entity_id")
          .eq("household_id", householdId!)
          .eq("entity_type", entityType as any)
          .eq("dismissed", false),
        supabase
          .from("record_history")
          .select("entity_id")
          .eq("entity_type", entityType as any),
        supabase
          .from("record_documents")
          .select("entity_id")
          .eq("entity_type", entityType as any),
        auditedTable
          ? // Only counting UPDATE rows here, not INSERT — every record gets an
            // INSERT audit row the moment it's created, so counting those too
            // would show "1" on literally every card from day one with nothing
            // actually reviewable behind it (an INSERT diff is just "everything
            // is new"). Counting only UPDATEs means the badge means "this has
            // genuinely been edited since it was created" — the thing a household
            // member would actually want a heads-up about.
            supabase
              .from("audit_log" as any)
              .select("record_id")
              .eq("table_name", auditedTable)
              .eq("action", "UPDATE")
          : Promise.resolve({ data: [] as { record_id: string }[] }),
      ]);

      function group(rows: any[] | null): Record<string, number> {
        const out: Record<string, number> = {};
        for (const r of rows ?? []) {
          out[r.entity_id] = (out[r.entity_id] || 0) + 1;
        }
        return out;
      }
      function groupByRecordId(rows: { record_id: string }[] | null): Record<string, number> {
        const out: Record<string, number> = {};
        for (const r of rows ?? []) {
          out[r.record_id] = (out[r.record_id] || 0) + 1;
        }
        return out;
      }

      return {
        reminderCounts: group(reminders.data),
        historyCounts: group(history.data),
        documentsCounts: group(docs.data),
        auditCounts: groupByRecordId((audits as any).data),
      };
    },
  });

  return data ?? { reminderCounts: {}, historyCounts: {}, documentsCounts: {}, auditCounts: {} };
}
