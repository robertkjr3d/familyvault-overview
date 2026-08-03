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
      // Snapshot the full row (and any reminders pointing at it) into the
      // Recycle Bin BEFORE deleting anything. If this snapshot fails, the
      // delete does not proceed either — a delete should never happen
      // without a recovery copy existing first.
      //
      // Documents are handled differently: they're deliberately NOT deleted
      // here. Every document query in this app is scoped to one specific
      // entity_id (see DocumentsList.tsx) — nothing browses documents
      // globally — so it's safe to just leave them in place while the
      // record sits in the Recycle Bin. Restoring the record (same id)
      // makes them show up again automatically, no extra code needed. They
      // only actually get deleted when this trash entry is permanently
      // removed — see the matching cleanup in the Recycle Bin's "Delete"
      // button and the 30-day auto-purge cron (trashCleanupCron.ts).
      //
      // Reminders are different: the notification bell and dashboard both
      // query reminders GLOBALLY across the household, with no check that
      // the record they point to still exists — leaving them in place like
      // documents would leak a reminder for a trashed record into both of
      // those. So reminders ARE deleted immediately, same as before, but
      // snapshotted first so Restore brings them back too.
      const { data: rowToDelete, error: fetchError } = await supabase
        .from(table as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      let remindersToRestore: any[] = [];
      if (entityType) {
        const { data: reminderRows, error: reminderFetchError } = await supabase
          .from("reminders")
          .select("*")
          .eq("entity_type", entityType)
          .eq("entity_id", id);
        if (reminderFetchError) throw reminderFetchError;
        remindersToRestore = reminderRows ?? [];
      }

      if (rowToDelete) {
        const { error: trashError } = await supabase.from("deleted_records" as any).insert({
          household_id: (rowToDelete as any).household_id,
          table_name: table,
          entity_type: entityType ?? null,
          record_id: id,
          record_data: rowToDelete,
          related_reminders: remindersToRestore,
        });
        if (trashError) throw trashError;
      }

      if (entityType) {
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

// Shared by the Recycle Bin's permanent-delete/empty actions and the 30-day
// auto-purge cron — the one place documents actually get removed, deferred
// from delete-time (see useDeleteMutation above for why).
export async function purgeDocumentsFor(entityType: string | null, recordId: string) {
  if (!entityType) return;
  const { data: docs } = await supabase
    .from("record_documents")
    .select("path, bucket")
    .eq("entity_type", entityType as any)
    .eq("entity_id", recordId);
  const storagePaths = (docs ?? [])
    .filter((d: any) => d.bucket !== "external")
    .map((d: any) => d.path as string);
  if (storagePaths.length > 0) {
    await supabase.storage.from("vault-docs").remove(storagePaths);
  }
  await supabase.from("record_documents").delete().eq("entity_type", entityType as any).eq("entity_id", recordId);
}
