import { useState } from "react";
import { AddRecordFab } from "@/components/AddRecordFab";
import { Bell } from "lucide-react";
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
import { NotesEditor } from "@/components/NotesEditor";
import { HistoryLog } from "@/components/HistoryLog";
import { DocumentsList } from "@/components/DocumentsList";
import { RateSchedule } from "@/components/loan/RateSchedule";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { monthlyPayment, remainingBalance, monthsSince } from "@/lib/loanMath";
import { useToday } from "@/lib/today";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { useEntityCounts } from "@/lib/useEntityCounts";

export const Route = createFileRoute("/loans")({
  component: LoansPage,
  head: () => ({ meta: [{ title: "Loans — FamilyHub SG" }] }),
});

function LoansPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("loans", "loans");
  const del = useDeleteMutation("loans", "loans", "loan");
  const { today } = useToday();
  const counts = useEntityCounts("loan", activeHouseholdId);

  const { data: loans = [] } = useQuery({
    queryKey: ["loans", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("loans").select("*").eq("household_id", activeHouseholdId);
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
            reminderCount={counts.reminderCounts[l.id] || 0}
            historyCount={counts.historyCounts[l.id] || 0}
            documentsCount={counts.documentsCounts[l.id] || 0}
          />
        ))}
      </div>
      <AddRecordFab configKey="loans" />
    </div>
  );
}

function AlertLabel({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1">
      {text}
      <Bell className="h-3 w-3 fill-yellow-500 text-yellow-500" />
    </span>
  );
}

function LoanRow({
  l, today, onStatus, onDelete, reminderCount, historyCount, documentsCount,
}: {
  l: any; today: Date; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
}) {
  const edit = useEditRecord("loans", l);
  const dup = useDuplicateRecord("loans", l);
  const principal = Number(l.original_amount ?? l.balance ?? 0);
  const rate = Number(l.rate ?? 0);
  const term = Number(l.term_years ?? 0);
  const calcPmt = principal && term ? monthlyPayment(principal, rate, term) : 0;
  const calcBal =
    principal && term && l.start_date
      ? remainingBalance(principal, rate, term, monthsSince(l.start_date, today))
      : null;
  const rateParts = [l.rate ? `${l.rate}%` : null, l.rate_label || null].filter(Boolean);
  const rateSubtitle = rateParts.join(" · ");
  const actionParts = [l.reprice_date ? `Reprice by ${fmtMonth(l.reprice_date)}` : null, l.action || null].filter(Boolean);
  const actionLabel = actionParts.join(" · ") || null;
  const displayedMonthlyPayment = l.monthly_payment || calcPmt;

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${l.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${l.id}`}>
      <RecordCard
        title={`${l.bank} · ${l.purpose ?? ""}`}
        subtitle={rateSubtitle}
        memberId={l.member_id}
        status={l.status}
        onStatusChange={onStatus}
        action={actionLabel}
        externalUrl={l.external_url}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!l.notes}
        updatedAt={l.updated_at}
        createdAt={l.created_at}
        open={cardOpen}
        onOpenChange={setCardOpen}
        reminderCount={reminderCount}
        historyCount={historyCount}
        documentsCount={documentsCount}
        onNotesClick={() => openSection("notes")}
        onReminderClick={() => openSection("notes")}
        onHistoryClick={() => openSection("history")}
        onDocumentsClick={() => openSection("documents")}
        rightMeta={
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Balance</div>
            <div className="font-bold">{fmtMoney(l.balance)} <span className="text-[10px] font-normal text-muted-foreground">(est.)</span></div>
            {displayedMonthlyPayment && (
              <div className="font-semibold text-urgent">
                −{fmtMoney(displayedMonthlyPayment)}/mo
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
          <FieldRow label={<AlertLabel text="Reprice date" />} value={fmtDate(l.reprice_date)} />
          <FieldRow label="Loan end date" value={l.loan_end_date ? fmtDate(l.loan_end_date) : <span className="text-muted-foreground text-xs">Not set — chart assumes ongoing</span>} />
          {l.action && <FieldRow label="Action" value={l.action} />}
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

        <CollapsibleSection
          id={`notes-${l.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor table="loans" queryKey="loans" id={l.id} value={l.notes} />
          <RemindersList entityType="loan" entityId={l.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="loan" entityId={l.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${l.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="loan" entityId={l.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${l.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="loan" entityId={l.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
