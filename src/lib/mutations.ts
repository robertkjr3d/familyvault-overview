import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useStatusMutation(table: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase.from(table as any).update({ status }).eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Nothing was updated — you may not have permission to edit this.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      // Bug fix (July 2026): MemberFilterBar's per-member count badge keys
      // its cache off the real table name, not this queryKey alias — for
      // insurance_policies/savings_accounts those differ, so that badge
      // silently never refreshed after a status change until a page reload.
      qc.invalidateQueries({ queryKey: [table] });
      qc.invalidateQueries({ queryKey: ["alert-count"] });
      qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count no longer exists as a query - this is the key that actually needs invalidating now
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteMutation(table: string, queryKey: string, entityType?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Snapshot the full row into the Recycle Bin BEFORE deleting anything.
      // If this snapshot fails, the delete does not proceed either — a
      // delete should never happen without a recovery copy existing first.
      // Attached documents/reminders are NOT snapshotted (known v1 limit —
      // restoring a record won't bring those back, only the record itself).
      const { data: rowToDelete, error: fetchError } = await supabase
        .from(table as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (rowToDelete) {
        const { error: trashError } = await supabase.from("deleted_records" as any).insert({
          household_id: (rowToDelete as any).household_id,
          table_name: table,
          entity_type: entityType ?? null,
          record_id: id,
          record_data: rowToDelete,
        });
        if (trashError) throw trashError;
      }

      // Before deleting the entity row, clean up any uploaded files in Storage
      // so they don't become orphans. External links (bucket = "external") have
      // no Storage file — only rows where bucket = "vault-docs" need a remove call.
      if (entityType) {
        const { data: docs } = await supabase
          .from("record_documents")
          .select("path, bucket")
          .eq("entity_type", entityType as any)
          .eq("entity_id", id);
        const storagePaths = (docs ?? [])
          .filter((d: any) => d.bucket !== "external")
          .map((d: any) => d.path as string);
        if (storagePaths.length > 0) {
          await supabase.storage.from("vault-docs").remove(storagePaths);
        }
        // Delete the document rows themselves.
        await supabase.from("record_documents").delete().eq("entity_type", entityType as any).eq("entity_id", id);
        // Clean up any reminders (auto-generated or manually set) that point at this record,
        // so deleted entries don't leave "phantom" reminders behind.
        await supabase.from("reminders").delete().eq("entity_type", entityType).eq("entity_id", id);
      }

      const { data, error } = await supabase.from(table as any).delete().eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Nothing was deleted — you may not have permission to delete this.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      // Bug fix (July 2026) — see matching fix + comment in useStatusMutation above.
      qc.invalidateQueries({ queryKey: [table] });
      qc.invalidateQueries({ queryKey: ["alert-count"] });
      qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count no longer exists as a query - this is the key that actually needs invalidating now
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["alerts-all"] });
      qc.invalidateQueries({ queryKey: ["alerts-extras"] }); // alerts-all no longer exists (AlertsSheet migration) - this is its replacement
      qc.invalidateQueries({ queryKey: ["deleted-records"] });
      toast.success("Deleted — recoverable from Settings > Recycle Bin for 30 days");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
