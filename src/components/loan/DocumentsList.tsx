import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Link, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export function DocumentsList({ entityType, entityId }: { entityType: string; entityId: string }) {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: docs = [] } = useQuery({
    queryKey: ["docs", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("record_documents")
        .select("*")
        .eq("entity_type", entityType as any)
        .eq("entity_id", entityId)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = `${entityType}/${entityId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("vault-docs").upload(path, file);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("record_documents").insert({
        entity_type: entityType as any,
        entity_id: entityId,
        path,
        bucket: "vault-docs",
        label: file.name,
      });
      if (insErr) throw insErr;
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["docs", entityType, entityId] });
      toast.success("Document uploaded");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function saveLink() {
    if (!linkUrl.trim() || !linkLabel.trim()) {
      toast.error("Both a label and URL are required");
      return;
    }
    let url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    setSavingLink(true);
    try {
      const { error } = await supabase.from("record_documents").insert({
        entity_type: entityType as any,
        entity_id: entityId,
        path: url,
        bucket: "external",
        label: linkLabel.trim(),
      });
      if (error) throw error;
      setLinkUrl("");
      setLinkLabel("");
      setMode("upload");
      qc.invalidateQueries({ queryKey: ["docs", entityType, entityId] });
      toast.success("Link saved");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingLink(false);
    }
  }

  async function openDoc(e: React.MouseEvent, doc: any) {
    if (doc.bucket === "external") {
      window.open(doc.path, "_blank", "noopener,noreferrer");
      return;
    }
    const win = window.open("", "_blank", "noopener,noreferrer");
    const { data } = await supabase.storage.from("vault-docs").createSignedUrl(doc.path, 3600);
    const url = data?.signedUrl || supabase.storage.from("vault-docs").getPublicUrl(doc.path).data.publicUrl;
    if (win) win.location.href = url;
  }

  async function del(id: string, doc: any) {
    if (!confirm("Delete this document?")) return;
    if (doc.bucket !== "external") {
      await supabase.storage.from("vault-docs").remove([doc.path]);
    }
    await supabase.from("record_documents").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["docs", entityType, entityId] });
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
       {docs.map((d: any) => {
          const isExternal = d.bucket === "external";
          const docIcon = isExternal
            ? <Link className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            : <ExternalLink className="h-3.5 w-3.5 shrink-0" />;
          const docLabel = d.label || d.path.split("/").pop();
          return (
            <li key={d.id} className="group flex items-center justify-between rounded-md bg-muted/40 px-2 py-1.5 text-sm">
              <button
                type="button"
                onClick={(e) => openDoc(e, d)}
                className="flex flex-1 cursor-pointer items-center gap-2 truncate hover:underline text-left"
              >
                {docIcon}
                <span className="truncate">{docLabel}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {format(new Date(d.uploaded_at), "dd MMM yyyy")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => del(d.id, d)}
                className="cursor-pointer rounded p-1 text-urgent opacity-0 transition hover:bg-urgent/10 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                aria-label="Delete document"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
        {docs.length === 0 && <li className="text-xs text-muted-foreground">No documents yet.</li>}
      </ul>

      <div className="rounded-md border border-dashed border-border/60 p-2 space-y-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "upload" ? "default" : "outline"}
            onClick={() => setMode("upload")}
            className="h-7 px-2 text-xs"
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Upload
          </Button>
          <Button
            size="sm"
            variant={mode === "link" ? "default" : "outline"}
            onClick={() => setMode("link")}
            className="h-7 px-2 text-xs"
          >
            <Link className="mr-1 h-3.5 w-3.5" /> Add Link
          </Button>
        </div>

        {mode === "upload" && (
          <>
            <input ref={fileRef} type="file" onChange={onFile} className="hidden" id={`up-${entityId}`} />
            <Button asChild size="sm" variant="outline" disabled={uploading} className="w-full">
              <label htmlFor={`up-${entityId}`} className="cursor-pointer">
                <Upload className="mr-1 h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Choose file"}
              </label>
            </Button>
          </>
        )}

        {mode === "link" && (
          <div className="space-y-1.5">
            <Input
              placeholder="Label (e.g. Policy PDF on Google Drive)"
              value={linkLabel}
              onChange={(e) => setLinkLabel(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="URL (e.g. https://drive.google.com/...)"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveLink} disabled={savingLink} className="h-7 px-3 text-xs">
                {savingLink ? "Saving…" : "Save Link"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode("upload"); setLinkUrl(""); setLinkLabel(""); }} className="h-7 px-2 text-xs">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
