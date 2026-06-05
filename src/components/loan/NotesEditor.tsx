import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2, Bold, Italic, List } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

export function NotesEditor({
  table, queryKey, id, value,
}: {
  table: string; queryKey: string; id: string; value: string | null | undefined;
}) {
  const [text, setText] = useState(value ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const qc = useQueryClient();
  const lastSavedRef = useRef(value ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        .map((l) => `- ${l.replace(/^[•\-\*]\s*/, "")}`)
        .join("\n");
      setText(bullets);
      void commit(bullets);
      setSummarising(false);
      toast.success("Summarised to bullet points");
    }, 300);
  }

  function insertFormat(type: "bold" | "italic" | "bullet") {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.slice(start, end);
    let insertion = "";
    let cursorOffset = 0;

    if (type === "bold") {
      insertion = `**${selected || "bold text"}**`;
      cursorOffset = selected ? insertion.length : 2;
    } else if (type === "italic") {
      insertion = `*${selected || "italic text"}*`;
      cursorOffset = selected ? insertion.length : 1;
    } else if (type === "bullet") {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const before = text.slice(0, lineStart);
      const after = text.slice(lineStart);
      const next = `- ${after}`;
      const updated = before + next;
      const fullNext = updated + text.slice(updated.length);
      setText(fullNext);
      void onChange(fullNext);
      setTimeout(() => {
        el.selectionStart = lineStart + 2;
        el.selectionEnd = lineStart + 2;
        el.focus();
      }, 0);
      return;
    }

    const next = text.slice(0, start) + insertion + text.slice(end);
    setText(next);
    void onChange(next);
    setTimeout(() => {
      el.selectionStart = start + cursorOffset;
      el.selectionEnd = start + cursorOffset;
      el.focus();
    }, 0);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 border-b border-border/40 pb-1.5">
        <button
          type="button"
          onClick={() => insertFormat("bold")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => insertFormat("italic")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => insertFormat("bullet")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Bullet"
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setPreviewing((p) => !p)}
            className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
          >
            {previewing ? "Edit" : "Preview"}
          </button>
        </div>
      </div>

      <div className="relative">
        {previewing ? (
          <div className="prose prose-sm min-h-[96px] max-w-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground">
            {text
              ? <ReactMarkdown>{text}</ReactMarkdown>
              : <p className="text-muted-foreground italic">Nothing to preview.</p>
            }
          </div>
        ) : (
          <Textarea
            ref={textareaRef}
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
        )}
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
