import { useState } from "react";
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
import { fmtMoney, fmtDate, groupByCurrency } from "@/lib/format";
import { ForeignCurrencyTotals } from "@/components/ForeignCurrencyTotals";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { freqLabel, INSURANCE_CATEGORIES } from "@/lib/options";
import { DocumentsList } from "@/components/DocumentsList";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { HistoryLog } from "@/components/HistoryLog";
import { NotesEditor } from "@/components/NotesEditor";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { computeNextOccurrence } from "@/lib/alerts";
import { useEntityCounts } from "@/lib/useEntityCounts";

export const Route = createFileRoute("/insurance")({
  component: InsurancePage,
  head: () => ({ meta: [{ title: "Insurance — FamilyHub SG" }] }),
});

function InsurancePage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("insurance_policies", "insurance");
  const del = useDeleteMutation("insurance_policies", "insurance", "insurance");
  const counts = useEntityCounts("insurance", activeHouseholdId);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  const { data: items = [] } = useQuery({
    queryKey: ["insurance", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("insurance_policies").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const annualTotals = groupByCurrency(items, (i: any) => {
    if (!i.premium) return 0;
    const f = (i.frequency || "annual").toLowerCase();
    const mult = f.includes("month") ? 12 : f.includes("quart") ? 4 : f.includes("semi") ? 2 : 1;
    return Number(i.premium) * mult;
  });
  const totalAnnual = annualTotals.sgd;

  const presentCategories = new Set(items.map((i: any) => i.category));
  const categories = INSURANCE_CATEGORIES.filter((c) => presentCategories.has(c));
  // If the only policy in the selected category gets deleted (or filters change),
  // fall back to "All" rather than silently rendering a blank page.
  const effectiveCategory = selectedCategory === "All" || categories.includes(selectedCategory) ? selectedCategory : "All";
  const visibleCategories = effectiveCategory === "All" ? categories : categories.filter((c) => c === effectiveCategory);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Insurance</h1>
      <p className="text-xs text-muted-foreground">
        {items.length} policies · {fmtMoney(totalAnnual)} / year total
      </p>
      <ForeignCurrencyTotals foreign={annualTotals.foreign} />
      <MemberFilterBar table="insurance_policies" />
      <p className="text-[11px] text-muted-foreground">
        Looking for ILP or Endowment policies? Those are tracked under{" "}
        <a href="/investments" className="font-semibold text-primary underline">Investments</a>.
      </p>

      {categories.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["All", ...categories].map((cat) => {
            const isSelected = effectiveCategory === cat;
            const count = cat === "All" ? items.length : items.filter((i: any) => i.category === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`flex-shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {cat} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No policies yet. Tap + to add your first.</p>
        </div>
      )}

      {visibleCategories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{cat}</h2>
          <div className="space-y-3">
            {sortByStatus(items.filter((i: any) => i.category === cat)).map((p: any) => (
              <InsuranceRow
                key={p.id}
                p={p}
                onStatus={(s) => status.mutate({ id: p.id, status: s })}
                onDelete={() => del.mutate(p.id)}
                reminderCount={counts.reminderCounts[p.id] || 0}
                historyCount={counts.historyCounts[p.id] || 0}
                documentsCount={counts.documentsCounts[p.id] || 0}
              />
            ))}
          </div>
        </section>
      ))}
      <AddRecordFab configKey="insurance_policies" />
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

function InsuranceRow({
  p, onStatus, onDelete, reminderCount, historyCount, documentsCount,
}: {
  p: any; onStatus: (s: any) => void; onDelete: () => void;
  reminderCount: number; historyCount: number; documentsCount: number;
}) {
  const edit = useEditRecord("insurance_policies", p);
  const dup = useDuplicateRecord("insurance_policies", p);

  // Derived from start_date + frequency, same logic the bell/dashboard use —
  // not the manually-set next_due_date field, which no longer drives alerts.
  const nextDue = computeNextOccurrence(p.start_date, p.frequency, p.end_date, new Date());

  const [cardOpen, setCardOpen] = useState(false);
  const [section, setSection] = useState<"notes" | "reminders" | "history" | "documents" | null>(null);

  function openSection(target: "notes" | "reminders" | "history" | "documents") {
    setCardOpen(true);
    setSection(target);
    setTimeout(() => {
      document.getElementById(`${target}-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  return (
    <HashHighlight id={`record-${p.id}`}>
      <RecordCard
        title={p.name}
        subtitle={p.provider}
        memberId={p.member_id}
        status={p.status}
        onStatusChange={onStatus}
        action={p.action}
        externalUrl={p.external_url}
        tags={Array.isArray(p.also_covers) ? p.also_covers : null}
        isGiro={!!p.is_giro}
        onEdit={edit.open}
        onDelete={onDelete}
        onDuplicate={dup.open}
        hasNotes={!!p.notes}
        updatedAt={p.updated_at}
        createdAt={p.created_at}
        open={cardOpen}
        onOpenChange={setCardOpen}
        reminderCount={reminderCount}
        historyCount={historyCount}
        documentsCount={documentsCount}
        onNotesClick={() => openSection("notes")}
        onReminderClick={() => openSection("reminders")}
        onHistoryClick={() => openSection("history")}
        onDocumentsClick={() => openSection("documents")}
        rightMeta={
          <div className="text-right text-xs">
            <div className="text-muted-foreground">Premium</div>
            <div className="font-bold">{fmtMoney(p.premium, p.currency)}/{freqLabel(p.frequency)}</div>
            {p.surrender_value != null && (
              <div className="mt-1 text-settled">
                <div className="text-[10px] text-muted-foreground">Surrender value</div>
                <div className="font-semibold">{fmtMoney(p.surrender_value, p.currency)}</div>
              </div>
            )}
          </div>
        }
      >
        <Section title="Policy">
          <FieldRow label="Policy #" value={p.policy_number} />
          <FieldRow label="Coverage" value={p.coverage} />
          <FieldRow label="Currency" value={p.currency} />
          <FieldRow label="Sum assured" value={fmtMoney(p.sum_assured, p.currency)} />
          <FieldRow label="Start" value={fmtDate(p.start_date)} />
          <FieldRow label={<AlertLabel text="End" />} value={fmtDate(p.end_date)} />
          <FieldRow
            label={<AlertLabel text="Next premium due" />}
            value={nextDue ? <span className="font-semibold text-primary">{fmtDate(nextDue)}</span> : "—"}
          />
        </Section>
        {(p.payout_amount || p.payout_start_date || p.payout_end_date || p.beneficiary || p.surrender_value != null) && (
          <Section title="Payout">
            {p.surrender_value != null && <FieldRow label="Surrender value (current)" value={fmtMoney(p.surrender_value, p.currency)} />}
            {p.payout_amount && <FieldRow label="Payout amount (est.)" value={fmtMoney(p.payout_amount, p.currency)} />}
            {p.payout_start_date && <FieldRow label="Payout start" value={fmtDate(p.payout_start_date)} />}
            {p.payout_frequency && <FieldRow label="Payout frequency" value={freqLabel(p.payout_frequency)} />}
            {p.payout_end_date && <FieldRow label="Payout end" value={fmtDate(p.payout_end_date)} />}
            {p.beneficiary && <FieldRow label="Beneficiary" value={p.beneficiary} />}
          </Section>
        )}

        <CollapsibleSection
          id={`notes-${p.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor
            table="insurance_policies"
            queryKey="insurance"
            id={p.id}
            value={p.notes}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id={`reminders-${p.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="insurance" entityId={p.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="insurance" entityId={p.id} />
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id={`history-${p.id}`}
          icon={<span>🔄</span>}
          title="Add an Update"
          count={historyCount}
          open={section === "history"}
          onOpenChange={(o) => setSection(o ? "history" : null)}
        >
          <HistoryLog entityType="insurance" entityId={p.id} />
        </CollapsibleSection>

        <CollapsibleSection
          id={`documents-${p.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="insurance" entityId={p.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
