import { useState } from "react";
import { AddRecordFab } from "@/components/AddRecordFab";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/lib/store";
import { MemberFilterBar } from "@/components/MemberFilterBar";
import { RecordCard, FieldRow, Section } from "@/components/RecordCard";
import { useStatusMutation, useDeleteMutation } from "@/lib/mutations";
import { sortByStatus } from "@/lib/sort";
import { fmtMoney, fmtPct, fmtDate } from "@/lib/format";
import { freqLabel } from "@/lib/options";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/loan/NotesEditor";
import { HistoryLog } from "@/components/loan/HistoryLog";
import { DocumentsList } from "@/components/loan/DocumentsList";
import { ReminderButton } from "@/components/loan/ReminderButton";
import { RemindersList } from "@/components/loan/RemindersList";
import { useEntityCounts } from "@/lib/useEntityCounts";

export const Route = createFileRoute("/investments")({
  component: InvestmentsPage,
  head: () => ({ meta: [{ title: "Investments — FamilyVault" }] }),
});

function InvestmentsPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("investments", "investments");
  const del = useDeleteMutation("investments", "investments", "investment");
  const counts = useEntityCounts("investment", activeHouseholdId);

  const { data: items = [] } = useQuery({
    queryKey: ["investments", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("investments").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const groups = Array.from(new Set(items.map((i: any) => i.group_name)));
  const totalCost = items.reduce((s: number, i: any) => s + (Number(i.cost_basis) || 0), 0);
  const totalValue = items.reduce((s: number, i: any) => s + (Number(i.current_value) || 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Investments</h1>
      <MemberFilterBar table="investments" />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No investments yet.</p>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{g}</h2>
              <div className="space-y-3">
                {sortByStatus(items.filter((i: any) => i.group_name === g)).map((inv: any) => (
                  <InvestmentRow
                    key={inv.id}
                    inv={inv}
                    onStatus={(s) => status.mutate({ id: inv.id, status: s })}
                    onDelete={() => del.mutate(inv.id)}
                    reminderCount={counts.reminderCounts[inv.id] || 0}
                    historyCount={counts.historyCounts[inv.id] || 0}
                    documentsCount={counts.documentsCounts[inv.id] || 0}
                  />
                ))}
              </div>
            </section>
          ))}
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <div className="flex justify-between"><span>Total invested</span><span className="font-bold">{fmtMoney(totalCost)}</span></div>
            <div className="flex justify-between"><span>Current value</span><span className="font-bold">{fmtMoney(totalValue)}</span></div>
            <div className="flex justify-between"><span>Gain / Loss</span><span className={`font-bold ${totalValue - totalCost >= 0 ? "text-settled" : "text-urgent"}`}>{fmtMoney(totalValue - totalCost)}</span></div>
          </div>
        </>
      )}
      <AddRecordFab configKey="investments" />
    </div>
  );
}

function InvestmentRow({
  inv, onStatus, onDelete, reminderCount, historyCount, documentsCount,
}: {
  inv: any; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
}) {
  const edit = useEditRecord("investments", inv);
  const dup = useDuplicateRecord("investments", inv);
  const gain = (inv.current_value || 0) - (inv.cost_basis || 0);
  const daysSinceUpdate = inv.updated_at
    ? Math.floor((Date.now() - new Date(inv.updated_at).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = daysSinceUpdate !== null && daysSinceUpdate > 90;
  const isILPOrEndowment = inv.group_name === "ILP (Investment-Linked Policy)" || inv.group_name === "Endowment";
  const staleTitle = "Updated " + daysSinceUpdate + "d ago";
  const staleIndicator = isStale ? <span className="ml-1 text-review" title={staleTitle}>⚠</span> : null;

  // Premium shown on the collapsed card so a yearly/monthly ILP/Endowment premium
  // is visible without expanding — same pattern as Loans' monthly repayment.
  const premiumMonthlyEquivalent = (() => {
    if (!isILPOrEndowment || !inv.premium_amount) return null;
    const amt = Number(inv.premium_amount);
    const freq = (inv.premium_frequency || "annual").toLowerCase();
    if (freq === "monthly") return amt;
    if (freq === "quarterly") return amt / 3;
    if (freq === "semi-annual") return amt / 6;
    if (freq === "annual") return amt / 12;
    return null; // one-off — no recurring amount to show
  })();

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${inv.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${inv.id}`}>
      <RecordCard
        title={inv.name}
        memberId={inv.member_id}
        status={inv.status}
        onStatusChange={onStatus}
        action={inv.strategy}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
        hasNotes={!!inv.notes}
        updatedAt={inv.updated_at}
        createdAt={inv.created_at}
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
            <div className="text-muted-foreground">
              Value (est.){staleIndicator}
            </div>
            <div className="font-bold">{fmtMoney(inv.current_value)}</div>
            <div className={gain >= 0 ? "text-settled" : "text-urgent"}>{fmtMoney(gain)}</div>
            {premiumMonthlyEquivalent != null && (
              <div className="mt-1 font-semibold text-urgent">
                −{fmtMoney(premiumMonthlyEquivalent)}/mo
              </div>
            )}
          </div>
        }
      >
        {isStale && (
          <div className="rounded-lg border border-review/40 bg-review-soft/30 px-3 py-2 text-xs text-muted-foreground">
            ⚠ Current value was last updated {daysSinceUpdate} days ago — consider refreshing this estimate.
          </div>
        )}
        <Section title="Holding">
          <FieldRow label="Amount invested" value={fmtMoney(inv.cost_basis)} />
          <FieldRow label="Current value (est.)" value={fmtMoney(inv.current_value)} />
          <FieldRow label="Projected return" value={fmtPct(inv.projected_return_pct)} />
          {isILPOrEndowment && inv.coverage && <FieldRow label="Coverage" value={inv.coverage} />}
          {isILPOrEndowment && inv.premium_amount && <FieldRow label="Premium amount" value={fmtMoney(inv.premium_amount)} />}
          {isILPOrEndowment && inv.premium_start_date && <FieldRow label="Premium start" value={fmtDate(inv.premium_start_date)} />}
          {isILPOrEndowment && inv.premium_frequency && <FieldRow label="Premium frequency" value={freqLabel(inv.premium_frequency)} />}
          {isILPOrEndowment && inv.premium_end_date && <FieldRow label="Premium end" value={fmtDate(inv.premium_end_date)} />}
          {isILPOrEndowment && inv.payout_amount && <FieldRow label="Payout amount (est.)" value={fmtMoney(inv.payout_amount)} />}
          {isILPOrEndowment && inv.payout_start_date && <FieldRow label="Payout start" value={fmtDate(inv.payout_start_date)} />}
          {isILPOrEndowment && inv.payout_frequency && <FieldRow label="Payout frequency" value={freqLabel(inv.payout_frequency)} />}
          {isILPOrEndowment && inv.payout_end_date && <FieldRow label="Payout end" value={fmtDate(inv.payout_end_date)} />}
        </Section>

        <CollapsibleSection
          id={`notes-${inv.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor
            table="investments"
            queryKey="investments"
            id={inv.id}
            value={inv.notes}
          />
          <RemindersList entityType="investment" entityId={inv.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="investment" entityId={inv.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${inv.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="investment" entityId={inv.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${inv.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="investment" entityId={inv.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
