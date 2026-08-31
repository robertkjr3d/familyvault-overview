import { useState } from "react";
import { Bell } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useAppStore } from "@/lib/store";

export function ReminderButton({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { canEdit } = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  if (!canEdit) return null;

  async function save() {
    if (!what || !date) return toast.error("What and date are required");
    setSaving(true);
    const remindAt = new Date(`${date}T12:00:00`).toISOString();
    const { error } = await supabase.from("reminders").insert({
      entity_type: entityType,
      entity_id: entityId,
      what,
      remind_at: remindAt,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    // Suppressed during a guided tour on purpose (Aug 28, 2026): the tour is
    // meant to feel like a clean, self-contained walkthrough — a real
    // side-effect toast popping up mid-tour looked unpolished even after
    // the earlier z-index fix (styles.css) kept it from visually covering
    // the highlight; simplest fix is to just not show it here at all while
    // a tour is running. getState() (not the reactive useAppStore(...)
    // hook) because this only needs to be read once, inside a click
    // handler, not on every render.
    if (!useAppStore.getState().activeTour) toast.success("Reminder set");
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["reminders"] });
    qc.invalidateQueries({ queryKey: ["alert-count"] });
    qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count itself no longer exists as a query - this is the key that actually needs invalidating now
    qc.invalidateQueries({ queryKey: ["alerts-extras"] });
    // Bug fix (July 2026): none of the keys above are what the collapsed
    // card's own bell-icon badge reads — that count comes from
    // useEntityCounts()'s ["entity-counts", entityType, householdId] query,
    // which was never being invalidated here at all, so the badge only ever
    // updated on a full page reload.
    qc.invalidateQueries({ queryKey: ["entity-counts"] });
    setOpen(false);
    setWhat("");
    setDate("");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" data-tour="reminder-trigger">
          <Bell className="mr-1 h-3.5 w-3.5 fill-yellow-500 text-yellow-500" /> Set Reminder
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Set Reminder</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 pb-6">
          <div className="space-y-1.5 p-1" data-tour="field-reminder-what">
            {/* p-1 added (Aug 30, 2026): same real cause as the form fields
                in RecordFormSheet.tsx — this div is the tour's actual
                highlight target, had no padding of its own, so the
                highlight hugged the label/input unevenly and didn't match
                the input's own rounded shape. This dialog has its own
                separate field markup (not RecordFormSheet's), so the
                earlier fix there never applied here. */}
            <Label className="text-xs">What</Label>
            <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Reprice loan" />
          </div>
          <div className="space-y-1.5 p-1" data-tour="field-reminder-date">
            <Label className="text-xs">Date</Label>
            <DateInput value={date} onChange={setDate} className="h-9 w-full" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={saving} onClick={save} data-tour="reminder-save">{saving ? "Saving…" : "Save Reminder"}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
