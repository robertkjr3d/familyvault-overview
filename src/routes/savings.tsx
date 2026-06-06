import { AddRecordFab } from "@/components/AddRecordFab";
import { Bell } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate, fmtPct } from "@/lib/format";
import { useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useEditRecord } from "@/components/EditRecordButton";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { DocumentsList } from "@/components/loan/DocumentsList";

export const Route = createFileRoute("/savings")({
  component: SavingsPage,
  head: () => ({ meta: [{ title: "Savings — FamilyVault" }] }),
});

const GROUP_ORDER = ["Fixed Deposits", "Fixed Deposit", "FD", "Banks", "Bank Accounts", "SRS", "CPF"];
function groupRank(name: string) {
  const i = GROUP_ORDER.findIndex((g) => g.toLowerCase() === (name ?? "").toLowerCase());
  return i === -1 ? 999 : i;
}

function staleDays(lastUpdated: string | null | undefined) {
  if (!lastUpdated) return null;
  try { return differenceInDays(new Date(), parseISO(lastUpdated)); } catch { return null; }
}

function UpdateBalanceInline({ id, current }: { id: string; current: number | null | undefined }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current?.toString() ?? "");
  const qc = useQueryClient();

  async function save() {
    const num = Number(val.replace(/,/g, ""));
    if (isNaN(num)) { toast.error("Enter a valid number"); return; }
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("savings_accounts").update({ balance: num, last_updated: today }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Balance updated");
      qc.invalidateQueries({ queryKey: ["savings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
        Update
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input type="text" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} className="h-7 w-24 text-xs" autoFocus />
      <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={save}>Save</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-xs" onClick={() => setEditing(false)}>✕</Button>
    </div>
  );
}

function SavingsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const status = useStatusMutation("savings_accounts", "savings");
  const del = useDeleteMutation("savings_accounts", "savings");

  const { data: items = [] } = useQuery({
    queryKey: ["savings", memberFilter],
    queryFn: async () => {
      let q = supabase.from("savings_accounts").select("*");
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const groups = Array.from(new Set(items.map((i: any) => i.group_name))).sort((a, b) => groupRank(a) - groupRank(b));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Savings</h1>
      <MemberFilterBar table="savings_accounts" />
      {groups.map((g) => (
        <section key={g}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{g}</h2>
          <div className="space-y-3">
            {sortByStatus(items.filter((i: any) => i.group_name === g)).map((a: any) => (
              <SavingsRow
                key={a.id}
                a={a}
                onStatus={(s) => status.mutate({ id: a.id, status: s })}
                onDelete={() => del.mutate(a.id)}
              />
            ))}
          </div>
        </section>
      ))}
      <AddRecordFab configKey="savings_accounts" />
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

function SavingsRow({ a, onStatus, onDelete }: { a: any; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("savings_accounts", a);
  const stale = staleDays(a.last_updated);
  const isStale = stale != null && stale >= 30;
  return (
    <>
      <RecordCard
        title={`${a.institution} · ${a.account_type ?? ""}`}
        subtitle={a.note}
        memberId={a.member_id}
        status={a.status}
        onStatusChange={onStatus}
        action={a.note}
        onEdit={edit.open}
        onDelete={onDelete}
        rightMeta={
          <div className="text-right text-xs">
            <div className="font-bold">{fmtMoney(a.balance)}</div>
            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
              {isStale && (
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "hsl(38 95% 55%)" }} aria-label="Balance is stale" />
              )}
              <span>{a.last_updated ? `Last updated: ${fmtDate(a.last_updated)}` : "Never updated"}</span>
            </div>
            {a.interest_rate != null && <div className="text-muted-foreground">{fmtPct(a.interest_rate)}</div>}
          </div>
        }
      >
        <Section title="Account">
          <FieldRow label="Balance" value={fmtMoney(a.balance)} />
          <FieldRow label="Interest rate" value={fmtPct(a.interest_rate)} />
          <FieldRow label={<AlertLabel text="Maturity" date={a.maturity_date} />} value={fmtDate(a.maturity_date)} />
          <FieldRow label="Last updated" value={fmtDate(a.last_updated)} />
        </Section>

        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/60 px-3 py-2">
          <div className="text-xs">
            {isStale ? (
              <span className="font-medium" style={{ color: "hsl(38 95% 35%)" }}>● Update balance</span>
            ) : (
              <span className="text-muted-foreground">Update balance</span>
            )}
          </div>
          <UpdateBalanceInline id={a.id} current={a.balance} />
        </div>

        <CollapsibleSection icon={<span>📝</span>} title="Notes">
          <NotesEditor
            table="savings_accounts"
            queryKey="savings"
            id={a.id}
            value={a.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="savings" entityId={a.id} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="savings" entityId={a.id} />
        </CollapsibleSection>

        <RemindersList entityType="savings" entityId={a.id} />
        <div className="flex justify-end pt-1">
          <ReminderButton entityType="savings" entityId={a.id} />
        </div>
      </RecordCard>
      {edit.element}
    </>
  );
}
