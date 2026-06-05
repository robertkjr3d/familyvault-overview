import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

/**
 * Unified, timestamped notes log. Replaces "Notes" and "History".
 * Backed by record_history (entity_type, entity_id, note, created_at).
 */
export function NotesLog({ entityType, entityId }: { entityType: string; entityId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: entries = [] } = useQuery({
    queryKey: ["notes-log", entityType, entityId],
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

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("record_history").insert({
      entity_type: entityType as any,
      entity_id: entityId,
      note: text.trim(),
      occurred_on: new Date().toISOString().slice(0, 10),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setText("");
    qc.invalidateQueries({ queryKey: ["notes-log", entityType, entityId] });
  }

  async function del(id: string) {
    if (!confirm("Delete this note?")) return;
    const { error } = await supabase.from("record_history").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["notes-log", entityType, entityId] });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={save} disabled={!text.trim() || saving}>
            {saving ? "Saving…" : "Save Note"}
          </Button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e: any) => (
            <li
              key={e.id}
              className="group flex items-start justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm"
            >
              <div className="flex-1">
                <span className="font-semibold text-primary">
                  {format(new Date(e.created_at), "d MMM yyyy, h:mma").toLowerCase().replace(/(\d)(am|pm)/, "$1$2")}
                </span>
                <span> — {e.note}</span>
              </div>
              <button
                onClick={() => del(e.id)}
                className="cursor-pointer rounded p-1 text-urgent opacity-0 transition hover:bg-urgent/10 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                aria-label="Delete note"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
