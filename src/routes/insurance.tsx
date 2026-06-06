import { Bell } from "lucide-react";
import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord } from "@/components/EditRecordButton";
import { freqLabel } from "@/lib/options";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";

export const Route = createFileRoute("/insurance")({
  component: InsurancePage,
  head: () => ({ meta: [{ title: "Insurance — FamilyVault" }] }),
});

function InsurancePage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const status = useStatusMutation("insurance_policies", "insurance");
  const del = useDeleteMutation("insurance_policies", "insurance");

  const { data: items = [] } = useQuery({
    queryKey: ["insurance", memberFilter],
    queryFn: async () => {
      let q = supabase.from("insurance_policies").select("*");
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalAnnual = items.reduce((s: number, i: any) => {
    if (!i.premium) return s;
    const f = (i.frequency || "annual").toLowerCase();
    const mult = f.includes("month") ? 12 : f.includes("quart") ? 4 : f.includes("semi") ? 2 : 1;
    return s + Number(i.premium) * mult;
  }, 0);

  const categories = Array.from(new Set(items.map((i: any) => i.category)));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Insurance</h1>
      <p className="text-xs text-muted-foreground">
        {items.length} policies · {fmtMoney(totalAnnual)} / year total
      </p>
      <MemberFilterBar table="insurance_policies" />

      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No policies yet. Tap + to add your first.</p>
        </div>
      )}

      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{cat}</h2>
          <div className="space-y-3">
            {sortByStatus(items.filter((i: any) => i.category === cat)).map((p: any) => (
              <InsuranceRow
                key={p.id}
                p={p}
                onStatus={(s) => status.mutate({ id: p.id, status: s })}
                onDelete={() => del.mutate(p.id)}
              />
            ))}
          </div>
        </section>
      ))}
      <AddRecordFab configKey="insurance_policies" />
    </div>
  );
}

function AlertLabel({ text, date }: { text: string; date?: string | null }) {
  const isAlert = date != null && new Date(date) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return (
    <span className="flex items-center gap-1">
      {text}
      {isAlert && <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />}
    </span>
  );
}

function InsuranceRow({ p, onStatus, onDelete }: { p: any; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("insurance_policies", p);
  return (
    <HashHighlight id={`record-${p.id}`}>
      <RecordCard
        title={p.name}
        subtitle={p.provider}
        memberId={p.member_id}
        status={p.status}
        onStatusChange={onStatus}
        action={p.action}
        onEdit={edit.open}
        onDelete={onDelete}
        rightMeta={
          <div className="text-right text-xs">
            <div className="font-bold">{fmtMoney(p.premium)}</div>
            <div className="text-muted-foreground">/ {freqLabel(p.frequency)}</div>
          </div>
        }
      >
        <Section title="Policy">
          <FieldRow label="Policy #" value={p.policy_number} />
          <FieldRow label="Sum assured" value={fmtMoney(p.sum_assured)} />
          <FieldRow label="Start" value={fmtDate(p.start_date)} />
          <FieldRow label={<AlertLabel text="End" date={p.end_date} />} value={fmtDate(p.end_date)} />
          <FieldRow label={<AlertLabel text="Next due" date={p.next_due_date} />} value={fmtDate(p.next_due_date)} />
        </Section>

        <CollapsibleSection icon={<span>📝</span>} title="Notes">
          <NotesEditor
            table="insurance_policies"
            queryKey="insurance"
            id={p.id}
            value={p.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="insurance" entityId={p.id} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="insurance" entityId={p.id} />
        </CollapsibleSection>

        <RemindersList entityType="insurance" entityId={p.id} />
        <div className="flex justify-end pt-1">
          <ReminderButton entityType="insurance" entityId={p.id} />
        </div>
      </RecordCard>
      {edit.element}
    </HashHighlight>
  );
}
