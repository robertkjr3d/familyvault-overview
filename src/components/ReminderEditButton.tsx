import { useState } from "react";
import { Pencil } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RECURRENCE_OPTIONS,
  buildReminderEditPatch,
  reminderDateInputValue,
} from "@/lib/reminderRecurrence";

type EditableReminder = {
  id: string;
  what: string | null;
  remind_at: string | null;
  recurrence: string | null;
  recurrence_end_of_month: boolean | null;
};

/**
 * Pencil button + edit Sheet for ONE existing reminder (rendered by RemindersList for editors).
 * Edits only what / date / repeat. It never changes which record the reminder belongs to, and it
 * deliberately has NO data-tour attributes (the guided tour targets ReminderButton's fields).
 * Kept separate from ReminderButton so that component's tour and iOS focus fixes are untouched.
 */
export function ReminderEditButton({
  reminder,
  entityType,
  entityId,
}: {
  reminder: EditableReminder;
  entityType: string;
  entityId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [date, setDate] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [endOfMonth, setEndOfMonth] = useState(false);
  const [saving, setSaving] = useState(false);

  function openEditor() {
    // Start from the stored values every time the editor opens.
    setWhat(reminder.what ?? "");
    setDate(reminderDateInputValue(reminder.remind_at));
    setRecurrence(reminder.recurrence ?? "");
    setEndOfMonth(!!reminder.recurrence_end_of_month);
    setOpen(true);
  }

  async function save() {
    if (!what.trim() || !date) return toast.error("What and date are required");
    const patch = buildReminderEditPatch(reminder, { what, date, recurrence, endOfMonth });
    if (!patch) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("reminders")
      .update(patch as never)
      .eq("id", reminder.id)
      .select("id")
      .maybeSingle();
    setSaving(false);
    if (error) return toast.error(error.message);
    if (!data)
      return toast.error("Nothing was updated — you may not have permission to edit this.");
    toast.success("Reminder updated");
    qc.invalidateQueries({ queryKey: ["reminders", entityType, entityId] });
    qc.invalidateQueries({ queryKey: ["alert-count-extras"] });
    qc.invalidateQueries({ queryKey: ["alerts-extras"] });
    qc.invalidateQueries({ queryKey: ["reminders-dashboard"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["entity-counts"] });
    setOpen(false);
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 shrink-0 p-0"
        aria-label="Edit reminder"
        onClick={openEditor}
      >
        <Pencil className="h-3 w-3" />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Edit Reminder</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3 pb-6">
            <div className="space-y-1.5 p-1">
              <Label className="text-xs">What</Label>
              <Input value={what} onChange={(e) => setWhat(e.target.value)} />
            </div>
            <div className="space-y-1.5 p-1">
              <Label className="text-xs">Date</Label>
              <DateInput value={date} onChange={setDate} className="h-9 w-full" />
            </div>
            <div className="space-y-1.5 p-1">
              <Label className="text-xs">Repeat</Label>
              <NativeSelect
                value={recurrence}
                onChange={(e) => {
                  setRecurrence(e.target.value);
                  if (e.target.value !== "monthly") setEndOfMonth(false);
                }}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
              {recurrence === "monthly" && (
                <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <Checkbox checked={endOfMonth} onCheckedChange={(v) => setEndOfMonth(!!v)} />
                  Always the last day of the month
                </label>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button className="flex-1" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
