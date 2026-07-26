import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["Fixed", "SORA+", "COF+", "Other"];
const YEAR_OPTIONS = Array.from({ length: 10 }, (_, i) => `Year ${i + 1}`);

export function RateSchedule({ loanId }: { loanId: string }) {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["rate_schedule", loanId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loan_rate_schedule")
        .select("*")
        .eq("loan_id", loanId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function addRow() {
    const nextYear = rows.length + 1;
    const { error } = await supabase.from("loan_rate_schedule").insert({
      loan_id: loanId,
      year_label: `Year ${nextYear}`,
      rate: null,
      rate_type: "Fixed",
      sort_order: nextYear,
    });
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["rate_schedule", loanId] });
  }

  async function update(id: string, patch: any) {
    const { error } = await supabase.from("loan_rate_schedule").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else qc.invalidateQueries({ queryKey: ["rate_schedule", loanId] });
  }

  async function del(id: string) {
    await supabase.from("loan_rate_schedule").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["rate_schedule", loanId] });
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_110px_28px] gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Year</span>
        <span>Rate %</span>
        <span>Type</span>
        <span />
      </div>
      <div className="space-y-1.5">
        {rows.map((r: any) => (
          <div key={r.id} className="grid grid-cols-[1fr_80px_110px_28px] items-center gap-1.5 text-sm">
            <NativeSelect
              value={r.year_label}
              onChange={(e) => update(r.id, { year_label: e.target.value })}
              className="h-8"
            >
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </NativeSelect>
            <Input
              type="number"
              step="0.01"
              defaultValue={r.rate ?? ""}
              onBlur={(e) => update(r.id, { rate: e.target.value ? Number(e.target.value) : null })}
              className="h-8"
              placeholder="0.00"
            />
            <NativeSelect
              value={r.rate_type ?? "Fixed"}
              onChange={(e) => update(r.id, { rate_type: e.target.value })}
              className="h-8"
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
            <button onClick={() => del(r.id)} className="text-urgent" aria-label="Delete row">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No rate schedule yet.</p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={addRow}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add Year
      </Button>
    </div>
  );
}
