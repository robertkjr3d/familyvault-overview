import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Silent auto-save notes editor.
 * - Saves automatically 1s after the user stops typing.
 * - Shows a subtle "Saved ✓" indicator for 2s after a save.
 */
export function NotesEditor({
  table, queryKey, id, value,
}: {
  table: string; queryKey: string; id: string; value: string | null | undefined;
}) {
  const [text, setText] = useState(value ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const qc = useQueryClient();
  const lastSavedRef = useRef(value ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(value ?? "");
    lastSavedRef.current = value ?? "";
  }, [value, id]);

  async function commit(next: string) {
    if (next === lastSavedRef.current) return;
    const { error } = await supabase.from(table as any).update({ notes: next || null }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    lastSavedRef.current = next;
    qc.invalidateQueries({ queryKey: [queryKey] });
    setJustSaved(true);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setJustSaved(false), 2000);
  }

  function onChange(next: string) {
    setText(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(next), 1000);
  }

  function clearNotes() {
    if (!text) return;
    if (!confirm("Clear all notes for this item?")) return;
    setText("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void commit("");
  }

  function summarise() {
    setSummarising(true);
    setTimeout(() => {
      const bullets = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `• ${l.replace(/^[•\-\*]\s*/, "")}`)
        .join("\n");
      setText(bullets);
      void commit(bullets);
      setSummarising(false);
      toast.success("Summarised to bullet points");
    }, 300);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            void commit(text);
          }}
          rows={6}
          placeholder="Detailed notes, background, advisor info…"
          className="text-sm"
        />
        <span
          className={`pointer-events-none absolute right-2 top-2 text-[11px] text-muted-foreground transition-opacity duration-300 ${justSaved ? "opacity-100" : "opacity-0"}`}
        >
          Saved ✓
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clearNotes}
          disabled={!text}
          className="text-urgent hover:bg-urgent/10 hover:text-urgent"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Clear notes
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={summarise} disabled={!text || summarising}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {summarising ? "Summarising…" : "Summarise"}
        </Button>
      </div>
    </div>
  );
}
