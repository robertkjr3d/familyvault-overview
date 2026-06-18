import { useState } from "react";
import { Bell, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

export function ReminderButton({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

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
    toast.success("Reminder set");
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["reminders"] });
    qc.invalidateQueries({ queryKey: ["alert-count"] });
    setOpen(false);
    setWhat("");
    setDate("");
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Bell className="mr-1 h-3.5 w-3.5 fill-yellow-500 text-yellow-500" /> Set Reminder
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Set Reminder</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3 pb-6">
          <div className="space-y-1.5">
            <Label className="text-xs">What</Label>
            <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Reprice loan" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date</Label>
            <div className="relative flex items-center">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 w-full pr-8" />
              {date && (
                <button
                  type="button"
                  onClick={() => setDate("")}
                  className="absolute right-2 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label="Clear date"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save Reminder"}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
