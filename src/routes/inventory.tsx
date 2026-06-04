import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useRef, useState } from "react";
import { Camera, Plus, Search, Trash2, ChevronDown, Folder as FolderIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { addDays, parseISO } from "date-fns";

export const Route = createFileRoute("/inventory")({
  component: InventoryPage,
  head: () => ({ meta: [{ title: "Inventory — FamilyVault" }] }),
});

type Folder = { id: string; name: string; parent_id: string | null; photo_url: string | null; sort_order: number };
type Item = {
  id: string;
  folder_id: string;
  name: string;
  category: string | null;
  action: string | null;
  warranty_date: string | null;
  photo_url: string | null;
};

function InventoryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [openFolder, setOpenFolder] = useState<Folder | null>(null);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [showGoBag, setShowGoBag] = useState(false);

  const { data: folders = [] } = useQuery({
    queryKey: ["folders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("inventory_folders")
        .select("*")
        .is("parent_id", null)
        .order("sort_order");
      return (data ?? []) as Folder[];
    },
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ["inventory_items"],
    queryFn: async () => {
      const { data } = await supabase.from("inventory_items").select("*").order("name");
      return (data ?? []) as Item[];
    },
  });

  const { data: gobag = [] } = useQuery({
    queryKey: ["gobag"],
    queryFn: async () => {
      const { data } = await supabase.from("gobag_items").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const folderById = useMemo(() => {
    const m = new Map<string, Folder>();
    folders.forEach((f) => m.set(f.id, f));
    return m;
  }, [folders]);

  const itemCountByFolder = useMemo(() => {
    const m = new Map<string, number>();
    allItems.forEach((i) => m.set(i.folder_id, (m.get(i.folder_id) ?? 0) + 1));
    return m;
  }, [allItems]);

  const q = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return [];
    return allItems
      .filter((i) => i.name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((i) => ({ item: i, path: folderById.get(i.folder_id)?.name ?? "Unknown" }));
  }, [q, allItems, folderById]);

  const toggleGo = async (id: string, checked: boolean) => {
    await supabase.from("gobag_items").update({ checked }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["gobag"] });
  };

  const goBagDone = gobag.filter((g: any) => g.checked).length;

  return (
    <div className="space-y-5 pb-24">
      <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search all items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11 text-base border-2 bg-white dark:bg-card focus:border-primary"
          autoComplete="off"
        />
        {q && (
          <div className="absolute left-0 right-0 top-full z-30 mt-2 space-y-1 rounded-xl border border-border bg-card p-2 shadow-lg">
            {searchResults.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">No items match "{search}"</p>
            )}
            {searchResults.map(({ item, path }) => (
              <button
                key={item.id}
                onClick={() => {
                  const f = folderById.get(item.folder_id);
                  if (f) setOpenFolder(f);
                  setSearch("");
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-muted-foreground">{path} › {item.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* My Locations grid */}
      <section>
        <h2 className="mb-3 text-sm font-bold">My Locations</h2>
        {folders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No locations yet. Tap + to add one.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setOpenFolder(f)}
                className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition hover:shadow-md"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-muted">
                  {f.photo_url ? (
                    <img src={f.photo_url} alt={f.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <FolderIcon className="h-10 w-10 text-muted-foreground" />
                    </div>
                  )}
                  <span className="absolute right-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold">
                    {itemCountByFolder.get(f.id) ?? 0}
                  </span>
                </div>
                <div className="p-2.5 text-sm font-semibold">{f.name}</div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Go-Bag */}
      <section className="rounded-2xl border border-border bg-muted/40">
        <button
          type="button"
          onClick={() => setShowGoBag((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold">
            Go-Bag Checklist — {gobag.length} items
            {goBagDone > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">({goBagDone} ✓)</span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 transition ${showGoBag ? "rotate-180" : ""}`} />
        </button>
        {showGoBag && (
          <div className="border-t border-border/40 px-4 py-3">
            {gobag.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                No items in your go-bag yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {gobag.map((g: any) => (
                  <li key={g.id}>
                    <label className="flex cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        defaultChecked={g.checked}
                        onChange={(e) => toggleGo(g.id, e.target.checked)}
                        className="h-4 w-4 rounded border-border"
                      />
                      <span className={g.checked ? "text-muted-foreground line-through" : ""}>{g.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* FAB */}
      <button
        aria-label="New Location"
        onClick={() => setShowAddFolder(true)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-95"
        style={{ background: "var(--aza)" }}
      >
        <Plus className="h-7 w-7" />
      </button>

      <AddFolderSheet open={showAddFolder} onClose={() => setShowAddFolder(false)} />
      {openFolder && (
        <FolderSheet
          folder={openFolder}
          items={allItems.filter((i) => i.folder_id === openFolder.id)}
          onClose={() => setOpenFolder(null)}
        />
      )}
    </div>
  );
}

/* ---------- Add Folder ---------- */
function AddFolderSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName(""); setPhotoFile(null); setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    if (!name.trim()) { toast.error("Name this location"); return; }
    setSaving(true);
    try {
      let photo_url: string | null = null;
      if (photoFile) {
        const path = `folders/${Date.now()}-${photoFile.name}`;
        const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, photoFile);
        if (upErr) throw upErr;
        photo_url = supabase.storage.from("inventory-photos").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("inventory_folders").insert({ name: name.trim(), photo_url, parent_id: null });
      if (error) throw error;
      toast.success("Location added");
      qc.invalidateQueries({ queryKey: ["folders"] });
      reset(); onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && (reset(), onClose())}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader><SheetTitle>New Location</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4 pb-6">
          <div>
            <Label className="text-xs">Photo (optional)</Label>
            <div
              onClick={() => !preview && fileRef.current?.click()}
              className="mt-1 flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/40 min-h-[80px]"
            >
              {preview ? (
                <div className="relative w-full">
                  <img src={preview} alt="" className="w-full h-auto object-contain max-h-48" />
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPreview(null); setPhotoFile(null); }}
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white text-xs leading-none"
                  >✕</button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 py-6 text-muted-foreground">
                  <Camera className="h-7 w-7" />
                  <span className="text-xs">Tap to take photo or choose from library</span>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setPhotoFile(f);
                setPreview(URL.createObjectURL(f));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="loc-name" className="text-xs">Name this location</Label>
            <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aza's Room" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Create"}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Folder Detail ---------- */
function FolderSheet({ folder, items, onClose }: { folder: Folder; items: Item[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function delFolder() {
    if (!confirm(`Delete "${folder.name}" and all ${items.length} items inside?`)) return;
    await supabase.from("inventory_items").delete().eq("folder_id", folder.id);
    await supabase.from("inventory_folders").delete().eq("id", folder.id);
    toast.success("Location deleted");
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["inventory_items"] });
    onClose();
  }

  async function changePhoto(f: File) {
    const path = `folders/${Date.now()}-${f.name}`;
    const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, f);
    if (upErr) { toast.error(upErr.message); return; }
    const photo_url = supabase.storage.from("inventory-photos").getPublicUrl(path).data.publicUrl;
    await supabase.from("inventory_folders").update({ photo_url }).eq("id", folder.id);
    toast.success("Photo updated");
    qc.invalidateQueries({ queryKey: ["folders"] });
  }

  async function delItem(id: string) {
    if (!confirm("Delete this item?")) return;
    await supabase.from("inventory_items").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["inventory_items"] });
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between pr-8">
            <span>{folder.name}</span>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md p-1 text-muted-foreground hover:bg-accent">
                <span className="text-xl leading-none">⋯</span>
              </summary>
              <div className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent"
                >
                  <Camera className="h-3.5 w-3.5" /> Change photo
                </button>
                <button
                  onClick={delFolder}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-urgent hover:bg-urgent/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete location
                </button>
              </div>
            </details>
          </SheetTitle>
        </SheetHeader>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) changePhoto(f); }}
        />

        {folder.photo_url && (
          <img src={folder.photo_url} alt="" className="mt-3 w-full rounded-xl object-contain max-h-48" />
        )}

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Items ({items.length})
            </h3>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add item
            </Button>
          </div>

          {items.length === 0 && !adding && (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No items yet.
            </p>
          )}

          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{it.name}</div>
                    {it.category && <div className="text-xs text-muted-foreground">{it.category}</div>}
                    {it.action && <div className="mt-1 text-xs">{it.action}</div>}
                    {it.warranty_date && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Warranty until {fmtDate(it.warranty_date)}
                      </div>
                    )}
                  </div>
                  {it.photo_url && (
                    <img src={it.photo_url} alt="" className="h-14 w-14 rounded-md object-cover" />
                  )}
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingItem(it)}
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                      aria-label="Edit item"
                    >
                      <span className="text-sm">✏️</span>
                    </button>
                    <button
                      onClick={() => delItem(it.id)}
                      className="rounded-md p-1 text-urgent hover:bg-urgent/10"
                      aria-label="Delete item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {editingItem?.id === it.id && (
                  <div className="mt-3 border-t border-border pt-3">
                    <EditItemForm item={it} onDone={() => setEditingItem(null)} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {adding && <AddItemForm folderId={folder.id} onDone={() => setAdding(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Add Item Form ---------- */
function AddItemForm({ folderId, onDone }: { folderId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [action, setAction] = useState("");
  const [warranty, setWarranty] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (!name.trim()) { toast.error("Item name required"); return; }
    setSaving(true);
    try {
      let photo_url: string | null = null;
      if (photoFile) {
        const path = `items/${Date.now()}-${photoFile.name}`;
        const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, photoFile);
        if (upErr) throw upErr;
        photo_url = supabase.storage.from("inventory-photos").getPublicUrl(path).data.publicUrl;
      }
      const { data: ins, error } = await supabase
        .from("inventory_items")
        .insert({
          folder_id: folderId,
          name: name.trim(),
          category: category.trim() || null,
          action: action.trim() || null,
          warranty_date: warranty || null,
          photo_url,
        })
        .select()
        .single();
      if (error) throw error;

      if (warranty && ins) {
        const remindAt = addDays(parseISO(warranty), -90);
        await supabase.from("reminders").insert({
          entity_type: "inventory",
          entity_id: ins.id,
          what: `Warranty expires for ${name.trim()}`,
          remind_at: remindAt.toISOString(),
        });
      }

      toast.success("Item added");
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      onDone();
    } catch (err: any) {
      toast.error(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Item name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Europace Fan" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Category</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Warranty date</Label>
        <Input type="date" value={warranty} onChange={(e) => setWarranty(e.target.value)} className="w-full max-w-full" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Action / notes</Label>
        <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Service every 2 years" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Photo (optional)</Label>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)} />
        {photoFile ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-xs">{photoFile.name}</span>
            <button
              type="button"
              onClick={() => { setPhotoFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="rounded-full p-0.5 text-urgent hover:bg-urgent/10"
              aria-label="Remove photo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Camera className="mr-1 h-3.5 w-3.5" /> Add photo
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
        <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add item"}</Button>
      </div>
    </div>
  );
}

/* ---------- Edit Item Form ---------- */
function EditItemForm({ item, onDone }: { item: Item; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [action, setAction] = useState(item.action ?? "");
  const [warranty, setWarranty] = useState(item.warranty_date ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error("Item name required"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("inventory_items")
      .update({
        name: name.trim(),
        category: category.trim() || null,
        action: action.trim() || null,
        warranty_date: warranty || null,
      })
      .eq("id", item.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Item updated");
    qc.invalidateQueries({ queryKey: ["inventory_items"] });
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Item name *</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Category</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Warranty date</Label>
        <Input type="date" value={warranty} onChange={(e) => setWarranty(e.target.value)} className="w-full max-w-full" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Action / notes</Label>
        <Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
        <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
  );
}
