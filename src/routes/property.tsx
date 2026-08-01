import { useState } from "react";
import { HistoryLog } from "@/components/HistoryLog";
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
import { fmtMoney, fmtDate, fmtPct, groupByCurrency, totalWithFx, convertToSgd, type FxRates } from "@/lib/format";
import { useFxRates } from "@/hooks/useFxRates";
import { ForeignCurrencyTotals } from "@/components/ForeignCurrencyTotals";
import { FxInfoNote } from "@/components/FxInfoNote";
import { HashHighlight } from "@/components/HashHighlight";
import { useEditRecord, useDuplicateRecord } from "@/components/EditRecordButton";
import { PROPERTY_PURPOSE_LABEL } from "@/lib/options";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { NotesEditor } from "@/components/NotesEditor";
import { DocumentsList } from "@/components/DocumentsList";
import { ReminderButton } from "@/components/ReminderButton";
import { RemindersList } from "@/components/RemindersList";
import { useEntityCounts } from "@/lib/useEntityCounts";

export const Route = createFileRoute("/property")({
  component: PropertyPage,
  head: () => ({ meta: [{ title: "Property — FamilyHub SG" }] }),
});

function totalCosts(p: any) {
  return ["cost_management","cost_property_tax","cost_fire_insurance","cost_maintenance","cost_other"]
    .reduce((s, k) => s + (Number(p[k]) || 0), 0) || Number(p.monthly_costs) || 0;
}

