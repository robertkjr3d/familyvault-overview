import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/MoneyInput";
import { compressImage } from "@/lib/imageCompression";
import { INSURANCE_CATEGORIES, INSURANCE_FREQ } from "@/lib/options";
import { Home, Shield, Package, TrendingUp, Check, Camera, X, ChevronRight } from "lucide-react";

// Design intent (per Azariah, 21 Jun 2026): this is a "why should I use this"
// demo, not a data-completeness form. Each step only asks for the 2-3 fields
// a brand-new user would actually know off the top of their head, and each
// one is chosen specifically because it shows a payoff the user can SEE
// immediately (an automatic alert, a working search, a populated chart) —
// not because it's the most important field to capture long-term. Nothing
// here is required or sequenced; every step is independently skippable.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasProperty: boolean;
  hasInsurance: boolean;
  hasInventoryItem: boolean;
  onDismissForever: () => void;
  onScrollToLifetimeChart: () => void;
};

export function OnboardingWizard({
  open,
  onOpenChange,
  hasProperty,
  hasInsurance,
  hasInventoryItem,
  onDismissForever,
  onScrollToLifetimeChart,
}: Props) {
  const [expanded, setExpanded] = useState<"home" | "insurance" | "inventory" | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Welcome to FamilyHub SG 👋</SheetTitle>
        </SheetHeader>
        <p className="mt-1 text-xs text-muted-foreground">
          Four quick things that show you what this actually does for you — under a minute each, any order, skip whatever you like.
        </p>

        <div className="mt-4 space-y-3 pb-6">
          <StepCard
            icon={Home}
            title="Add your home"
            blurb="See it instantly reflected in your Net Worth and Lifetime Chart below."
            done={hasProperty}
            expanded={expanded === "home"}
            onToggle={() => setExpanded((e) => (e === "home" ? null : "home"))}
          >
            <QuickAddProperty onSaved={() => setExpanded(null)} />
          </StepCard>

          <StepCard
            icon={Shield}
            title="Add an insurance policy"
            blurb="We'll automatically remind you before it renews — no spreadsheet, no forgetting."
            done={hasInsurance}
            expanded={expanded === "insurance"}
            onToggle={() => setExpanded((e) => (e === "insurance" ? null : "insurance"))}
          >
            <QuickAddInsurance onSaved={() => setExpanded(null)} />
          </StepCard>

          <StepCard
            icon={Package}
            title="Add one inventory item"
            blurb="Snap a photo now, find it in seconds later with search."
            done={hasInventoryItem}
            expanded={expanded === "inventory"}
            onToggle={() => setExpanded((e) => (e === "inventory" ? null : "inventory"))}
          >
            <QuickAddInventoryItem onSaved={() => setExpanded(null)} />
          </StepCard>

          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onScrollToLifetimeChart();
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <TrendingUp className="h-4 w-4" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold">See your Lifetime Chart</span>
              <span className="block text-xs text-muted-foreground">Your net worth projected forward, year by year.</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </div>

        <div className="border-t border-border pt-3 text-center">
          <button
            type="button"
            onClick={onDismissForever}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            Don't show this again — I'll explore on my own
          </button>
          <p className="mt-1 text-[10px] text-muted-foreground">You can always bring this back from Settings → About.</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StepCard({
  icon: Icon,
  title,
  blurb,
  done,
  expanded,
  onToggle,
  children,
}: {
  icon: any;
  title: string;
  blurb: string;
  done: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-3 transition-colors ${done ? "border-settled-border bg-settled-tint" : "border-border bg-card"}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            done ? "bg-settled text-settled-foreground" : "bg-accent text-accent-foreground"
          }`}
        >
          {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{done ? "Done — tap to add another" : blurb}</span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>
      {expanded && <div className="mt-3 border-t border-border/60 pt-3">{children}</div>}
    </div>
  );
}

/* ---------- Step 1: Property ---------- */
function QuickAddProperty({ onSaved }: { onSaved: () => void }) {
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [hasMortgage, setHasMortgage] = useState(false);
  const [monthlyPayment, setMonthlyPayment] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error('Give it a name, e.g. "Our home"'); return; }
    if (!activeHouseholdId) { toast.error("Select a household first."); return; }
    setSaving(true);
    try {
      const payload = {
        household_id: activeHouseholdId,
        name: name.trim(),
        current_value: currentValue ? Number(currentValue) : null,
        monthly_rent: monthlyRent ? Number(monthlyRent) : null,
        monthly_payment: hasMortgage && monthlyPayment ? Number(monthlyPayment) : null,
        action_note: noteText.trim() || null,
      };
      const { data, error } = await supabase.from("properties").insert(payload).select("id").single();
      if (error) throw error;

      if (noteText.trim() && noteDate) {
        await supabase.from("reminders").insert({
          household_id: activeHouseholdId,
          entity_type: "property",
          entity_id: (data as any).id,
          what: noteText.trim(),
          remind_at: new Date(`${noteDate}T12:00:00`).toISOString(),
        });
      }

      toast.success("Home added");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["properties"] });
      qc.invalidateQueries({ queryKey: ["reminders-dashboard"] });
      qc.invalidateQueries({ queryKey: ["alert-count"] });
      qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count no longer exists as a query - this is the key that actually needs invalidating now
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">What should we call it?</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Our home" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Current value</Label>
          <MoneyInput value={currentValue} onChange={setCurrentValue} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Monthly rent (if any)</Label>
          <MoneyInput value={monthlyRent} onChange={setMonthlyRent} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={hasMortgage}
          onChange={(e) => setHasMortgage(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        There's a mortgage on this
      </label>
      {hasMortgage && (
        <div className="space-y-1.5">
          <Label className="text-xs">Monthly mortgage payment</Label>
          <MoneyInput value={monthlyPayment} onChange={setMonthlyPayment} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">Note or reminder (optional)</Label>
        <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Renew lease" />
        {noteText.trim() && (
          <DateInput value={noteDate} onChange={setNoteDate} className="mt-1" showClear={false} />
        )}
      </div>
      <Button className="w-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save home"}</Button>
    </div>
  );
}

/* ---------- Step 2: Insurance ---------- */
function QuickAddInsurance({ onSaved }: { onSaved: () => void }) {
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const qc = useQueryClient();
  // Defaults to 30 days out so the "we'll alert you 90 days before renewal"
  // payoff is immediately visible in the dashboard's upcoming list after
  // saving, rather than the user having to take it on faith.
  const defaultRenewal = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [premium, setPremium] = useState("");
  const [frequency, setFrequency] = useState("annual");
  const [renewalDate, setRenewalDate] = useState(defaultRenewal);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error("Give the policy a name"); return; }
    if (!category) { toast.error("Pick a category"); return; }
    if (!activeHouseholdId) { toast.error("Select a household first."); return; }
    setSaving(true);
    try {
      // start_date doubles as "next renewal" here — computeNextOccurrence
      // (src/lib/alerts.ts) returns the start date as-is whenever it's
      // already on/after today, so this is the correct field to set.
      const { error } = await supabase.from("insurance_policies").insert({
        household_id: activeHouseholdId,
        name: name.trim(),
        category,
        premium: premium ? Number(premium) : null,
        frequency,
        start_date: renewalDate || null,
      });
      if (error) throw error;
      toast.success("Policy added — you'll be alerted before it renews");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["insurance"] });
      qc.invalidateQueries({ queryKey: ["alert-count"] });
      qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count no longer exists as a query - this is the key that actually needs invalidating now
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Policy name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NTUC Life Insurance" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Select…</option>
            {INSURANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Premium</Label>
          <MoneyInput value={premium} onChange={setPremium} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">How often?</Label>
          <NativeSelect value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {INSURANCE_FREQ.filter((f) => typeof f !== "string" && f.value !== "one-off").map((f: any) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Next renews</Label>
          <DateInput value={renewalDate} onChange={setRenewalDate} showClear={false} />
        </div>
      </div>
      <p className="rounded-lg bg-accent/50 px-2.5 py-2 text-[11px] text-accent-foreground">
        💡 We'll automatically alert you 90 days before this renews — no manual reminder needed.
      </p>
      <Button className="w-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save policy"}</Button>
    </div>
  );
}

/* ---------- Step 3: Inventory ---------- */
function QuickAddInventoryItem({ onSaved }: { onSaved: () => void }) {
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickPhoto(f: File | null) {
    setPhotoFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function save() {
    if (!name.trim()) { toast.error("Give the item a name"); return; }
    if (!activeHouseholdId) { toast.error("Select a household first."); return; }
    setSaving(true);
    try {
      // inventory_items needs a folder_id — reuse the household's first
      // top-level Location if one exists, otherwise create a default "Home"
      // one. This intentionally skips teaching the Locations concept during
      // the quick demo; the user can reorganise into real locations later.
      let folderId: string;
      const { data: existingFolder } = await supabase
        .from("inventory_folders")
        .select("id")
        .eq("household_id", activeHouseholdId)
        .is("parent_id", null)
        .limit(1)
        .maybeSingle();
      if (existingFolder) {
        folderId = (existingFolder as any).id;
      } else {
        const { data: newFolder, error: folderErr } = await supabase
          .from("inventory_folders")
          .insert({ household_id: activeHouseholdId, name: "Home", parent_id: null })
          .select("id")
          .single();
        if (folderErr) throw folderErr;
        folderId = (newFolder as any).id;
      }

      let photo_url: string | null = null;
      if (photoFile) {
        const compressed = await compressImage(photoFile);
        const path = `${activeHouseholdId}/items/${Date.now()}-${compressed.name}`;
        const { error: upErr } = await supabase.storage.from("inventory-photos").upload(path, compressed);
        if (upErr) throw upErr;
        photo_url = path;
      }

      const { error } = await supabase.from("inventory_items").insert({
        folder_id: folderId,
        name: name.trim(),
        photo_url,
      });
      if (error) throw error;

      toast.success("Item added — try searching for it on the Inventory tab");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["inventory_items"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">What is it?</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living room TV" />
      </div>
      <div>
        <Label className="text-xs">Photo (optional, but this is the fun part)</Label>
        <div
          onClick={() => !preview && fileRef.current?.click()}
          className="mt-1 flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/40 min-h-[80px]"
        >
          {preview ? (
            <div className="relative w-full">
              <img src={preview} alt="" className="w-full h-auto object-contain max-h-40" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pickPhoto(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white"
                aria-label="Remove photo"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 py-6 text-muted-foreground">
              <Camera className="h-7 w-7" />
              <span className="text-xs">Tap to take a photo or choose from library</span>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
        />
      </div>
      <Button className="w-full" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save item"}</Button>
    </div>
  );
}
