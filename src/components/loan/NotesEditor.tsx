import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2, Bold, Italic, List } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, "");
}

function toEditorHtml(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";

  if (/<[a-z][\s\S]*>/i.test(v)) {
    return sanitizeHtml(v);
  }

  const lines = (value ?? "").split(/\n/);
  return lines.map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>")).join("");
}

function htmlToPlainText(html: string): string {
  if (typeof document !== "undefined") {
    const node = document.createElement("div");
    node.innerHTML = html;
    return (node.textContent ?? "").replace(/\u00a0/g, " ").trim();
  }
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function NotesEditor({
  table, queryKey, id, value,
}: {
  table: string; queryKey: string; id: string; value: string | null | undefined;
}) {
  const [html, setHtml] = useState(toEditorHtml(value));
  const [justSaved, setJustSaved] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const qc = useQueryClient();
  const lastSavedRef = useRef(toEditorHtml(value));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = toEditorHtml(value);
    setHtml(next);
    lastSavedRef.current = next;
  }, [value, id]);

  async function commit(nextHtml: string) {
    const clean = sanitizeHtml(nextHtml);
    if (clean === lastSavedRef.current) return;
    const { error } = await supabase.from(table as any).update({ notes: clean || null }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    lastSavedRef.current = clean;
    qc.invalidateQueries({ queryKey: [queryKey] });
    setJustSaved(true);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setJustSaved(false), 2000);
  }

  function onChange(nextHtml: string) {
    setHtml(nextHtml);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(nextHtml), 1000);
  }

  function clearNotes() {
    if (!htmlToPlainText(html)) return;
    if (!confirm("Clear all notes for this item?")) return;
    setHtml("");
    if (editorRef.current) editorRef.current.innerHTML = "";
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void commit("");
  }

  function summarise() {
    const text = htmlToPlainText(html);
    if (!text) return;

    setSummarising(true);
    setTimeout(() => {
      const bullets = text
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `<li>${escapeHtml(l.replace(/^[•\-\*]\s*/, ""))}</li>`)
        .join("");
      const next = bullets ? `<ul>${bullets}</ul>` : "";
      setHtml(next);
      if (editorRef.current) editorRef.current.innerHTML = next;
      void commit(next);
      setSummarising(false);
      toast.success("Summarised to bullet points");
    }, 300);
  }

  function insertFormat(type: "bold" | "italic" | "bullet") {
    const el = editorRef.current;
    if (!el) return;

    el.focus();
    if (type === "bold") {
      document.execCommand("bold");
    } else if (type === "italic") {
      document.execCommand("italic");
    } else {
      document.execCommand("insertUnorderedList");
    }

    const next = sanitizeHtml(el.innerHTML);
    onChange(next);
  }

  const isEmpty = !htmlToPlainText(html);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [html]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, []);

  function onEditorInput() {
    if (!editorRef.current) return;
    onChange(sanitizeHtml(editorRef.current.innerHTML));
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
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            Detailed notes, background, advisor info...
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={onEditorInput}
          onBlur={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            void commit(editorRef.current?.innerHTML ?? html);
          }}
          className="min-h-[132px] rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          disabled={isEmpty}
          className="text-urgent hover:bg-urgent/10 hover:text-urgent"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Clear notes
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={summarise} disabled={isEmpty || summarising}>
          <Sparkles className="mr-1 h-3.5 w-3.5" />
          {summarising ? "Summarising…" : "Summarise"}
        </Button>
      </div>
    </div>
  );
}
