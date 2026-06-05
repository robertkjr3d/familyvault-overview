import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function HistoryLog({ entityType, entityId }: { entityType: string; entityId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");

  const { data: entries = [] } = useQuery({
    queryKey: ["history", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("record_history")
        .select("*")
        .eq("entity_type", entityType as any)
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function addEntry() {
    if (!note.trim()) return;
    const { error } = await supabase.from("record_history").insert({
      entity_type: entityType as any,
      entity_id: entityId,
      note: note.trim(),
      occurred_on: new Date().toISOString().slice(0, 10),
    });
    if (error) return toast.error(error.message);
    setNote("");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["history", entityType, entityId] });
  }

  async function del(id: string) {
    if (!confirm("Delete this update?")) return;
    const { error } = await supabase.from("record_history").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["history", entityType, entityId] });
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No updates yet.</p>
      )}
      <ul className="space-y-1.5">
        {entries.map((e: any) => (
          <li key={e.id} className="group flex items-start justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm">
            <div className="flex-1">
              <span className="font-semibold text-primary">
                {format(new Date(e.created_at), "dd MMM yyyy")}
              </span>{" "}
              — {e.note}
            </div>
            <button
              onClick={() => del(e.id)}
              className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition hover:bg-urgent/10 hover:text-urgent group-hover:opacity-100"
              aria-label="Delete update"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened?" />
          <div className="flex gap-2">
            <Button size="sm" onClick={addEntry}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setAdding(false); setNote(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Update
        </Button>
      )}
    </div>
  );
}