function yearsBetween(dateStr: string | null | undefined, now = new Date()) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  return (now.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function capitalGainPa(p: any): number | null {
  const purchase = Number(p.purchase_price) || 0;
  const current = Number(p.current_value) || 0;
  const years = yearsBetween(p.purchase_date);
  if (!purchase || !years || years < 0.1) return null;
  return ((current - purchase) / purchase / years) * 100;
}

function parseTargetPct(strategy: string | null | undefined): number | null {
  if (!strategy) return null;
  const m = strategy.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function PropertyPage() {
  const memberFilter = useAppStore((s) => s.memberFilter);
  const activeHouseholdId = useAppStore((s) => s.activeHouseholdId);
  const status = useStatusMutation("properties", "properties");
  const del = useDeleteMutation("properties", "properties", "property");
  const counts = useEntityCounts("property", activeHouseholdId);

  const { data: loans = [] } = useQuery({
    queryKey: ["loans", activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      const { data } = await supabase.from("loans").select("id, property_id, monthly_payment, bank, balance, currency").eq("household_id", activeHouseholdId);
      return data ?? [];
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties", memberFilter, activeHouseholdId],
    enabled: !!activeHouseholdId,
    queryFn: async () => {
      if (!activeHouseholdId) return [];
      let q = supabase.from("properties").select("*").eq("household_id", activeHouseholdId);
      if (memberFilter !== "all") q = q.eq("member_id", memberFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const investments = properties.filter((p: any) => p.purpose !== "own_home");
  const homes = properties.filter((p: any) => p.purpose === "own_home");
  const { data: fxRates } = useFxRates();
  // Net of mortgage uses each property's own mortgage_balance field (same
  // currency as the property, always in the same record) — not the Loans
  // tab's balance for a linked loan, since that's a separate manually-
  // entered number that could drift from this one. This matches what this
  // page's own "Loan vs Value %" figure already uses per property.
  const grossTotals = groupByCurrency(properties, (p: any) => p.current_value);
  const netTotals = groupByCurrency(
    properties,
    (p: any) => (Number(p.current_value) || 0) - (Number(p.mortgage_balance) || 0),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Property</h1>
      <MemberFilterBar table="properties" />

      <div className="space-y-3">
        {sortByStatus(investments).map((p: any) => (
          <PropertyRow
            key={p.id}
            p={p}
            loans={loans}
            fx={fxRates}
            onStatus={(s) => status.mutate({ id: p.id, status: s })}
            onDelete={() => del.mutate(p.id)}
            reminderCount={counts.reminderCounts[p.id] || 0}
            historyCount={counts.historyCounts[p.id] || 0}
            documentsCount={counts.documentsCounts[p.id] || 0}
          />
        ))}
      </div>

      {homes.length > 0 && (
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-bold">My Homes ▾</summary>
          <div className="mt-3 space-y-3">
            {homes.map((p: any) => (
              <PropertyRow
                key={p.id}
                p={p}
                loans={loans}
                fx={fxRates}
                onStatus={(s) => status.mutate({ id: p.id, status: s })}
                onDelete={() => del.mutate(p.id)}
                reminderCount={counts.reminderCounts[p.id] || 0}
                historyCount={counts.historyCounts[p.id] || 0}
                documentsCount={counts.documentsCounts[p.id] || 0}
              />
            ))}
          </div>
        </details>
      )}
      {properties.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Total gross value{grossTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
            </span>
            <span className="font-bold">{fmtMoney(totalWithFx(grossTotals, fxRates))}</span>
          </div>
          <ForeignCurrencyTotals foreign={grossTotals.foreign} fx={fxRates} />
          <div className="mt-2 flex justify-between">
            <span className="text-muted-foreground">
              Net of mortgage{netTotals.foreign.length > 0 && <FxInfoNote fx={fxRates} />}
            </span>
            <span className="font-bold">{fmtMoney(totalWithFx(netTotals, fxRates))}</span>
          </div>
          <ForeignCurrencyTotals foreign={netTotals.foreign} fx={fxRates} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Net of mortgage uses each property's own "Mortgage" balance field — update it there to keep this accurate.
          </p>
        </div>
      )}
      <AddRecordFab configKey="properties" />
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

function PropertyRow({
  p,
  loans,
  fx,
  onStatus,
  onDelete,
  reminderCount,
  historyCount,
  documentsCount,
}: {
  p: any;
  loans: any[];
  fx?: FxRates | null;
  onStatus: (s: any) => void;
  onDelete: () => void;
  reminderCount: number;
  historyCount: number;
  documentsCount: number;
}) {
  const edit = useEditRecord("properties", p);
  const dup = useDuplicateRecord("properties", p);
  const linkedLoan = loans.find((l: any) => l.property_id === p.id);
  const hasMismatch =
    linkedLoan && Number(linkedLoan.monthly_payment) !== Number(p.monthly_payment);
  // Compares via SGD-equivalent so this still works correctly even if the
  // linked loan happens to be entered in a different currency than the
  // property. If either side's currency has no cached rate yet, this stays
  // false rather than risk a false "mismatch" warning built on a bad number.
  const propertyMortgageSgd = convertToSgd(
    Number(p.mortgage_balance) || 0,
    p.currency || "SGD",
    fx,
  );
  const loanBalanceSgd = linkedLoan
    ? convertToSgd(Number(linkedLoan.balance) || 0, linkedLoan.currency || "SGD", fx)
    : null;
  const hasBalanceMismatch =
    linkedLoan != null &&
    linkedLoan.balance != null &&
    p.mortgage_balance != null &&
    propertyMortgageSgd != null &&
    loanBalanceSgd != null &&
    Math.round(propertyMortgageSgd) !== Math.round(loanBalanceSgd);
  const costs = totalCosts(p);
  const gainPa = capitalGainPa(p);
  const target = parseTargetPct(p.strategy);
  const gainColor =
    gainPa == null || target == null ? "" :
    gainPa >= target ? "text-settled" :
    gainPa >= target - 1 ? "text-review" : "text-urgent";
  const grossYield = p.current_value && p.monthly_rent ? ((p.monthly_rent * 12) / p.current_value) * 100 : null;
  const netRent = (Number(p.monthly_rent) || 0) - costs;
  const netYield = p.current_value ? (netRent * 12) / p.current_value * 100 : null;
  const cashFlow = netRent - (Number(p.monthly_payment) || 0);

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
        subtitle={`${PROPERTY_PURPOSE_LABEL[p.purpose] ?? "Other"} · ${p.currency}`}
        memberId={p.member_id}
        status={p.status}
        onStatusChange={onStatus}
        action={p.action_note}
        externalUrl={p.external_url}
        onEdit={edit.open}
        onDuplicate={dup.open}
        onDelete={onDelete}
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
            <div className="text-muted-foreground">Value (est.)</div>
            <div className="font-bold">{fmtMoney(p.current_value, p.currency)}</div>
            {p.monthly_rent && (
              <>
                <div className="mt-1 text-muted-foreground">Rental</div>
                <div className="font-semibold text-settled">+{fmtMoney(p.monthly_rent, p.currency)}/mo</div>
              </>
            )}
          </div>
        }
      >
        <Section title="Strategy">
          <p className="text-sm text-foreground/80">{p.strategy || "—"}</p>
          {p.beneficiary && <FieldRow label="Beneficiary / intended for" value={p.beneficiary} />}
        </Section>
        <Section title="Financials">
          <FieldRow label="Purchase price" value={fmtMoney(p.purchase_price, p.currency)} />
          <FieldRow label="Purchase date" value={fmtDate(p.purchase_date)} />
          <FieldRow label="Current value" value={fmtMoney(p.current_value, p.currency)} />
          <FieldRow label="Capital gain" value={fmtMoney((p.current_value || 0) - (p.purchase_price || 0), p.currency)} />
          <FieldRow
            label="Capital gain p.a."
            value={gainPa == null ? "—" : <span className={`font-semibold ${gainColor}`}>{gainPa.toFixed(1)}%</span>}
          />
          <FieldRow label="Mortgage" value={p.mortgage_bank ? `${p.mortgage_bank} · ${fmtMoney(p.mortgage_balance, p.currency)}` : "—"} />
          <FieldRow label="Monthly payment" value={fmtMoney(p.monthly_payment, p.currency)} />
          {hasMismatch && (
            <div className="rounded-lg border border-review/40 bg-review-soft/30 px-3 py-2 text-xs text-muted-foreground">
              ⚠ Linked loan ({linkedLoan.bank}) has a different monthly payment of {fmtMoney(linkedLoan.monthly_payment, linkedLoan.currency)}. The loan amount is used for cash flow calculations — update one to match.
            </div>
          )}
          {hasBalanceMismatch && (
            <div className="rounded-lg border border-review/40 bg-review-soft/30 px-3 py-2 text-xs text-muted-foreground">
              ⚠ Linked loan ({linkedLoan.bank}) shows a balance of {fmtMoney(linkedLoan.balance, linkedLoan.currency)}, which doesn't match this property's Mortgage balance of {fmtMoney(p.mortgage_balance, p.currency)}. This property's "Net of mortgage" total uses the figure above — update one so they agree.
            </div>
          )}
          <FieldRow label="Interest rate" value={fmtPct(p.interest_rate)} />
          <FieldRow label="Rate type" value={p.rate_type ?? "—"} />
          <FieldRow label={<AlertLabel text="Rate ends / Reprice" />} value={fmtDate(p.fixed_rate_end)} />
          <FieldRow label="Mortgage end date" value={p.mortgage_end_date ? fmtDate(p.mortgage_end_date) : <span className="text-muted-foreground text-xs">Not set — chart assumes ongoing</span>} />
          <FieldRow label="Monthly rent" value={fmtMoney(p.monthly_rent, p.currency)} />
        </Section>

        <Section title="Monthly Costs">
          <FieldRow label="Management fee" value={fmtMoney(p.cost_management, p.currency)} />
          <FieldRow label="Property tax" value={fmtMoney(p.cost_property_tax, p.currency)} />
          <FieldRow label="Fire insurance" value={fmtMoney(p.cost_fire_insurance, p.currency)} />
          <FieldRow label="Maintenance / repairs" value={fmtMoney(p.cost_maintenance, p.currency)} />
          <FieldRow label={p.cost_other_label || "Other"} value={fmtMoney(p.cost_other, p.currency)} />
          <FieldRow label={<span className="font-bold">Total monthly costs</span> as any} value={<span className="font-bold">{fmtMoney(costs, p.currency)}</span>} />
          <FieldRow label="Gross yield %" value={grossYield != null ? fmtPct(grossYield) : "—"} />
          <FieldRow label="Net yield %" value={netYield != null ? fmtPct(netYield) : "—"} />
          <FieldRow label="Monthly cash flow" value={<span className={cashFlow >= 0 ? "text-settled" : "text-urgent"}>{fmtMoney(cashFlow, p.currency)}</span>} />
          <FieldRow
            label="Loan vs Value %"
            value={p.current_value && p.mortgage_balance ? fmtPct((p.mortgage_balance / p.current_value) * 100) : "—"}
          />
        </Section>

        <CollapsibleSection
          id={`notes-${p.id}`}
          icon={<span>📝</span>}
          title="Notes"
          open={section === "notes"}
          onOpenChange={(o) => setSection(o ? "notes" : null)}
        >
          <NotesEditor table="properties" queryKey="properties" id={p.id} value={p.notes} />
        </CollapsibleSection>
        <CollapsibleSection
          id={`reminders-${p.id}`}
          icon={<span>🔔</span>}
          title="Reminders"
          open={section === "reminders"}
          onOpenChange={(o) => setSection(o ? "reminders" : null)}
        >
          <RemindersList entityType="property" entityId={p.id} />
          <div className="flex justify-end pt-1">
            <ReminderButton entityType="property" entityId={p.id} />
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
          <HistoryLog entityType="property" entityId={p.id} />
        </CollapsibleSection>
        <CollapsibleSection
          id={`documents-${p.id}`}
          icon={<span>📎</span>}
          title="Documents"
          count={documentsCount}
          open={section === "documents"}
          onOpenChange={(o) => setSection(o ? "documents" : null)}
        >
          <DocumentsList entityType="property" entityId={p.id} />
        </CollapsibleSection>
      </RecordCard>
      {edit.element}
      {dup.element}
    </HashHighlight>
  );
}
