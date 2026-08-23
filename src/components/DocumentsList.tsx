import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Link, ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAppStore } from "@/lib/store";
import { getDisplayUrl } from "@/lib/storageUrls";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { validateVaultDoc } from "@/lib/uploadValidation";
import { checkHouseholdQuota } from "@/lib/storageQuota";

export function DocumentsList({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { canEdit, storageTier, storageBytesUsed } = useCurrentRole();
  const qc = useQueryClient();
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
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

  // Resolve signed URLs ahead of time (not inside the click handler). Some
  // mobile browsers (iOS Safari in particular) silently fail to navigate a
  // pre-opened tab if there's an `await` between the click and setting its
  // location — the tab opens but stays on about:blank. Resolving here means
  // the click handler can open the link synchronously, no gap involved.
  const { data: signedUrlByPath = {} } = useQuery({
    queryKey: ["docSignedUrls", entityType, entityId, docs.map((d: any) => d.path).join(",")],
    queryFn: async () => {
      const nonExternal = docs.filter((d: any) => d.bucket !== "external");
      const entries = await Promise.all(
        nonExternal.map(async (d: any) => [d.path, await getDisplayUrl("vault-docs", d.path)] as const),
      );
      return Object.fromEntries(entries) as Record<string, string | null>;
    },
    enabled: docs.length > 0,
  });

  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!activeHouseholdId) {
      toast.error("Select a household first.");
      return;
    }
    const validation = validateVaultDoc(file);
    if (!validation.ok) {
      toast.error(validation.message);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const quota = checkHouseholdQuota({ tier: storageTier, bytesUsed: storageBytesUsed, incomingFileBytes: file.size });
    if (!quota.ok) {
      toast.error(quota.message);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const path = `${activeHouseholdId}/${entityType}/${entityId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("vault-docs").upload(path, file);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("record_documents").insert({
        entity_type: entityType as any,
        entity_id: entityId,
        path,
        bucket: "vault-docs",
        label: file.name,
        size_bytes: file.size,
      } as any);
      if (insErr) throw insErr;
      const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", {
        p_household_id: activeHouseholdId,
        p_delta: file.size,
      });
      if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
      qc.invalidateQueries({ queryKey: ["household-memberships"] });
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

  function isImagePath(path: string) {
    return /\.(jpe?g|png|gif|webp|heic)$/i.test(path);
  }

  function openDoc(e: React.MouseEvent, doc: any) {
    if (doc.bucket === "external") {
      window.open(doc.path, "_blank", "noopener,noreferrer");
      return;
    }
    const url = signedUrlByPath[doc.path];
    if (!url) {
      toast.error("Still preparing this document — try again in a moment");
      return;
    }
    const label = doc.label || doc.path.split("/").pop();
    if (isImagePath(doc.path)) {
      // Preview inline instead of a new tab — avoids the mobile-browser
      // issue where a tab opened after any async work can be left stuck
      // on about:blank, and it's a better experience on phones anyway.
      setPreviewImage({ url, label });
      return;
    }
    // Non-image (PDF etc.): the URL was already resolved above, so this
    // window.open runs synchronously in the same click, which every
    // browser (including mobile Safari) reliably allows.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function del(id: string, doc: any) {
    if (!confirm("Delete this document?")) return;
    // DB row first, confirmed: if this fails, nothing else should happen.
    // Storage cleanup happens after and stays best-effort (same reasoning
    // as accountDeletion.ts's own storage cleanup) — a leftover file in
    // storage is a small cost issue, but deleting the file while the DB
    // row survives would leave a document card pointing at nothing.
    const { data, error } = await supabase.from("record_documents").delete().eq("id", id).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error("Nothing was deleted — you may not have permission to remove this."); return; }
    if (doc.bucket !== "external") {
      await supabase.storage.from("vault-docs").remove([doc.path]);
      const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", {
        p_household_id: activeHouseholdId,
        p_delta: -(doc.size_bytes ?? 0),
      });
      if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
      qc.invalidateQueries({ queryKey: ["household-memberships"] });
    }
    toast.success("Document removed");
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
              {canEdit && (
                <button
                  type="button"
                  onClick={() => del(d.id, d)}
                  className="cursor-pointer rounded p-1 text-urgent opacity-0 transition hover:bg-urgent/10 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  aria-label="Delete document"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
        {docs.length === 0 && <li className="text-xs text-muted-foreground">No documents yet.</li>}
      </ul>

      {canEdit && (
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

          <p className="text-[11px] text-muted-foreground">
            Links to uploaded files aren't password-protected — anyone with the exact link can open it. Avoid sharing it outside people you trust with this document.
          </p>
          {mode === "upload" && (
            <p className="text-[11px] text-muted-foreground">Max 10MB · JPEG, PNG, WebP or PDF</p>
          )}

          {mode === "upload" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={onFile}
                className="hidden"
                id={`up-${entityId}`}
              />
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
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage.url}
            alt={previewImage.label}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 rounded-full bg-background/90 px-3 py-1 text-sm font-medium"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
