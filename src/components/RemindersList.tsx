import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/format";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { computeNextReminderDate, recurrenceLabel } from "@/lib/reminderRecurrence";

export function RemindersList({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { canEdit } = useCurrentRole();
  const qc = useQueryClient();

  const { data: reminders = [] } = useQuery({
    queryKey: ["reminders", entityType, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminders")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("dismissed", false)
        .order("remind_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // "Done" always means "delete this reminder" — one-off or recurring. This is
  // the ONLY way to remove a reminder from its record page, so it has to be a
  // real delete, not a per-cycle "advance" (that was tried first and reverted
  // Sep 26 2026 — see reminderRecurrence.ts for the full story — because it
  // left no way to actually get rid of a recurring reminder you no longer
  // want). A recurring reminder's own "next due date" is never edited here;
  // it's computed fresh each render from its fixed anchor date, GIRO-style —
  // dismissing THIS occurrence without deleting the series happens from the
  // Dashboard's "X" button instead (unchanged code, index.tsx's dismissItem).
  async function markDone(id: string) {
    const { data, error } = await supabase
      .from("reminders")
      .update({ dismissed: true })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error("Nothing was updated — you may not have permission to edit this.");
      return;
    }
    toast.success("Reminder removed");
    qc.invalidateQueries({ queryKey: ["reminders", entityType, entityId] });
    qc.invalidateQueries({ queryKey: ["alert-count"] });
    qc.invalidateQueries({ queryKey: ["alert-count-extras"] }); // alert-count itself no longer exists as a query (see householdRecordQueries.ts) - this is the key that actually needs invalidating now
    qc.invalidateQueries({ queryKey: ["alerts-all"] });
    qc.invalidateQueries({ queryKey: ["alerts-extras"] }); // alerts-all itself no longer exists (AlertsSheet migration) - this is its replacement
    qc.invalidateQueries({ queryKey: ["reminders-dashboard"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    // Bug fix (July 2026) — see matching fix + comment in ReminderButton.tsx:
    // the collapsed card's bell badge count comes from useEntityCounts(),
    // never invalidated here before, so marking a reminder done didn't
    // update it until a full page reload.
    qc.invalidateQueries({ queryKey: ["entity-counts"] });
  }

  if (reminders.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-1">
      {reminders.map((r: any) => {
        // Recurring reminders show their next computed occurrence (GIRO-style,
        // never overdue) instead of the raw anchor date — same date the
        // Dashboard shows, via alerts.ts's identical computation. One-off
        // reminders are unchanged: raw remind_at, can show Overdue.
        const displayDate = r.recurrence
          ? (computeNextReminderDate(
              r.remind_at,
              r.recurrence,
              r.recurrence_end_of_month,
              new Date(),
            ) ?? r.remind_at)
          : r.remind_at;
        const isOverdue = !r.recurrence && new Date(r.remind_at) < new Date();
        return (
          <div
            key={r.id}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
              isOverdue
                ? "border-yellow-400/40 bg-yellow-50/60 dark:bg-yellow-900/10"
                : "border-border bg-muted/40"
            }`}
          >
            <Bell className={`h-3.5 w-3.5 shrink-0 fill-yellow-500 text-yellow-500`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{r.what}</p>
              <p
                className={`text-[10px] ${isOverdue ? "text-yellow-600 dark:text-yellow-400 font-semibold" : "text-muted-foreground"}`}
              >
                {isOverdue ? "Overdue · " : ""}
                {fmtDate(displayDate)}
                {r.recurrence
                  ? ` · ↻ ${recurrenceLabel(r.recurrence, r.recurrence_end_of_month)}`
                  : ""}
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs shrink-0"
                onClick={() => markDone(r.id)}
              >
                <Check className="h-3 w-3 mr-1" /> Done
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
