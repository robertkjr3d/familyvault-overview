import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtDate, fmtMonth, fmtPct } from "@/lib/format";
import { HashHighlight } from "@/components/HashHighlight";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { RateSchedule } from "@/components/loan/RateSchedule";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { monthlyPayment, remainingBalance, monthsSince } from "@/lib/loanMath";
import { useToday } from "@/lib/today";
import { useEditRecord } from "@/components/EditRecordButton";

export const Route = createFileRoute("/loans")({
  component: LoansPage,
  head: () => ({ meta: [{ title: "Loans — FamilyVault" }] }),
});

function LoansPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const status = useStatusMutation("loans", "loans");
  const del = useDeleteMutation("loans", "loans");
  const { today } = useToday();

  const { data: loans = [] } = useQuery({
    queryKey: ["loans", memberFilter],
    queryFn: async () => {
      let q = supabase.from("loans").select("*");
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Loans</h1>
      <MemberFilterBar table="loans" />
      <div className="space-y-3">
        {sortByStatus(loans).map((l: any) => (
          <LoanRow
            key={l.id}
            l={l}
            today={today}
            onStatus={(s) => status.mutate({ id: l.id, status: s })}
            onDelete={() => del.mutate(l.id)}
          />
        ))}
      </div>
      <AddRecordFab configKey="loans" />
    </div>
  );
}

function LoanRow({ l, today, onStatus, onDelete }: { l: any; today: Date; onStatus: (s: any) => void; onDelete: () => void }) {
  const edit = useEditRecord("loans", l);
  const principal = Number(l.original_amount ?? l.balance ?? 0);
  const rate = Number(l.rate ?? 0);
  const term = Number(l.term_years ?? 0);
  const calcPmt = principal && term ? monthlyPayment(principal, rate, term) : 0;
  const calcBal =
    principal && term && l.start_date
      ? remainingBalance(principal, rate, term, monthsSince(l.start_date, today))
      : null;
  const actionLabel = l.reprice_date
    ? `Reprice by ${fmtMonth(l.reprice_date)}`
    : l.action || null;

  return (
    <HashHighlight id={`record-${l.id}`}>
      <RecordCard
        title={`${l.bank} · ${l.purpose ?? ""}`}
        subtitle={l.rate_label || (l.rate ? `${l.rate}%` : "")}
        memberId={l.member_id}
        status={l.status}
        onStatusChange={onStatus}
        action={actionLabel}
        onEdit={edit.open}
        onDelete={onDelete}
        rightMeta={
          <div className="text-right text-xs">
            <div className="font-bold">{fmtMoney(l.balance)}</div>
            {(l.monthly_payment || calcPmt) && (
              <div className="text-muted-foreground">
                {fmtMoney(l.monthly_payment || calcPmt)}/mo
              </div>
            )}
          </div>
        }
      >
        <Section title="Loan details">
          <FieldRow label="Original amount" value={fmtMoney(l.original_amount)} />
          <FieldRow label="Current balance" value={fmtMoney(l.balance)} />
          <FieldRow label="Loan start" value={fmtDate(l.start_date)} />
          <FieldRow label="Term (years)" value={l.term_years ?? "—"} />
          <FieldRow label="Current rate" value={l.rate_label || fmtPct(l.rate)} />
          <FieldRow label="Reprice date" value={fmtDate(l.reprice_date)} />
          <FieldRow
            label="Est. monthly repayment"
            value={calcPmt ? <span className="font-bold text-primary">{fmtMoney(calcPmt)}</span> : "—"}
          />
          {calcBal != null && (
            <FieldRow label="Est. balance today" value={<span className="text-muted-foreground">{fmtMoney(calcBal)}</span>} />
          )}
        </Section>

        <CollapsibleSection icon={<span>📊</span>} title="Loan Rate Schedule">
          <RateSchedule loanId={l.id} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>📝</span>} title="Notes" defaultOpen={!!l.notes}>
          <NotesEditor table="loans" queryKey="loans" id={l.id} value={l.notes} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>🔄</span>} title="Add an Update">
          <HistoryLog entityType="loan" entityId={l.id} />
        </CollapsibleSection>

        <CollapsibleSection icon={<span>📎</span>} title="Documents">
          <DocumentsList entityType="loan" entityId={l.id} />
        </CollapsibleSection>

        <div className="flex justify-end pt-1">
          <ReminderButton entityType="loan" entityId={l.id} />
        </div>
      </RecordCard>
      {edit.element}
    </HashHighlight>
  );
}
