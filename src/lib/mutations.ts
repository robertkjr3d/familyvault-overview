import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useStatusMutation(table: string, queryKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from(table as any).update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
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

      const { error } = await supabase.from(table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      qc.invalidateQueries({ queryKey: ["alert-count"] });
      qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count no longer exists as a query - this is the key that actually needs invalidating now
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["alerts-all"] });
      qc.invalidateQueries({ queryKey: ["alerts-extras"] }); // alerts-all no longer exists (AlertsSheet migration) - this is its replacement
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
