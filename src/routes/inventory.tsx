import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Plus, Search, Trash2, ChevronDown, Folder as FolderIcon, X, Pencil, ArrowRightLeft, Bell } from "lucide-react";
import { HashHighlight } from "@/components/HashHighlight";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { compressImage } from "@/lib/imageCompression";
import { validateInventoryPhoto } from "@/lib/uploadValidation";
import { checkHouseholdQuota } from "@/lib/storageQuota";
import { getDisplayUrl, getExportUrl } from "@/lib/storageUrls";
import { SignedImg } from "@/components/SignedImg";
import { useCurrentRole } from "@/lib/useCurrentRole";

export const Route = createFileRoute("/inventory")({
component: InventoryPage,
head: () => ({ meta: [{ title: "Inventory — FamilyHub SG" }] }),
});

type Folder = { id: string; name: string; parent_id: string | null; photo_url: string | null; photo_size_bytes: number | null; sort_order: number };
type Item = {
id: string;
folder_id: string;
name: string;
category: string | null;
action: string | null;
warranty_date: string | null;
photo_url: string | null;
photo_size_bytes: number | null;
};

function InventoryPage() {
const qc = useQueryClient();
const { canEdit } = useCurrentRole();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const [search, setSearch] = useState("");
const [openFolderId, setOpenFolderId] = useState<string | null>(null);
const [openSubfolderId, setOpenSubfolderId] = useState<string | null>(null);
const [showAddFolder, setShowAddFolder] = useState(false);
const [pageLightboxUrl, setPageLightboxUrl] = useState("");
const pageLightboxRef = useRef(false);

function closePageLightbox() {
pageLightboxRef.current = false;
setPageLightboxUrl("");
}

// Callback ref: attaches pinch-zoom listeners immediately when the lightbox img enters DOM.
// More reliable than useEffect+useRef for portalled elements.
const pageLightboxImgCallbackRef = (img: HTMLImageElement | null) => {
if (!img) return;
let scale = 1;
let initialDist = 0;
let startScale = 1;
const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const onTouchStart = (e: TouchEvent) => {
if (e.touches.length === 2) { initialDist = dist(e.touches); startScale = scale; }
};
const onTouchMove = (e: TouchEvent) => {
if (e.touches.length === 2) {
e.preventDefault();
scale = Math.min(5, Math.max(1, startScale * dist(e.touches) / initialDist));
img.style.transform = `scale(${scale})`;
}
};
const onTouchEnd = () => {
if (scale < 1.05) { scale = 1; img.style.transform = "scale(1)"; }
};
img.addEventListener("touchstart", onTouchStart, { passive: true });
img.addEventListener("touchmove", onTouchMove, { passive: false });
img.addEventListener("touchend", onTouchEnd, { passive: true });
};

const { data: folders = [] } = useQuery({
queryKey: ["folders", activeHouseholdId],
enabled: !!activeHouseholdId,
queryFn: async () => {
if (!activeHouseholdId) return [];
const { data } = await supabase
.from("inventory_folders")
.select("*")
.eq("household_id", activeHouseholdId)
.order("sort_order");
return (data ?? []) as unknown as Folder[];
},
});

const { data: allItems = [] } = useQuery({
queryKey: ["inventory_items", activeHouseholdId],
enabled: !!activeHouseholdId,
queryFn: async () => {
if (!activeHouseholdId) return [];
const { data } = await supabase.from("inventory_items").select("*").eq("household_id", activeHouseholdId).order("name");
return (data ?? []) as unknown as Item[];
},
});

const { data: gobag = [] } = useQuery({
queryKey: ["gobag", activeHouseholdId],
enabled: !!activeHouseholdId,
queryFn: async () => {
if (!activeHouseholdId) return [];
const { data } = await supabase.from("gobag_items").select("*").eq("household_id", activeHouseholdId).order("sort_order");
return data ?? [];
},
});

const { data: travelChecklist = [] } = useQuery({
queryKey: ["travel_checklist", activeHouseholdId],
enabled: !!activeHouseholdId,
queryFn: async () => {
if (!activeHouseholdId) return [];
const { data } = await supabase.from("travel_checklist_items").select("*").eq("household_id", activeHouseholdId).order("sort_order");
return data ?? [];
},
});

const folderById = useMemo(() => {
const m = new Map<string, Folder>();
folders.forEach((f) => m.set(f.id, f));
return m;
}, [folders]);

const openFolder = openFolderId ? folderById.get(openFolderId) ?? null : null;
const openSubfolder = openSubfolderId ? folderById.get(openSubfolderId) ?? null : null;

const [hashHandled, setHashHandled] = useState(false);
const [generatingDocx, setGeneratingDocx] = useState(false);
const [generatingCsv, setGeneratingCsv] = useState(false);
useEffect(() => {
if (hashHandled) return;
if (allItems.length === 0 || folders.length === 0) return;
const match = window.location.hash.match(/^#record-(.+)$/);
if (!match) { setHashHandled(true); return; }
const item = allItems.find((i) => i.id === match[1]);
if (item) {
const f = folderById.get(item.folder_id);
if (f) {
if (f.parent_id) { setOpenFolderId(f.parent_id); setOpenSubfolderId(f.id); }
else { setOpenFolderId(f.id); setOpenSubfolderId(null); }
}
}
setHashHandled(true);
}, [allItems, folders, folderById, hashHandled]);

const itemCountByFolder = useMemo(() => {
const m = new Map<string, number>();
allItems.forEach((i) => m.set(i.folder_id, (m.get(i.folder_id) ?? 0) + 1));
return m;
}, [allItems]);

const topLevelFolders = useMemo(() => folders.filter((f) => f.parent_id === null), [folders]);

const childrenByParent = useMemo(() => {
const m = new Map<string, Folder[]>();
folders.forEach((f) => {
if (f.parent_id) {
const arr = m.get(f.parent_id) ?? [];
arr.push(f);
m.set(f.parent_id, arr);
}
});
return m;
}, [folders]);

const totalCountByFolder = useMemo(() => {
const m = new Map<string, number>();
topLevelFolders.forEach((f) => {
let total = itemCountByFolder.get(f.id) ?? 0;
const children = childrenByParent.get(f.id) ?? [];
children.forEach((c) => { total += itemCountByFolder.get(c.id) ?? 0; });
m.set(f.id, total);
});
return m;
}, [topLevelFolders, childrenByParent, itemCountByFolder]);

const itemMoveOptions = useMemo(() => {
const opts: { id: string; label: string }[] = [];
topLevelFolders.forEach((f) => {
opts.push({ id: f.id, label: f.name });
const children = childrenByParent.get(f.id) ?? [];
children.forEach((c) => opts.push({ id: c.id, label: f.name + " > " + c.name }));
});
return opts;
}, [topLevelFolders, childrenByParent]);

function csvCell(v: string | null | undefined): string {
const s = (v ?? "").replace(/\r?\n/g, " ");
if (s.includes(",") || s.includes('"')) {
return '"' + s.replace(/"/g, '""') + '"';
}
return s;
}

async function exportCsv() {
setGeneratingCsv(true);
try {
const rows: string[] = [];
rows.push(["Location", "Location photo URL", "Subfolder", "Subfolder photo URL", "Item name", "Category", "Action / Notes", "Warranty/Expiry date", "Item photo URL"].map(csvCell).join(","));

// Photos are stored privately now, so a raw path won't open as a link.
// Resolve every distinct photo referenced into a long-lived (10 year)
// signed link before writing rows, since this file will be kept outside the app.
const uniquePaths = new Set<string>();
topLevelFolders.forEach((f) => {
  if (f.photo_url) uniquePaths.add(f.photo_url);
  (childrenByParent.get(f.id) ?? []).forEach((sf) => { if (sf.photo_url) uniquePaths.add(sf.photo_url); });
});
allItems.forEach((it) => { if (it.photo_url) uniquePaths.add(it.photo_url); });
const resolvedEntries = await Promise.all(
  Array.from(uniquePaths).map(async (p) => [p, await getExportUrl("inventory-photos", p)] as const)
);
const urlMap = new Map(resolvedEntries);
const resolvePhoto = (p: string | null | undefined) => (p ? urlMap.get(p) ?? "" : "");

function buildRow(locName: string, locPhoto: string | null | undefined, subName: string, subPhoto: string | null | undefined, itemName: string, category: string, notes: string, warranty: string, itemPhoto: string | null | undefined): string {
  return [locName, resolvePhoto(locPhoto), subName, resolvePhoto(subPhoto), itemName, category, notes, warranty, resolvePhoto(itemPhoto)].map(csvCell).join(",");
}

topLevelFolders.forEach((f) => {
  const directItems = allItems.filter((i) => i.folder_id === f.id);
  const children = childrenByParent.get(f.id) ?? [];

  if (directItems.length === 0 && children.length === 0) {
    rows.push(buildRow(f.name, f.photo_url, "", null, "", "", "", "", null));
  }

  directItems.forEach((it) => {
    rows.push(buildRow(f.name, f.photo_url, "", null, it.name, it.category ?? "", it.action ?? "", it.warranty_date ?? "", it.photo_url));
  });

  children.forEach((sf) => {
    const subItems = allItems.filter((i) => i.folder_id === sf.id);
    if (subItems.length === 0) {
      rows.push(buildRow(f.name, f.photo_url, sf.name, sf.photo_url, "", "", "", "", null));
    }
    subItems.forEach((it) => {
      rows.push(buildRow(f.name, f.photo_url, sf.name, sf.photo_url, it.name, it.category ?? "", it.action ?? "", it.warranty_date ?? "", it.photo_url));
    });
  });
});

const csv = rows.join("\r\n");
const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `familyhub-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
} finally {
setGeneratingCsv(false);
}
}

function exportText() {
const lines: string[] = [];
lines.push("FAMILYHUB INVENTORY");
lines.push(`Exported ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
lines.push("");

topLevelFolders.forEach((f) => {
  lines.push(f.name.toUpperCase());
  const directItems = allItems.filter((i) => i.folder_id === f.id);
  const children = childrenByParent.get(f.id) ?? [];

  if (directItems.length === 0 && children.length === 0) {
    lines.push("  (empty)");
  }

  directItems.forEach((it) => {
    lines.push(`  - ${it.name}` + (it.category ? ` (${it.category})` : ""));
    if (it.action) lines.push(`      Notes: ${it.action}`);
    if (it.warranty_date) lines.push(`      Warranty/Expiry: ${it.warranty_date}`);
  });

  children.forEach((sf) => {
    lines.push(`  ${sf.name}`);
    const subItems = allItems.filter((i) => i.folder_id === sf.id);
    if (subItems.length === 0) {
      lines.push("    (empty)");
    }
    subItems.forEach((it) => {
      lines.push(`    - ${it.name}` + (it.category ? ` (${it.category})` : ""));
      if (it.action) lines.push(`        Notes: ${it.action}`);
      if (it.warranty_date) lines.push(`        Warranty/Expiry: ${it.warranty_date}`);
    });
  });

  lines.push("");
});

const text = lines.join("\n");
const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `familyhub-inventory-${new Date().toISOString().slice(0, 10)}.txt`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

}

async function fetchImageBytes(url: string): Promise<ArrayBuffer | null> {
try {
const res = await fetch(url);
if (!res.ok) return null;
return await res.arrayBuffer();
} catch {
return null;
}
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
const results: R[] = new Array(items.length);
let next = 0;
async function worker() {
while (next < items.length) {
const i = next++;
results[i] = await fn(items[i]);
}
}
await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
return results;
}

async function exportDocx() {
setGeneratingDocx(true);
try {
const docxLib: any = await import("https://esm.sh/docx@9");
const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = docxLib;

  // Collect every photo URL we need, fetch them all up front (with a concurrency cap)
  const photoUrls = new Set<string>();
  topLevelFolders.forEach((f) => {
    if (f.photo_url) photoUrls.add(f.photo_url);
    (childrenByParent.get(f.id) ?? []).forEach((sf) => { if (sf.photo_url) photoUrls.add(sf.photo_url); });
  });
  allItems.forEach((it) => { if (it.photo_url) photoUrls.add(it.photo_url); });

  // photo_url now holds a storage path, not a fetchable link, since the
  // bucket is private. Resolve each path to a short-lived signed URL just
  // long enough to download the bytes, then embed the bytes themselves —
  // the finished .docx has no dependency on any link at all.
  const pathList = Array.from(photoUrls);
  const signedUrls = await Promise.all(pathList.map((p) => getDisplayUrl("inventory-photos", p)));
  const fetched = await mapWithConcurrency(signedUrls, 4, (u) => (u ? fetchImageBytes(u) : Promise.resolve(null)));
  const imageBytesByUrl = new Map<string, ArrayBuffer | null>();
  pathList.forEach((path, i) => imageBytesByUrl.set(path, fetched[i]));

  function imageParagraph(url: string | null, widthPx: number): any | null {
    if (!url) return null;
    const bytes = imageBytesByUrl.get(url);
    if (!bytes) {
      return new Paragraph({ children: [new TextRun({ text: "[photo unavailable]", italics: true, color: "999999" })] });
    }
    try {
      const aspect = 1; // unknown aspect ratio at this point; square-ish thumbnail is acceptable
      return new Paragraph({
        children: [new ImageRun({ type: "jpg", data: bytes, transformation: { width: widthPx, height: Math.round(widthPx * aspect) } })],
      });
    } catch {
      return new Paragraph({ children: [new TextRun({ text: "[photo unavailable]", italics: true, color: "999999" })] });
    }
  }

  const children: any[] = [];
  children.push(new Paragraph({ text: "FamilyHub SG Inventory", heading: HeadingLevel.TITLE }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Exported ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, italics: true, color: "666666" })],
  }));
  children.push(new Paragraph({ text: "" }));

  function pushItem(it: Item, indent: number) {
    const lines: any[] = [];
    const nameRuns = [new TextRun({ text: it.name, bold: true })];
    if (it.category) nameRuns.push(new TextRun({ text: `  (${it.category})`, italics: true, color: "666666" }));
    lines.push(new Paragraph({ children: nameRuns, indent: { left: indent } }));
    if (it.action) lines.push(new Paragraph({ children: [new TextRun({ text: `Notes: ${it.action}` })], indent: { left: indent } }));
    if (it.warranty_date) lines.push(new Paragraph({ children: [new TextRun({ text: `Warranty/Expiry: ${it.warranty_date}` })], indent: { left: indent } }));
    const img = imageParagraph(it.photo_url, 120);
    if (img) lines.push(img);
    lines.push(new Paragraph({ text: "" }));
    children.push(...lines);
  }

  topLevelFolders.forEach((f) => {
    children.push(new Paragraph({ text: f.name, heading: HeadingLevel.HEADING_1 }));
    const fImg = imageParagraph(f.photo_url, 180);
    if (fImg) children.push(fImg);

    const directItems = allItems.filter((i) => i.folder_id === f.id);
    const subfolders = childrenByParent.get(f.id) ?? [];

    if (directItems.length === 0 && subfolders.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "(empty)", italics: true, color: "999999" })] }));
    }

    directItems.forEach((it) => pushItem(it, 0));

    subfolders.forEach((sf) => {
      children.push(new Paragraph({ text: sf.name, heading: HeadingLevel.HEADING_2 }));
      const sfImg = imageParagraph(sf.photo_url, 150);
      if (sfImg) children.push(sfImg);
      const subItems = allItems.filter((i) => i.folder_id === sf.id);
      if (subItems.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "(empty)", italics: true, color: "999999" })] }));
      }
      subItems.forEach((it) => pushItem(it, 360));
    });
  });

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `familyhubsg-inventory-${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("Master document downloaded");
} catch (err: any) {
  toast.error("Could not generate document: " + (err?.message ?? "unknown error"));
} finally {
  setGeneratingDocx(false);
}

}

const q = search.trim().toLowerCase();
const searchResults = useMemo(() => {
if (!q) return [];
return allItems
.filter((i) => i.name.toLowerCase().includes(q))
.slice(0, 20)
.map((i) => ({ item: i, path: folderById.get(i.folder_id)?.name ?? "Unknown" }));
}, [q, allItems, folderById]);

return (
<div className="space-y-5 pb-24">
<h1 className="text-2xl font-bold tracking-tight">Inventory</h1>

  {/* Search */}
  <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <Input
      placeholder="Search all items..."
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
              if (f) {
                if (f.parent_id) { setOpenFolderId(f.parent_id); setOpenSubfolderId(f.id); }
                else { setOpenFolderId(f.id); setOpenSubfolderId(null); }
              }
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
    {topLevelFolders.length === 0 ? (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No locations yet. Tap + to add one.
      </p>
    ) : (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {topLevelFolders.map((f) => (
          <button
            key={f.id}
            onClick={() => setOpenFolderId(f.id)}
            className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition hover:shadow-md"
          >
            <div className="relative aspect-square w-full overflow-hidden bg-muted">
              {f.photo_url ? (
                <SignedImg
                  bucket="inventory-photos"
                  path={f.photo_url}
                  alt={f.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <FolderIcon className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
              <span className="absolute right-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold">
                {totalCountByFolder.get(f.id) ?? 0}
              </span>
            </div>
            <div className="p-2.5 text-sm font-semibold truncate">{f.name}</div>
          </button>
        ))}
      </div>
    )}
  </section>

  {/* Travel Checklist */}
  <ChecklistSection table="travel_checklist_items" queryKey="travel_checklist" title="Travel Checklist" items={travelChecklist} enableCategories />

  {/* Go-Bag */}
  <ChecklistSection table="gobag_items" queryKey="gobag" title="Go-Bag Checklist" items={gobag} />

  {/* FAB */}
  {canEdit && (
    <button
      aria-label="New Location"
      onClick={() => setShowAddFolder(true)}
      className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full text-primary-foreground shadow-lg shadow-primary/30 transition active:scale-95"
      style={{ background: "var(--aza)" }}
    >
      <Plus className="h-7 w-7" />
    </button>
  )}

  <AddFolderSheet open={showAddFolder} onClose={() => setShowAddFolder(false)} parentId={null} />
  {openFolder && (
    <FolderSheet
      folder={openFolder}
      items={allItems.filter((i) => i.folder_id === openFolder.id)}
      allItems={allItems}
      onClose={() => { setOpenFolderId(null); setOpenSubfolderId(null); }}
      subfolders={childrenByParent.get(openFolder.id) ?? []}
      onOpenSubfolder={(f) => setOpenSubfolderId(f.id)}
      topLevelFolders={topLevelFolders}
      itemMoveOptions={itemMoveOptions}
    />
  )}
  {openSubfolder && (
    <FolderSheet
      folder={openSubfolder}
      items={allItems.filter((i) => i.folder_id === openSubfolder.id)}
      allItems={allItems}
      onClose={() => setOpenSubfolderId(null)}
      subfolders={[]}
      onOpenSubfolder={() => {}}
      parentFolder={openFolder}
      topLevelFolders={topLevelFolders}
      itemMoveOptions={itemMoveOptions}
    />
  )}

  <div className="pt-2 space-y-2">
    <Button variant="outline" className="w-full" onClick={exportCsv} disabled={allItems.length === 0 || generatingCsv}>
      {generatingCsv ? "Preparing... please wait" : "Export as spreadsheet (CSV)"}
    </Button>
    <p className="text-center text-[11px] text-muted-foreground">
      One row per item with photo links — open in Google Sheets / Excel.
    </p>
    <Button variant="outline" className="w-full" onClick={exportText} disabled={allItems.length === 0}>
      Export as text list
    </Button>
    <p className="text-center text-[11px] text-muted-foreground">
      Clean outline by location and subfolder — good for Apple Notes (no photos).
    </p>
    <Button variant="outline" className="w-full" onClick={exportDocx} disabled={allItems.length === 0 || generatingDocx}>
      {generatingDocx ? "Generating... please wait" : "Export master document (Word, with photos)"}
    </Button>
    <p className="text-center text-[11px] text-muted-foreground">
      Full backup with embedded photos. Can take up to a minute for large inventories — don't close the page while it's generating.
    </p>
  </div>
  {pageLightboxUrl && createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
      style={{ pointerEvents: 'auto' }}
      onPointerUp={(e) => { if (e.target === e.currentTarget) closePageLightbox(); }}
    >
      <img
        ref={pageLightboxImgCallbackRef}
        src={pageLightboxUrl}
        alt="Full size"
        draggable="false"
        className="relative max-h-full max-w-full rounded-xl object-contain shadow-2xl p-4"
        style={{ touchAction: 'none', transformOrigin: 'center', transition: 'transform 0.05s' }}
      />
      <button
        className="absolute right-4 top-4 z-[10000] rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
        style={{ pointerEvents: 'auto' }}
        onPointerUp={(e) => { e.stopPropagation(); closePageLightbox(); }}
        aria-label="Close"
      >✕</button>
    </div>,
    document.body
  )}
</div>

);
}

/* ––––– Checklist Section (Go-Bag, Travel, etc.) ––––– */
const CHECKLIST_CATEGORY_PRESETS = ["Documents", "Hygiene", "Clothes", "Electronics"];
const CHECKLIST_UNCATEGORIZED = "Uncategorized";
const CHECKLIST_UNCATEGORIZED_VALUE = "__uncategorized__";
const CHECKLIST_ADD_NEW_VALUE = "__add_new__";

/** A proper dropdown for picking a checklist item's category, with a "+ Add new category" option that reveals a text field. Used for both the add-item row and inline editing. */
function CategoryPicker({
value,
onChange,
suggestions,
}: {
value: string;
onChange: (next: string) => void;
suggestions: string[];
}) {
const [customMode, setCustomMode] = useState(false);
const [customText, setCustomText] = useState("");

const options = useMemo(() => {
const set = new Set(suggestions);
if (value) set.add(value);
return Array.from(set).sort((a, b) => a.localeCompare(b));
}, [suggestions, value]);

function commitCustom() {
const trimmed = customText.trim();
setCustomMode(false);
setCustomText("");
if (trimmed) onChange(trimmed);
}

if (customMode) {
return (
<Input
autoFocus
value={customText}
onChange={(e) => setCustomText(e.target.value)}
onKeyDown={(e) => {
if (e.key === "Enter") commitCustom();
if (e.key === "Escape") { setCustomMode(false); setCustomText(""); }
}}
onBlur={commitCustom}
placeholder="New category name"
className="h-9"
/>
);
}

return (
<NativeSelect
value={value || CHECKLIST_UNCATEGORIZED_VALUE}
onChange={(e) => {
const v = e.target.value;
if (v === CHECKLIST_ADD_NEW_VALUE) { setCustomMode(true); return; }
onChange(v === CHECKLIST_UNCATEGORIZED_VALUE ? "" : v);
}}
className="h-9"
>
<option value={CHECKLIST_UNCATEGORIZED_VALUE}>{CHECKLIST_UNCATEGORIZED}</option>
{options.map((c) => <option key={c} value={c}>{c}</option>)}
<option value={CHECKLIST_ADD_NEW_VALUE}>+ Add new category…</option>
</NativeSelect>
);
}

function ChecklistSection({
table,
queryKey,
title,
items,
enableCategories,
}: {
table: string;
queryKey: string;
title: string;
items: any[];
/** When true, items are grouped under bold category headings (e.g. Travel Checklist). Leave off for a flat list. */
enableCategories?: boolean;
}) {
const qc = useQueryClient();
const { canEdit } = useCurrentRole();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const [open, setOpen] = useState(false);
const [newLabel, setNewLabel] = useState("");
const [newCategory, setNewCategory] = useState("");
const [adding, setAdding] = useState(false);
const [editingId, setEditingId] = useState("");
const [editingLabel, setEditingLabel] = useState("");
const [editingCategory, setEditingCategory] = useState("");

const [pendingId, setPendingId] = useState<string | null>(null);

const done = items.filter((g: any) => g.checked).length;
const categorySuggestions = useMemo(() => {
const fromItems = items.map((g: any) => (g.category ?? "").trim()).filter(Boolean);
return Array.from(new Set([...CHECKLIST_CATEGORY_PRESETS, ...fromItems])).sort((a, b) => a.localeCompare(b));
}, [items]);

async function toggle(id: string, checked: boolean) {
setPendingId(id);
const { data, error } = await supabase.from(table).update({ checked }).eq("id", id).select("id").maybeSingle();
setPendingId(null);
if (error) toast.error(error.message);
else if (!data) toast.error("Nothing was updated — you may not have permission to edit this.");
// Always refetch, success or not: the checkbox is controlled from server
// data, so on failure this is also what snaps it back to the true value.
qc.invalidateQueries({ queryKey: [queryKey, activeHouseholdId] });
}

async function addItem() {
if (!newLabel.trim() || !activeHouseholdId) return;
setAdding(true);
const maxSort = items.reduce((m, g: any) => Math.max(m, g.sort_order ?? 0), 0);
const payload: Record<string, unknown> = {
household_id: activeHouseholdId,
label: newLabel.trim(),
checked: false,
sort_order: maxSort + 1,
};
if (enableCategories) payload.category = newCategory.trim() || null;
const { error } = await supabase.from(table).insert(payload);
setAdding(false);
if (error) { toast.error(error.message); return; }
toast.success("Item added");
setNewLabel("");
setNewCategory("");
qc.invalidateQueries({ queryKey: [queryKey, activeHouseholdId] });
}

async function deleteItem(id: string) {
setPendingId(id);
const { data, error } = await supabase.from(table).delete().eq("id", id).select("id").maybeSingle();
setPendingId(null);
if (error) toast.error(error.message);
else if (!data) toast.error("Nothing was deleted — you may not have permission to remove this.");
else toast.success("Item removed");
qc.invalidateQueries({ queryKey: [queryKey, activeHouseholdId] });
}

async function saveEdit(id: string, categoryOverride?: string) {
if (!editingLabel.trim()) { setEditingId(""); return; }
const payload: Record<string, unknown> = { label: editingLabel.trim() };
if (enableCategories) payload.category = (categoryOverride ?? editingCategory).trim() || null;
setPendingId(id);
const { data, error } = await supabase.from(table).update(payload).eq("id", id).select("id").maybeSingle();
setPendingId(null);
setEditingId("");
setEditingLabel("");
setEditingCategory("");
if (error) toast.error(error.message);
else if (!data) toast.error("Nothing was saved — you may not have permission to edit this.");
else toast.success("Saved");
qc.invalidateQueries({ queryKey: [queryKey, activeHouseholdId] });
}


function renderItem(g: any) {
const isEditing = editingId === g.id;
const rowContent = isEditing ? (
<div className="flex min-w-0 flex-1 flex-col gap-1.5">
<input
autoFocus
value={editingLabel}
onChange={(e) => setEditingLabel(e.target.value)}
onKeyDown={(e) => {
if (e.key === "Enter" && !enableCategories) saveEdit(g.id);
if (e.key === "Escape") { setEditingId(""); setEditingLabel(""); setEditingCategory(""); }
}}
onBlur={() => { if (!enableCategories) saveEdit(g.id); }}
className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-0.5 text-sm"
/>
{enableCategories && (
<CategoryPicker
value={editingCategory}
suggestions={categorySuggestions}
onChange={(v) => { setEditingCategory(v); saveEdit(g.id, v); }}
/>
)}
</div>
) : (
<span className={`truncate ${g.checked ? "text-muted-foreground line-through" : ""}`}>{g.label}</span>
);
return (
<li key={g.id} className="flex items-center gap-3 text-sm">
<label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
<input
type="checkbox"
checked={!!g.checked}
disabled={!canEdit || pendingId === g.id}
onChange={(e) => toggle(g.id, e.target.checked)}
className="h-4 w-4 shrink-0 rounded border-border disabled:opacity-60"
/>
{rowContent}
</label>
{canEdit && (
<>
<button
onClick={() => { setEditingId(g.id); setEditingLabel(g.label); setEditingCategory(g.category ?? ""); }}
disabled={pendingId === g.id}
className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent disabled:opacity-60"
aria-label="Edit item"
>
<span className="text-sm">✏️</span>
</button>
<button
onClick={() => deleteItem(g.id)}
disabled={pendingId === g.id}
className="shrink-0 rounded-md p-1 text-urgent hover:bg-urgent/10 disabled:opacity-60"
aria-label="Delete item"
>
<Trash2 className="h-3.5 w-3.5" />
</button>
</>
)}
</li>
);
}

const groupedByCategory = useMemo(() => {
if (!enableCategories) return null;
const map = new Map<string, any[]>();
items.forEach((g: any) => {
const key = (g.category ?? "").trim() || CHECKLIST_UNCATEGORIZED;
if (!map.has(key)) map.set(key, []);
map.get(key)!.push(g);
});
const keys = Array.from(map.keys()).sort((a, b) => {
if (a === CHECKLIST_UNCATEGORIZED) return 1;
if (b === CHECKLIST_UNCATEGORIZED) return -1;
return a.localeCompare(b);
});
return keys.map((key) => ({ category: key, items: map.get(key)! }));
}, [enableCategories, items]);

return (
<section className="rounded-2xl border border-border bg-muted/40">
<button
type="button"
onClick={() => setOpen((v) => !v)}
className="flex w-full items-center justify-between px-4 py-3 text-left"
>
<span className="text-sm font-semibold">
{title} — {items.length} item{items.length === 1 ? "" : "s"}
{done > 0 && (
<span className="ml-2 text-xs font-normal text-muted-foreground">({done} ✓)</span>
)}
</span>
<ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
</button>
{open && (
<div className="space-y-3 border-t border-border/40 px-4 py-3">
{items.length === 0 ? (
<p className="py-2 text-center text-xs text-muted-foreground">No items yet.</p>
) : enableCategories && groupedByCategory ? (
<div className="space-y-4">
{groupedByCategory.map(({ category, items: catItems }) => (
<div key={category}>
<h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-foreground">{category}</h4>
<ul className="space-y-2">{catItems.map(renderItem)}</ul>
</div>
))}
</div>
) : (
<ul className="space-y-2">{items.map(renderItem)}</ul>
)}
{canEdit && (
<div className={enableCategories ? "space-y-2" : "flex gap-2"}>
<div className="flex gap-2">
<Input
value={newLabel}
onChange={(e) => setNewLabel(e.target.value)}
onKeyDown={(e) => { if (e.key === "Enter" && !enableCategories) addItem(); }}
placeholder="Add an item..."
className="h-9 flex-1"
/>
{!enableCategories && (
<Button size="sm" onClick={addItem} disabled={adding || !newLabel.trim()}>
<Plus className="h-3.5 w-3.5" />
</Button>
)}
</div>
{enableCategories && (
<div className="flex gap-2">
<div className="flex-1">
<CategoryPicker value={newCategory} suggestions={categorySuggestions} onChange={setNewCategory} />
</div>
<Button size="sm" onClick={addItem} disabled={adding || !newLabel.trim()}>
<Plus className="h-3.5 w-3.5" />
</Button>
</div>
)}
</div>
)}
</div>
)}
</section>
);
}

/* ––––– Add Folder ––––– */
function AddFolderSheet({ open, onClose, parentId }: { open: boolean; onClose: () => void; parentId: string | null }) {
const qc = useQueryClient();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const { storageTier, storageBytesUsed } = useCurrentRole();
const [name, setName] = useState("");
const [photoFile, setPhotoFile] = useState<File | null>(null);
const [preview, setPreview] = useState<string | null>(null);
const [saving, setSaving] = useState(false);
const fileRef = useRef<HTMLInputElement>(null);
const sheetTitle = parentId ? "New Subfolder" : "New Location";

function reset() {
setName(""); setPhotoFile(null); setPreview(null);
if (fileRef.current) fileRef.current.value = "";
}

async function save() {
if (!name.trim()) { toast.error("Name this location"); return; }
if (!activeHouseholdId) { toast.error("Select a household first."); return; }
setSaving(true);
try {
let photo_url: string | null = null;
let photo_size_bytes: number | null = null;
if (photoFile) {
const compressed = await compressImage(photoFile);
const recheck = validateInventoryPhoto(compressed);
if (!recheck.ok) throw new Error(recheck.message);
const quota = checkHouseholdQuota({ tier: storageTier, bytesUsed: storageBytesUsed, incomingFileBytes: compressed.size });
if (!quota.ok) throw new Error(quota.message);
const path = `${activeHouseholdId}/folders/${Date.now()}-${compressed.name}`;
const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, compressed);
if (upErr) throw upErr;
photo_url = path;
photo_size_bytes = compressed.size;
}
const { error } = await supabase.from("inventory_folders").insert({
household_id: activeHouseholdId,
name: name.trim(),
photo_url,
photo_size_bytes,
parent_id: parentId,
} as any);
if (error) throw error;
if (photo_size_bytes) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: photo_size_bytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Location added");
qc.invalidateQueries({ queryKey: ["folders"] });
reset(); onClose();
} catch (err: any) {
toast.error(err.message);
} finally { setSaving(false); }
}

return (
<Sheet open={open} onOpenChange={(v) => !v && (reset(), onClose())}>
<SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
<SheetHeader><SheetTitle>{sheetTitle}</SheetTitle></SheetHeader>
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
className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
aria-label="Remove photo"
>
<X className="h-3.5 w-3.5" />
</button>
</div>
) : (
<div className="flex flex-col items-center gap-1 py-6 text-muted-foreground">
<Camera className="h-7 w-7" />
<span className="text-xs">Tap to take photo or choose from library</span>
<span className="text-[11px]">Photos are compressed (~200KB) automatically</span>
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
const validation = validateInventoryPhoto(f);
if (!validation.ok) {
toast.error(validation.message);
if (fileRef.current) fileRef.current.value = "";
return;
}
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
<Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving..." : "Create"}</Button>
</div>
</div>
</SheetContent>
</Sheet>
);
}

/* ––––– Folder Detail ––––– */
function FolderSheet({ folder, items, allItems, onClose, subfolders, onOpenSubfolder, parentFolder, topLevelFolders, itemMoveOptions }: { folder: Folder; items: Item[]; allItems: Item[]; onClose: () => void; subfolders: Folder[]; onOpenSubfolder: (f: Folder) => void; parentFolder?: Folder | null; topLevelFolders: Folder[]; itemMoveOptions: { id: string; label: string }[] }) {
const qc = useQueryClient();
const { canEdit, storageTier, storageBytesUsed } = useCurrentRole();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const [adding, setAdding] = useState(false);
const [editingItem, setEditingItem] = useState<Item | null>(null);
const [showAddSubfolder, setShowAddSubfolder] = useState(false);
const [showMoveFolder, setShowMoveFolder] = useState(false);
const [movingItem, setMovingItem] = useState<Item | null>(null);
const [lightboxUrl, setLightboxUrl] = useState("");
const lightboxOpenRef = useRef(false);
const fileRef = useRef<HTMLInputElement>(null);

function closeLightbox() {
lightboxOpenRef.current = false;
setLightboxUrl("");
}

// Item count per subfolder — used for the count badge on subfolder cards.
// Computed here because FolderSheet already has allItems as a prop.
const itemCountBySf = useMemo(() => {
const m = new Map<string, number>();
for (const sf of subfolders) {
m.set(sf.id, allItems.filter((it) => it.folder_id === sf.id).length);
}
return m;
}, [subfolders, allItems]);

const backButton = parentFolder ? (
<button
onClick={onClose}
className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
>
← {parentFolder.name}
</button>
) : null;

async function delFolder() {
const subfolderIds = subfolders.map((sf) => sf.id);
const subfolderItems = allItems.filter((it) => subfolderIds.includes(it.folder_id));
const totalItems = items.length + subfolderItems.length;
if (!confirm(`Delete "${folder.name}" and everything inside — ${totalItems} item(s) and ${subfolderIds.length} subfolder(s)?`)) return;
const itemIds = [...items.map((it) => it.id), ...subfolderItems.map((it) => it.id)];
// Collect every photo this deletion is about to orphan (this folder's own
// photo, its subfolders' photos, and every item's photo underneath) BEFORE
// the rows are gone and we lose the paths/sizes needed to clean them up.
const photoUrls = [folder.photo_url, ...subfolders.map((sf) => sf.photo_url), ...items.map((it) => it.photo_url), ...subfolderItems.map((it) => it.photo_url)].filter((p): p is string => !!p);
const totalPhotoBytes = [folder, ...subfolders, ...items, ...subfolderItems].reduce((sum, x) => sum + (x.photo_size_bytes ?? 0), 0);
await supabase.from("inventory_items").delete().eq("folder_id", folder.id);
if (subfolderIds.length > 0) {
await supabase.from("inventory_items").delete().in("folder_id", subfolderIds);
await supabase.from("inventory_folders").delete().in("id", subfolderIds);
}
await supabase.from("inventory_folders").delete().eq("id", folder.id);
if (itemIds.length > 0) {
await supabase.from("reminders").delete().eq("entity_type", "inventory").in("entity_id", itemIds);
}
if (photoUrls.length > 0) {
await supabase.storage.from("inventory-photos").remove(photoUrls);
}
if (totalPhotoBytes > 0) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: -totalPhotoBytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Location deleted");
qc.invalidateQueries({ queryKey: ["folders"] });
qc.invalidateQueries({ queryKey: ["inventory_items"] });
onClose();
}

async function changePhoto(f: File) {
if (!activeHouseholdId) {
toast.error("Select a household first.");
return;
}
const preCheck = validateInventoryPhoto(f);
if (!preCheck.ok) { toast.error(preCheck.message); return; }
const compressed = await compressImage(f);
const recheck = validateInventoryPhoto(compressed);
if (!recheck.ok) { toast.error(recheck.message); return; }
const quota = checkHouseholdQuota({ tier: storageTier, bytesUsed: storageBytesUsed, incomingFileBytes: compressed.size });
if (!quota.ok) { toast.error(quota.message); return; }
const path = `${activeHouseholdId}/folders/${Date.now()}-${compressed.name}`;
const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, compressed);
if (upErr) { toast.error(upErr.message); return; }
const photo_url = path;
const oldPhotoUrl = folder.photo_url;
const oldPhotoBytes = folder.photo_size_bytes ?? 0;
const { data, error } = await supabase.from("inventory_folders").update({ photo_url, photo_size_bytes: compressed.size } as any).eq("id", folder.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
if (oldPhotoUrl) {
await supabase.storage.from("inventory-photos").remove([oldPhotoUrl]);
}
const netDelta = compressed.size - oldPhotoBytes;
if (netDelta !== 0) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: netDelta });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Photo updated");
qc.invalidateQueries({ queryKey: ["folders"] });
}

async function removeFolderPhoto() {
if (!confirm("Remove this photo?")) return;
const oldPhotoUrl = folder.photo_url;
const oldPhotoBytes = folder.photo_size_bytes ?? 0;
const { data, error } = await supabase.from("inventory_folders").update({ photo_url: null, photo_size_bytes: null } as any).eq("id", folder.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
if (oldPhotoUrl) {
await supabase.storage.from("inventory-photos").remove([oldPhotoUrl]);
}
if (oldPhotoBytes > 0) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: -oldPhotoBytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Photo removed");
qc.invalidateQueries({ queryKey: ["folders"] });
}

async function delItem(id: string) {
if (!confirm("Delete this item?")) return;
const target = allItems.find((it) => it.id === id) ?? items.find((it) => it.id === id);
await supabase.from("inventory_items").delete().eq("id", id);
await supabase.from("reminders").delete().eq("entity_type", "inventory").eq("entity_id", id);
if (target?.photo_url) {
await supabase.storage.from("inventory-photos").remove([target.photo_url]);
}
if (target?.photo_size_bytes) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: -target.photo_size_bytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
qc.invalidateQueries({ queryKey: ["inventory_items"] });
}

async function renameFolder() {
const newName = window.prompt("Rename location", folder.name);
if (newName === null) return;
const trimmed = newName.trim();
if (!trimmed || trimmed === folder.name) return;
const { data, error } = await supabase.from("inventory_folders").update({ name: trimmed }).eq("id", folder.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
toast.success("Renamed");
qc.invalidateQueries({ queryKey: ["folders"] });
}

async function moveFolderTo(targetParentId: string | null) {
const { data, error } = await supabase.from("inventory_folders").update({ parent_id: targetParentId }).eq("id", folder.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
toast.success("Moved");
qc.invalidateQueries({ queryKey: ["folders"] });
setShowMoveFolder(false);
onClose();
}

async function moveItemTo(itemId: string, targetFolderId: string) {
const { data, error } = await supabase.from("inventory_items").update({ folder_id: targetFolderId }).eq("id", itemId).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
toast.success("Item moved");
qc.invalidateQueries({ queryKey: ["inventory_items"] });
setMovingItem(null);
}

const canMoveFolder = parentFolder ? true : subfolders.length === 0;

const folderMoveOptions = useMemo(() => {
if (parentFolder) {
const opts = [{ id: "**top**", label: "Make a top-level location" }];
topLevelFolders.forEach((f) => {
if (f.id !== parentFolder.id) opts.push({ id: f.id, label: "Move into " + f.name });
});
return opts;
}
if (subfolders.length === 0) {
return topLevelFolders
.filter((f) => f.id !== folder.id)
.map((f) => ({ id: f.id, label: "Move into " + f.name }));
}
return [];
}, [parentFolder, topLevelFolders, subfolders, folder.id]);

const removePhotoButton = folder.photo_url && canEdit ? (
<button
onClick={removeFolderPhoto}
className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent"
>
<X className="h-3.5 w-3.5" /> Remove photo
</button>
) : null;

const moveFolderButton = canMoveFolder && canEdit ? (
<button
onClick={() => setShowMoveFolder(true)}
className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent"
>
<ArrowRightLeft className="h-3.5 w-3.5" /> Move
</button>
) : null;

const moveItemSheet = movingItem ? (
<MovePickerSheet
title={'Move "' + movingItem.name + '"'}
options={itemMoveOptions.filter((o) => o.id !== folder.id)}
onPick={(id) => moveItemTo(movingItem.id, id)}
onClose={() => setMovingItem(null)}
/>
) : null;

const moveFolderSheet = showMoveFolder ? (
<MovePickerSheet
title={'Move "' + folder.name + '"'}
options={folderMoveOptions}
onPick={(id) => moveFolderTo(id === "**top**" ? null : id)}
onClose={() => setShowMoveFolder(false)}
/>
) : null;

const subfolderGrid = subfolders.length > 0 ? (
<div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
{subfolders.map((sf) => (
<button
key={sf.id}
onClick={() => onOpenSubfolder(sf)}
className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition hover:shadow-md"
>
<div className="relative aspect-square w-full overflow-hidden bg-muted">
{sf.photo_url ? (
<SignedImg
bucket="inventory-photos"
path={sf.photo_url}
alt={sf.name}
className="h-full w-full object-cover"
/>
) : (
<div className="flex h-full w-full items-center justify-center">
<FolderIcon className="h-10 w-10 text-muted-foreground" />
</div>
)}
<span className="absolute right-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-semibold">
{itemCountBySf.get(sf.id) ?? 0}
</span>
</div>
<div className="p-2.5 text-sm font-semibold truncate">{sf.name}</div>
</button>
))}
</div>
) : null;

const subfoldersSection = parentFolder ? null : (
<div className="space-y-2">
<div className="flex items-center justify-between">
<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
Subfolders ({subfolders.length})
</h3>
{canEdit && (
<Button size="sm" variant="outline" onClick={() => setShowAddSubfolder(true)}>
<Plus className="mr-1 h-3.5 w-3.5" /> Add subfolder
</Button>
)}
</div>
{subfolderGrid}
</div>
);

// Callback refs for lightbox elements — fires immediately when the element enters/leaves DOM,
// so touch listeners are always attached before the user can interact.
const lightboxImgCallbackRef = (img: HTMLImageElement | null) => {
if (!img) return;
let scale = 1;
let initialDist = 0;
let startScale = 1;
const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const onTouchStart = (e: TouchEvent) => {
if (e.touches.length === 2) { initialDist = dist(e.touches); startScale = scale; }
};
const onTouchMove = (e: TouchEvent) => {
if (e.touches.length === 2) {
e.preventDefault();
scale = Math.min(5, Math.max(1, startScale * dist(e.touches) / initialDist));
img.style.transform = `scale(${scale})`;
}
};
const onTouchEnd = () => {
if (scale < 1.05) { scale = 1; img.style.transform = "scale(1)"; }
};
img.addEventListener("touchstart", onTouchStart, { passive: true });
img.addEventListener("touchmove", onTouchMove, { passive: false });
img.addEventListener("touchend", onTouchEnd, { passive: true });
// No cleanup needed — element is removed from DOM when lightbox closes, listeners are garbage collected.
};

const lightboxBackdropCallbackRef = (backdrop: HTMLDivElement | null) => {
if (!backdrop) return;
let pdOnBackdrop = false;
const onPD = (e: PointerEvent) => { pdOnBackdrop = e.target === backdrop; };
const onPU = (e: PointerEvent) => { if (pdOnBackdrop && e.target === backdrop) closeLightbox(); pdOnBackdrop = false; };
backdrop.addEventListener("pointerdown", onPD);
backdrop.addEventListener("pointerup", onPU);
};

const lightboxOverlay = lightboxUrl ? createPortal(
<div
ref={lightboxBackdropCallbackRef}
className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
style={{ pointerEvents: 'auto' }}
>
<img
ref={lightboxImgCallbackRef}
src={lightboxUrl}
alt="Full size"
draggable="false"
className="relative max-h-full max-w-full rounded-xl object-contain shadow-2xl p-4"
style={{ touchAction: 'none', transformOrigin: 'center', transition: 'transform 0.05s' }}
/>
<button
className="absolute right-4 top-4 z-[10000] rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
style={{ pointerEvents: 'auto' }}
onPointerUp={(e) => { e.stopPropagation(); closeLightbox(); }}
aria-label="Close"
>✕</button>
</div>,
document.body
) : null;

return (
<>
<Sheet open onOpenChange={(v) => { if (!v && !lightboxOpenRef.current) onClose(); }}>
<SheetContent
side="bottom"
className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl"
aria-describedby={undefined}
onPointerDownOutside={(e) => { if (lightboxOpenRef.current) e.preventDefault(); }}
onInteractOutside={(e) => { if (lightboxOpenRef.current) e.preventDefault(); }}
>
{backButton}
<SheetHeader>
<SheetTitle className="flex items-center justify-between pr-8">
<span>{folder.name}</span>
{canEdit && (
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
{removePhotoButton}
<button
onClick={renameFolder}
className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-accent"
>
<Pencil className="h-3.5 w-3.5" /> Rename
</button>
{moveFolderButton}
<button
onClick={delFolder}
className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-urgent hover:bg-urgent/10"
>
<Trash2 className="h-3.5 w-3.5" /> Delete location
</button>
</div>
</details>
)}
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
      <div className="mt-3 flex justify-center">
        <SignedImg
          bucket="inventory-photos"
          path={folder.photo_url}
          alt=""
          draggable="false"
          className="block max-w-full rounded-xl object-contain max-h-48 cursor-pointer touch-none select-none"
          onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as any)._pdX = e.clientX; (e.currentTarget as any)._pdY = e.clientY; }}
          onPointerUp={(e) => { e.stopPropagation(); const dx = e.clientX - (e.currentTarget as any)._pdX; const dy = e.clientY - (e.currentTarget as any)._pdY; if (Math.hypot(dx, dy) < 8) { lightboxOpenRef.current = true; getDisplayUrl("inventory-photos", folder.photo_url).then((u) => setLightboxUrl(u ?? "")); } }}
          title="Tap to enlarge"
        />
      </div>
    )}

    <div className="mt-4">{subfoldersSection}</div>

    <AddFolderSheet open={showAddSubfolder} onClose={() => setShowAddSubfolder(false)} parentId={folder.id} />

    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Items ({items.length})
        </h3>
        {canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add item
          </Button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No items yet.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id}>
          <HashHighlight id={`record-${it.id}`}>
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="text-sm font-semibold">{it.name}</div>
                {it.category && <div className="text-xs text-muted-foreground">{it.category}</div>}
                {it.action && <div className="mt-1 text-xs">{it.action}</div>}
                {it.warranty_date && (
                  <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    Warranty/Expiry: {fmtDate(it.warranty_date)}
                    <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                  </div>
                )}
              </div>
              {it.photo_url && (
                <SignedImg
                  bucket="inventory-photos"
                  path={it.photo_url}
                  alt=""
                  draggable="false"
                  className="h-14 w-14 rounded-md object-cover cursor-pointer touch-none select-none"
                  onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as any)._pdX = e.clientX; (e.currentTarget as any)._pdY = e.clientY; }}
                  onPointerUp={(e) => { e.stopPropagation(); const dx = e.clientX - (e.currentTarget as any)._pdX; const dy = e.clientY - (e.currentTarget as any)._pdY; if (Math.hypot(dx, dy) < 8) { lightboxOpenRef.current = true; getDisplayUrl("inventory-photos", it.photo_url).then((u) => setLightboxUrl(u ?? "")); } }}
                  title="Tap to enlarge"
                />
              )}
              {canEdit && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setMovingItem(it)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                    aria-label="Move item"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </button>
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
              )}
            </div>
            {editingItem?.id === it.id && (
              <div className="mt-3 border-t border-border pt-3">
                <EditItemForm item={it} onDone={() => setEditingItem(null)} />
              </div>
            )}
          </div>
          </HashHighlight>
          </li>
        ))}
      </ul>

      {adding && <AddItemForm folderId={folder.id} onDone={() => setAdding(false)} />}
    </div>
    {moveItemSheet}
    {moveFolderSheet}
  </SheetContent>
</Sheet>
{lightboxOverlay}
</>

);
}

/* ––––– Move Picker ––––– */
function MovePickerSheet({ title, options, onPick, onClose }: { title: string; options: { id: string; label: string }[]; onPick: (id: string) => void; onClose: () => void }) {
const emptyState = options.length === 0 ? (
<p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
No other locations available.
</p>
) : null;

return (
<Sheet open onOpenChange={(v) => !v && onClose()}>
<SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-2xl" aria-describedby={undefined}>
<SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
<div className="mt-3 space-y-1 pb-6">
{emptyState}
{options.map((o) => (
<button
key={o.id}
onClick={() => onPick(o.id)}
className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
>
{o.label}
</button>
))}
</div>
</SheetContent>
</Sheet>
);
}

/* ––––– Add Item Form ––––– */
function AddItemForm({ folderId, onDone }: { folderId: string; onDone: () => void }) {
const qc = useQueryClient();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const { storageTier, storageBytesUsed } = useCurrentRole();
const [name, setName] = useState("");
const [category, setCategory] = useState("");
const [action, setAction] = useState("");
const [warranty, setWarranty] = useState("");
const [photoFile, setPhotoFile] = useState<File | null>(null);
const [saving, setSaving] = useState(false);
const fileRef = useRef<HTMLInputElement>(null);

async function save() {
if (!name.trim()) { toast.error("Item name required"); return; }
if (!activeHouseholdId) { toast.error("Select a household first."); return; }
setSaving(true);
try {
let photo_url: string | null = null;
let photo_size_bytes: number | null = null;
if (photoFile) {
const compressed = await compressImage(photoFile);
const recheck = validateInventoryPhoto(compressed);
if (!recheck.ok) throw new Error(recheck.message);
const quota = checkHouseholdQuota({ tier: storageTier, bytesUsed: storageBytesUsed, incomingFileBytes: compressed.size });
if (!quota.ok) throw new Error(quota.message);
const path = `${activeHouseholdId}/items/${Date.now()}-${compressed.name}`;
const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, compressed);
if (upErr) throw upErr;
photo_url = path;
photo_size_bytes = compressed.size;
}
const { error } = await supabase
.from("inventory_items")
.insert({
folder_id: folderId,
name: name.trim(),
category: category.trim() || null,
action: action.trim() || null,
warranty_date: warranty || null,
photo_url,
photo_size_bytes,
} as any);
if (error) throw error;
if (photo_size_bytes) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: photo_size_bytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
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
<Label className="text-xs flex items-center gap-1">Warranty/Expiry date <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" /></Label>
<DateInput value={warranty} onChange={setWarranty} className="h-9 w-full" />
</div>
<div className="space-y-1.5">
<Label className="text-xs">Action / notes</Label>
<Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Service every 2 years" />
</div>
<div className="space-y-2">
<Label className="text-xs">Photo (optional)</Label>
<p className="text-[11px] text-muted-foreground">Photos are automatically compressed (~200KB) to keep the app fast and free.</p>
<input
ref={fileRef}
type="file"
accept="image/*"
capture="environment"
className="hidden"
onChange={(e) => {
const f = e.target.files?.[0];
if (!f) { setPhotoFile(null); return; }
const validation = validateInventoryPhoto(f);
if (!validation.ok) {
toast.error(validation.message);
if (fileRef.current) fileRef.current.value = "";
return;
}
setPhotoFile(f);
}}
/>
{photoFile ? (
<div className="relative inline-block">
<img
src={URL.createObjectURL(photoFile)}
alt=""
className="h-28 w-28 rounded-xl object-cover border border-border shadow-sm"
/>
<button
type="button"
onClick={() => { setPhotoFile(null); if (fileRef.current) fileRef.current.value = ""; }}
className="absolute -right-2 -top-2 rounded-full bg-destructive p-0.5 text-white shadow"
aria-label="Remove photo"
>
<X className="h-3.5 w-3.5" />
</button>
</div>
) : (
<button
type="button"
onClick={() => fileRef.current?.click()}
className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition"
>
<Camera className="h-5 w-5" />
<span className="text-[10px] font-medium">Add photo</span>
</button>
)}
</div>
<div className="flex gap-2">
<Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
<Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving..." : "Add item"}</Button>
</div>
</div>
);
}

/* ––––– Edit Item Form ––––– */
function EditItemForm({ item, onDone }: { item: Item; onDone: () => void }) {
const qc = useQueryClient();
const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
const { storageTier, storageBytesUsed } = useCurrentRole();
const [name, setName] = useState(item.name);
const [category, setCategory] = useState(item.category ?? "");
const [action, setAction] = useState(item.action ?? "");
const [warranty, setWarranty] = useState(item.warranty_date ?? "");
const [saving, setSaving] = useState(false);
const fileRef = useRef<HTMLInputElement>(null);

async function save() {
if (!name.trim()) { toast.error("Item name required"); return; }
setSaving(true);
const { data, error } = await supabase
.from("inventory_items")
.update({
name: name.trim(),
category: category.trim() || null,
action: action.trim() || null,
warranty_date: warranty || null,
})
.eq("id", item.id)
.select("id")
.maybeSingle();
setSaving(false);
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was saved — you may not have permission to edit this."); return; }
toast.success("Item updated");
qc.invalidateQueries({ queryKey: ["inventory_items"] });
onDone();
}

async function removePhoto() {
if (!confirm("Remove this photo?")) return;
const oldPhotoUrl = item.photo_url;
const oldPhotoBytes = item.photo_size_bytes ?? 0;
const { data, error } = await supabase.from("inventory_items").update({ photo_url: null, photo_size_bytes: null } as any).eq("id", item.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
if (oldPhotoUrl) {
await supabase.storage.from("inventory-photos").remove([oldPhotoUrl]);
}
if (oldPhotoBytes > 0) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: -oldPhotoBytes });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Photo removed");
qc.invalidateQueries({ queryKey: ["inventory_items"] });
}

async function changeItemPhoto(f: File) {
if (!activeHouseholdId) { toast.error("Select a household first."); return; }
const preCheck = validateInventoryPhoto(f);
if (!preCheck.ok) { toast.error(preCheck.message); return; }
const compressed = await compressImage(f);
const recheck = validateInventoryPhoto(compressed);
if (!recheck.ok) { toast.error(recheck.message); return; }
const quota = checkHouseholdQuota({ tier: storageTier, bytesUsed: storageBytesUsed, incomingFileBytes: compressed.size });
if (!quota.ok) { toast.error(quota.message); return; }
const path = `${activeHouseholdId}/items/${Date.now()}-${compressed.name}`;
const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, compressed);
if (upErr) { toast.error(upErr.message); return; }
const photo_url = path;
const oldPhotoUrl = item.photo_url;
const oldPhotoBytes = item.photo_size_bytes ?? 0;
const { data, error } = await supabase.from("inventory_items").update({ photo_url, photo_size_bytes: compressed.size } as any).eq("id", item.id).select("id").maybeSingle();
if (error) { toast.error(error.message); return; }
if (!data) { toast.error("Nothing was updated — you may not have permission to edit this."); return; }
if (oldPhotoUrl) {
await supabase.storage.from("inventory-photos").remove([oldPhotoUrl]);
}
const netDelta = compressed.size - oldPhotoBytes;
if (netDelta !== 0) {
{
const { error: rpcErr } = await (supabase.rpc as any)("increment_household_storage", { p_household_id: activeHouseholdId, p_delta: netDelta });
if (rpcErr) console.error("Failed to update storage usage counter:", rpcErr.message);
qc.invalidateQueries({ queryKey: ["household-memberships"] });
}
}
toast.success("Photo added");
qc.invalidateQueries({ queryKey: ["inventory_items"] });
}

const photoSection = item.photo_url ? (
<div className="space-y-1.5">
<Label className="text-xs">Photo</Label>
<div className="relative w-full">
<SignedImg bucket="inventory-photos" path={item.photo_url} alt="" className="w-full h-auto max-h-40 rounded-md object-contain" />
<div className="absolute right-2 top-2 flex gap-1">
<button
type="button"
onClick={() => fileRef.current?.click()}
className="rounded-full bg-black/60 p-1 text-white text-xs leading-none"
aria-label="Change photo"
><Camera className="h-3.5 w-3.5" /></button>
<button
type="button"
onClick={removePhoto}
className="rounded-full bg-black/60 p-1 text-white"
aria-label="Remove photo"
>
<X className="h-3.5 w-3.5" />
</button>
</div>
</div>
</div>
) : (
<div className="space-y-1.5">
<Label className="text-xs">Photo</Label>
<Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
<Camera className="mr-1 h-3.5 w-3.5" /> Add photo
</Button>
</div>
);

const photoInput = (
<input
ref={fileRef}
type="file"
accept="image/*"
className="hidden"
onChange={(e) => { const f = e.target.files?.[0]; if (f) changeItemPhoto(f); }}
/>
);

return (
<div className="space-y-3">
{photoSection}
{photoInput}
<div className="space-y-1.5">
<Label className="text-xs">Item name *</Label>
<Input value={name} onChange={(e) => setName(e.target.value)} />
</div>
<div className="space-y-1.5">
<Label className="text-xs">Category</Label>
<Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Electronics" />
</div>
<div className="space-y-1.5">
<Label className="text-xs flex items-center gap-1">Warranty/Expiry date <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" /></Label>
<DateInput value={warranty} onChange={setWarranty} className="h-9 w-full" />
</div>
<div className="space-y-1.5">
<Label className="text-xs">Action / notes</Label>
<Textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} />
</div>
<div className="rounded-xl border border-border bg-muted/40 p-3">
  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
    <Bell className="h-3.5 w-3.5 fill-yellow-500 text-yellow-500" /> Reminders
  </div>
  <div className="mt-2">
    <RemindersList entityType="inventory" entityId={item.id} />
  </div>
  <div className="flex justify-end pt-2">
    <ReminderButton entityType="inventory" entityId={item.id} />
  </div>
</div>

  <div className="flex gap-2">
    <Button variant="outline" className="flex-1" onClick={onDone}>Cancel</Button>
    <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
  </div>
</div>

);
}
